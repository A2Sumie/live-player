import type { NextRequest } from 'next/server';

const STREAM_ORIGIN = 'https://stream.n2nj.moe';

function exposeTvHevcLevels(playlist: string, upstreamUrl: URL) {
  const lines = playlist.split(/\r?\n/);
  return lines.map((line, index) => {
    if (line && !line.startsWith('#')) {
      const directUrl = new URL(line, upstreamUrl);
      directUrl.search = upstreamUrl.search;
      return directUrl.toString();
    }
    if (!line.startsWith('#EXT-X-STREAM-INF:')) return line;
    const nextUri = lines.slice(index + 1).find((candidate) => candidate.trim())?.trim() || '';
    const variant = nextUri.endsWith('_0.m3u8')
      ? ['HEVC 5.4M', 'tv_hevc_main']
      : nextUri.endsWith('_1.m3u8')
        ? ['HEVC 1.2M', 'tv_hevc_throttle']
        : null;
    if (!variant) return line;
    const withoutCodecs = line.replace(/,?CODECS="[^"]*"/, '').replace(':,', ':');
    return `${withoutCodecs},NAME="${variant[0]}",STABLE-VARIANT-ID="${variant[1]}"`;
  }).join('\n');
}

async function proxyStream(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  if (!path?.length || path.some((part) => !part || part === '.' || part === '..')) {
    return new Response('Invalid stream path', { status: 400 });
  }

  const upstreamUrl = new URL(`/${path.map(encodeURIComponent).join('/')}`, STREAM_ORIGIN);
  upstreamUrl.search = request.nextUrl.search;
  const headers = new Headers();
  for (const name of ['range', 'if-none-match', 'if-modified-since']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const upstream = await fetch(upstreamUrl, {
    method: request.method === 'HEAD' ? 'HEAD' : 'GET',
    headers,
    redirect: 'follow',
  });
  const responseHeaders = new Headers();
  for (const name of [
    'accept-ranges',
    'cache-control',
    'content-length',
    'content-range',
    'content-type',
    'etag',
    'last-modified',
  ]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  const isTvMaster = request.method !== 'HEAD'
    && /\/(?:live|sub)\.m3u8$/.test(upstreamUrl.pathname)
    && upstream.ok;
  const body = isTvMaster ? exposeTvHevcLevels(await upstream.text(), upstreamUrl) : upstream.body;
  if (isTvMaster) responseHeaders.delete('content-length');

  return new Response(request.method === 'HEAD' ? null : body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export const GET = proxyStream;
export const HEAD = proxyStream;

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: 'GET, HEAD, OPTIONS',
    },
  });
}
