import { NextRequest } from 'next/server';
import { cache, CACHE_KEYS, CACHE_TTL } from '@/lib/cache';
import { getPlayerViewByPid } from '@/lib/player-runtime';
import { getRealtimeTextConfigFromValues } from '@/lib/realtime-text';
import { getRealtimeTextSnapshotFromStore } from '@/lib/realtime-text-store';

export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();

function sseEvent(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function GET(request: NextRequest, context: { params: Promise<{ pid: string }> }) {
  const { pid } = await context.params;
  const player = pid
    ? await cache.getOrFetch(
      CACHE_KEYS.PLAYER(pid),
      async () => getPlayerViewByPid(pid),
      CACHE_TTL.PLAYER
    )
    : null;

  if (!player) {
    return new Response('Player not found', { status: 404 });
  }

  const config = getRealtimeTextConfigFromValues(
    player.streamConfig,
    player.runtimeStreamConfig,
  );
  const forceEnabled = request.nextUrl.searchParams.get('force') === '1'
    || request.nextUrl.searchParams.get('debug') === '1';
  const baseConfig = {
    ...config,
    enabled: config.enabled || forceEnabled,
  };
  const initialSnapshot = await getRealtimeTextSnapshotFromStore(pid, baseConfig);

  const retry = encoder.encode('retry: 15000\n');
  const snapshot = sseEvent('snapshot', initialSnapshot);

  return new Response(new Blob([retry, snapshot]), {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
