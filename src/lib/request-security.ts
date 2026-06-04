import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

const encoder = new TextEncoder();

export class PayloadTooLargeError extends Error {
  constructor(limitBytes: number) {
    super(`Request body exceeds ${limitBytes} bytes`);
    this.name = 'PayloadTooLargeError';
  }
}

export async function readRequestTextWithLimit(request: NextRequest, limitBytes: number): Promise<string> {
  const contentLength = request.headers.get('content-length');
  if (contentLength && Number(contentLength) > limitBytes) {
    throw new PayloadTooLargeError(limitBytes);
  }

  if (!request.body) {
    return '';
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      totalBytes += value.byteLength;
      if (totalBytes > limitBytes) {
        await reader.cancel();
        throw new PayloadTooLargeError(limitBytes);
      }
      chunks.push(value);
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

  return new TextDecoder().decode(merged);
}

export async function readJsonBodyWithLimit<T>(request: NextRequest, limitBytes: number): Promise<T> {
  const raw = await readRequestTextWithLimit(request, limitBytes);
  return JSON.parse(raw) as T;
}

export function oversizedBodyResponse(error: unknown) {
  if (error instanceof PayloadTooLargeError) {
    return NextResponse.json({ error: error.message }, { status: 413 });
  }
  return null;
}

export async function requireApiKeyOrAdmin(
  request: NextRequest,
  expectedSecrets: Array<string | undefined>,
  providedKey?: string | null
): Promise<NextResponse | null> {
  const user = await getCurrentUser();
  if (user?.role === 'admin') {
    return null;
  }

  const configuredSecrets = expectedSecrets.map((secret) => secret?.trim()).filter(Boolean) as string[];
  if (configuredSecrets.length === 0) {
    console.error('API key protected route has no configured secret');
    return NextResponse.json({ error: 'Server configuration error' }, { status: 503 });
  }

  const apiKey = providedKey?.trim() || getApiKeyFromRequest(request);
  if (!apiKey) {
    return NextResponse.json({ error: 'API key required' }, { status: 401 });
  }

  for (const expectedSecret of configuredSecrets) {
    if (await timingSafeEqualStrings(apiKey, expectedSecret)) {
      return null;
    }
  }

  return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
}

export function getApiKeyFromRequest(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  return (
    request.headers.get('x-api-key') ||
    request.headers.get('x-schedule-key') ||
    request.nextUrl.searchParams.get('apiKey') ||
    request.nextUrl.searchParams.get('key')
  );
}

async function timingSafeEqualStrings(provided: string, expected: string): Promise<boolean> {
  const [providedHash, expectedHash] = await Promise.all([
    sha256(provided),
    sha256(expected),
  ]);

  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (a: BufferSource, b: BufferSource) => boolean;
  };

  if (typeof subtle.timingSafeEqual === 'function') {
    return subtle.timingSafeEqual(toArrayBuffer(providedHash), toArrayBuffer(expectedHash));
  }

  let diff = providedHash.byteLength ^ expectedHash.byteLength;
  for (let i = 0; i < providedHash.byteLength; i += 1) {
    diff |= providedHash[i] ^ expectedHash[i];
  }
  return diff === 0;
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
