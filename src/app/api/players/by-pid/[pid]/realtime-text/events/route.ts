import { NextRequest } from 'next/server';
import { cache, CACHE_KEYS, CACHE_TTL } from '@/lib/cache';
import { getPlayerViewByPid } from '@/lib/player-runtime';
import { getRealtimeTextConfigFromValues } from '@/lib/realtime-text';
import { getRealtimeTextSnapshotFromStore } from '@/lib/realtime-text-store';

export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();
const SSE_POLL_INTERVAL_MS = 5000;
const SSE_MAX_TICKS = 60;

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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastRevision: string | null = null;
      let closed = false;
      const sendSnapshot = async () => {
        const snapshot = await getRealtimeTextSnapshotFromStore(pid, baseConfig);
        if (snapshot.revision !== lastRevision) {
          lastRevision = snapshot.revision;
          controller.enqueue(sseEvent('snapshot', snapshot));
        }
      };

      request.signal.addEventListener('abort', () => {
        closed = true;
      });

      controller.enqueue(sseEvent('snapshot', initialSnapshot));
      lastRevision = initialSnapshot.revision;

      for (let tick = 0; tick < SSE_MAX_TICKS && !closed; tick += 1) {
        await new Promise((resolve) => setTimeout(resolve, SSE_POLL_INTERVAL_MS));
        if (closed) {
          break;
        }
        await sendSnapshot();
      }

      if (!closed) {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    },
  });
}
