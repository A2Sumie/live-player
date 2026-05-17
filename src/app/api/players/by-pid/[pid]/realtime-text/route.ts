import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserFromRequestOrInternalAdmin } from '@/lib/auth';
import { cache, CACHE_KEYS, CACHE_TTL } from '@/lib/cache';
import { getPlayerViewByPid } from '@/lib/player-runtime';
import { getRealtimeTextConfigFromValues, parseJsonObject } from '@/lib/realtime-text';
import {
  getRealtimeTextSnapshotFromStore,
  ingestRealtimeTextEvent,
  pruneRealtimeTextSegments,
  type RealtimeTextTermRule,
} from '@/lib/realtime-text-store';

export const dynamic = 'force-dynamic';

function extractTermRules(...configs: Array<string | null | undefined>): RealtimeTextTermRule[] {
  const rules: RealtimeTextTermRule[] = [];
  for (const rawConfig of configs) {
    const parsed = parseJsonObject(rawConfig);
    const realtime = parsed?.realtimeText;
    if (!realtime || typeof realtime !== 'object' || Array.isArray(realtime)) {
      continue;
    }
    const terms = (realtime as Record<string, unknown>).terms;
    if (terms && typeof terms === 'object' && !Array.isArray(terms)) {
      for (const [from, to] of Object.entries(terms)) {
        if (typeof to === 'string' && from) {
          rules.push({ from, to });
        }
      }
    }
    if (Array.isArray(terms)) {
      for (const term of terms) {
        if (!term || typeof term !== 'object' || Array.isArray(term)) {
          continue;
        }
        const from = (term as Record<string, unknown>).from;
        const to = (term as Record<string, unknown>).to;
        if (typeof from === 'string' && typeof to === 'string' && from) {
          rules.push({ from, to });
        }
      }
    }
  }
  return rules;
}

export async function GET(request: NextRequest, context: { params: Promise<{ pid: string }> }) {
  try {
    const { pid } = await context.params;
    if (!pid) {
      return NextResponse.json({ error: 'Player ID required' }, { status: 400 });
    }

    const player = await cache.getOrFetch(
      CACHE_KEYS.PLAYER(pid),
      async () => getPlayerViewByPid(pid),
      CACHE_TTL.PLAYER
    );

    if (!player) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 });
    }

    const config = getRealtimeTextConfigFromValues(
      player.streamConfig,
      player.runtimeStreamConfig,
    );
    const forceEnabled = request.nextUrl.searchParams.get('force') === '1'
      || request.nextUrl.searchParams.get('debug') === '1';

    const snapshot = await getRealtimeTextSnapshotFromStore(pid, {
      ...config,
      enabled: config.enabled || forceEnabled,
    });

    return NextResponse.json(snapshot, {
      headers: {
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('Error fetching realtime text snapshot:', error);
    return NextResponse.json(
      { error: 'Failed to fetch realtime text snapshot' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ pid: string }> }) {
  try {
    const user = await getCurrentUserFromRequestOrInternalAdmin(request);
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { pid } = await context.params;
    if (!pid) {
      return NextResponse.json({ error: 'Player ID required' }, { status: 400 });
    }

    const player = await getPlayerViewByPid(pid);
    if (!player) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 });
    }

    const body = await request.json() as any;
    const terms = extractTermRules(player.streamConfig, player.runtimeStreamConfig);
    const result = await ingestRealtimeTextEvent(pid, body, { terms });
    if (result.accepted) {
      await pruneRealtimeTextSegments(pid);
    }

    return NextResponse.json(result, {
      status: result.accepted ? 200 : 202,
      headers: {
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('Error ingesting realtime text event:', error);
    return NextResponse.json(
      { error: 'Failed to ingest realtime text event' },
      { status: 500 }
    );
  }
}
