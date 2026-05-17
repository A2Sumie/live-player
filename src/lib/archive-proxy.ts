import { createHmac } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

type ArchiveProxyOptions = RequestInit & {
  requireAdmin?: boolean;
  timeoutMs?: number;
};

const ARCHIVE_JSON_RESPONSE_LIMIT_BYTES = 4 * 1024 * 1024;
const ARCHIVE_ERROR_RESPONSE_LIMIT_BYTES = 4096;

function applyWafBypassHeader(headers: Headers, rawHeader?: string) {
  const normalized = rawHeader?.trim();
  if (!normalized) {
    return;
  }

  const separatorIndex = normalized.indexOf(':');
  if (separatorIndex > 0) {
    const name = normalized.slice(0, separatorIndex).trim();
    const value = normalized.slice(separatorIndex + 1).trim();
    if (name && value) {
      headers.set(name, value);
    }
    return;
  }

  headers.set('x-bypass-waf', normalized);
}

async function requireArchiveUser(requireAdmin = true) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (requireAdmin && user.role !== 'admin') {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }
  return null;
}

function resolveArchiveBaseUrl() {
  const raw = process.env.STREAMSERV_ARCHIVE_API_URL || 'https://stream.n2nj.moe/archive-api';
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function resolveArchivePublicBaseUrl() {
  const raw = process.env.STREAMSERV_ARCHIVE_PUBLIC_URL
    || process.env.STREAMSERV_ARCHIVE_API_URL
    || 'https://stream.n2nj.moe/archive-api';
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function normalizeArchivePathSegment(value: string) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }
  const normalized = `/${trimmed.replace(/^\/+|\/+$/g, '')}`;
  return normalized === '/' ? '' : normalized;
}

function normalizeArchiveSigningSecret(rawValue?: string) {
  const normalized = String(rawValue || '').trim();
  if (!normalized) {
    return '';
  }
  const separatorIndex = normalized.indexOf(':');
  if (separatorIndex > 0) {
    return normalized.slice(separatorIndex + 1).trim();
  }
  return normalized;
}

function resolveArchiveDownloadCookieTtlSeconds() {
  const parsed = Number(
    process.env.STREAMSERV_ARCHIVE_DOWNLOAD_COOKIE_TTL
      || process.env.STREAMSERV_ARCHIVE_DOWNLOAD_TOKEN_TTL
      || '300'
  );
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 300;
  }
  return Math.max(60, Math.floor(parsed));
}

function resolveArchiveDownloadCookieName() {
  return String(process.env.STREAMSERV_ARCHIVE_DOWNLOAD_COOKIE_NAME || 'archive_dl').trim() || 'archive_dl';
}

function resolveArchiveWafUriTag() {
  return String(
    process.env.STREAMSERV_ARCHIVE_WAF_URI_TAG || '3f769fc2a283471d962cf779b4c4eced'
  ).trim();
}

function resolveArchiveDownloadCookieDomain(hostname: string) {
  const explicit = String(process.env.STREAMSERV_ARCHIVE_DOWNLOAD_COOKIE_DOMAIN || '').trim();
  if (explicit) {
    return explicit;
  }
  const normalizedHost = String(hostname || '').trim().toLowerCase();
  if (!normalizedHost || normalizedHost === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(normalizedHost)) {
    return '';
  }
  const segments = normalizedHost.split('.').filter(Boolean);
  if (segments.length < 2) {
    return '';
  }
  return `.${segments.slice(-2).join('.')}`;
}

const DOWNLOAD_AUTH_QUERY_KEYS = ['trimStartSeconds', 'trimEndSeconds'] as const;

function normalizeArchiveDownloadQuery(searchParams: URLSearchParams) {
  const normalized = new URLSearchParams();
  for (const key of DOWNLOAD_AUTH_QUERY_KEYS) {
    const value = searchParams.get(key)?.trim();
    if (value) {
      normalized.set(key, value);
    }
  }
  return normalized;
}

function splitArchiveDownloadTarget(target: string) {
  const parsed = new URL(target, 'https://archive.invalid');
  return {
    pathname: parsed.pathname,
    searchParams: normalizeArchiveDownloadQuery(parsed.searchParams),
  };
}

function buildArchiveDownloadSignature(path: string, expires: number, secret: string, searchParams: URLSearchParams) {
  const canonicalPath = String(path || '').replace(/\/+$/, '') || '/';
  const normalizedSearch = normalizeArchiveDownloadQuery(searchParams).toString();
  const canonicalTarget = normalizedSearch ? `${canonicalPath}?${normalizedSearch}` : canonicalPath;
  return createHmac('sha256', secret)
    .update(`${expires}:${canonicalTarget}`)
    .digest('base64url');
}

function buildArchiveDownloadCookieValue(path: string, expires: number, secret: string, searchParams: URLSearchParams) {
  return `${expires}.${buildArchiveDownloadSignature(path, expires, secret, searchParams)}`;
}

function buildArchiveDownloadCookie(options: {
  name: string;
  value: string;
  domain?: string;
  path: string;
  maxAge: number;
}) {
  const cookieParts = [
    `${options.name}=${encodeURIComponent(options.value)}`,
    `Path=${options.path}`,
    `Max-Age=${Math.max(1, Math.floor(options.maxAge))}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ];
  if (options.domain) {
    cookieParts.push(`Domain=${options.domain}`);
  }
  return cookieParts.join('; ');
}

async function fetchArchiveUpstream(url: string, options: ArchiveProxyOptions) {
  const { timeoutMs, ...fetchOptions } = options;
  if (!timeoutMs || timeoutMs <= 0) {
    return fetch(url, fetchOptions);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(`archive-timeout:${timeoutMs}`), timeoutMs);
  try {
    return await fetch(url, {
      ...fetchOptions,
      signal: fetchOptions.signal ?? controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function proxyArchiveRequest(req: NextRequest, archivePath: string, options: ArchiveProxyOptions = {}) {
  try {
    const { requireAdmin = true, ...fetchOptions } = options;
    const authFailure = await requireArchiveUser(requireAdmin);
    if (authFailure) {
      return authFailure;
    }

    const headers = new Headers(fetchOptions.headers || {});
    applyWafBypassHeader(headers, process.env.WAF_BYPASS_HEADER);

    const baseUrl = resolveArchiveBaseUrl();
    const targetPath = archivePath.startsWith('/') ? archivePath : `/${archivePath}`;
    const response = await fetchArchiveUpstream(`${baseUrl}${targetPath}`, {
      ...fetchOptions,
      headers,
    });

    if (!response.ok) {
      const { text, truncated } = await readArchiveResponseTextWithLimit(response, ARCHIVE_ERROR_RESPONSE_LIMIT_BYTES);
      return NextResponse.json(
        { error: `${text || `Archive upstream error: ${response.status}`}${truncated ? '... [truncated]' : ''}` },
        { status: response.status }
      );
    }

    const { text: jsonText, truncated } = await readArchiveResponseTextWithLimit(
      response,
      ARCHIVE_JSON_RESPONSE_LIMIT_BYTES
    );
    if (truncated) {
      return NextResponse.json({ error: 'Archive upstream JSON response too large' }, { status: 502 });
    }

    const payload = JSON.parse(jsonText);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Archive upstream timeout' },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: `Archive proxy error: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}

export async function proxyArchivePassthroughRequest(
  req: NextRequest,
  archivePath: string,
  options: ArchiveProxyOptions = {}
) {
  try {
    const { requireAdmin = true, ...fetchOptions } = options;
    const authFailure = await requireArchiveUser(requireAdmin);
    if (authFailure) {
      return authFailure;
    }

    const headers = new Headers(fetchOptions.headers || {});
    applyWafBypassHeader(headers, process.env.WAF_BYPASS_HEADER);
    for (const headerName of ['range', 'if-range']) {
      const headerValue = req.headers.get(headerName);
      if (headerValue) {
        headers.set(headerName, headerValue);
      }
    }

    const baseUrl = resolveArchiveBaseUrl();
    const targetPath = archivePath.startsWith('/') ? archivePath : `/${archivePath}`;
    const response = await fetchArchiveUpstream(`${baseUrl}${targetPath}`, {
      ...fetchOptions,
      headers,
    });

    if (!response.ok) {
      const { text, truncated } = await readArchiveResponseTextWithLimit(response, ARCHIVE_ERROR_RESPONSE_LIMIT_BYTES);
      return new NextResponse(`${text || response.statusText}${truncated ? '... [truncated]' : ''}`, {
        status: response.status,
      });
    }

    const passthroughHeaders = new Headers();
    for (const headerName of [
      'content-type',
      'content-length',
      'content-disposition',
      'cache-control',
      'accept-ranges',
      'content-range',
      'etag',
      'last-modified',
    ]) {
      const value = response.headers.get(headerName);
      if (value) {
        passthroughHeaders.set(headerName, value);
      }
    }

    return new Response(response.body, {
      status: response.status,
      headers: passthroughHeaders,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Archive upstream timeout' },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: `Archive proxy error: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}

export async function redirectArchiveDownloadRequest(
  _req: NextRequest,
  archivePath: string,
  options: ArchiveProxyOptions = {}
) {
  const { requireAdmin = true } = options;
  const authFailure = await requireArchiveUser(requireAdmin);
  if (authFailure) {
    return authFailure;
  }

  const normalizedSecret = normalizeArchiveSigningSecret(
    process.env.STREAMSERV_ARCHIVE_DOWNLOAD_SECRET
      || process.env.WAF_BYPASS_HEADER
      || process.env.STREAM_SECRET
  );
  if (!normalizedSecret) {
    return NextResponse.json({ error: 'Archive direct download secret is unavailable' }, { status: 503 });
  }

  const publicBaseUrl = new URL(resolveArchivePublicBaseUrl());
  const targetPath = archivePath.startsWith('/') ? archivePath : `/${archivePath}`;
  const { pathname, searchParams } = splitArchiveDownloadTarget(targetPath);
  const canonicalPath = pathname.replace(/\/+$/, '');
  const publicBasePath = normalizeArchivePathSegment(publicBaseUrl.pathname);
  const signedOriginPath = `${publicBasePath}${canonicalPath}` || canonicalPath;
  const wafUriTag = resolveArchiveWafUriTag();
  const publicDownloadPath = wafUriTag
    ? `/${wafUriTag.replace(/^\/+|\/+$/g, '')}${signedOriginPath}`
    : signedOriginPath;
  const directUrl = new URL(publicBaseUrl.origin);
  directUrl.pathname = publicDownloadPath;
  for (const [key, value] of searchParams.entries()) {
    directUrl.searchParams.set(key, value);
  }

  const ttlSeconds = resolveArchiveDownloadCookieTtlSeconds();
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const cookieName = resolveArchiveDownloadCookieName();
  const cookieValue = buildArchiveDownloadCookieValue(signedOriginPath, expires, normalizedSecret, searchParams);
  const cookieDomain = resolveArchiveDownloadCookieDomain(publicBaseUrl.hostname);
  const response = NextResponse.redirect(directUrl.toString(), { status: 302 });
  response.headers.append(
    'Set-Cookie',
    buildArchiveDownloadCookie({
      name: cookieName,
      value: cookieValue,
      domain: cookieDomain || undefined,
      path: publicDownloadPath,
      maxAge: ttlSeconds,
    })
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

async function readArchiveResponseTextWithLimit(response: Response, limitBytes: number) {
  if (!response.body) {
    return { text: '', truncated: false };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (totalBytes + value.byteLength > limitBytes) {
        const remaining = Math.max(limitBytes - totalBytes, 0);
        if (remaining > 0) {
          chunks.push(value.slice(0, remaining));
          totalBytes += remaining;
        }
        truncated = true;
        await reader.cancel();
        break;
      }

      chunks.push(value);
      totalBytes += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return {
    text: new TextDecoder().decode(merged),
    truncated,
  };
}
