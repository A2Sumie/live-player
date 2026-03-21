import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getPlayerViewByPid, invalidatePlayerCaches, upsertPlayerRuntimeByPid } from '@/lib/player-runtime';
import { serializeStreamConfig } from '@/lib/stream-config';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ pid: string }> }) {
  try {
    const params = await context.params;
    const pId = params.pid;

    if (!pId) {
      return NextResponse.json({ error: 'Player ID required' }, { status: 400 });
    }

    const player = await getPlayerViewByPid(pId);
    if (!player) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 });
    }

    const { coverImage, ...playerWithoutImage } = player;
    return NextResponse.json(playerWithoutImage);
  } catch (error) {
    console.error('Error fetching runtime player by pId:', error);
    return NextResponse.json({ error: 'Failed to fetch runtime player' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ pid: string }> }) {
  try {
    const user = await getCurrentUser();

    if (!user || user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Permission denied' },
        { status: 403 }
      );
    }

    const params = await context.params;
    const pId = params.pid;

    if (!pId) {
      return NextResponse.json({ error: 'Player ID required' }, { status: 400 });
    }

    const body = await request.json() as any;
    const runtimeUpdate: Record<string, string | null> = {};

    if (body.url !== undefined) runtimeUpdate.url = body.url ?? null;
    if (body.description !== undefined) runtimeUpdate.description = body.description ?? null;
    if (body.name !== undefined) runtimeUpdate.name = body.name ?? null;
    if (body.coverUrl !== undefined) runtimeUpdate.coverUrl = body.coverUrl ?? null;
    if (body.status !== undefined) runtimeUpdate.status = body.status ?? 'idle';
    if (body.runtimeStatus !== undefined) runtimeUpdate.status = body.runtimeStatus ?? 'idle';
    if (body.lastError !== undefined) runtimeUpdate.lastError = body.lastError ?? null;
    if (body.lastSeenAt !== undefined) runtimeUpdate.lastSeenAt = body.lastSeenAt ?? null;

    if (body.streamConfig !== undefined) {
      try {
        runtimeUpdate.streamConfig = serializeStreamConfig(body.streamConfig);
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : 'Invalid streamConfig' },
          { status: 400 }
        );
      }
    }

    if (Object.keys(runtimeUpdate).length === 0) {
      return NextResponse.json({ error: 'No valid runtime fields provided for update' }, { status: 400 });
    }

    const updatedPlayer = await upsertPlayerRuntimeByPid(pId, runtimeUpdate);
    if (!updatedPlayer) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 });
    }

    invalidatePlayerCaches(pId);

    const { coverImage, ...playerWithoutImage } = updatedPlayer;
    return NextResponse.json(playerWithoutImage);
  } catch (error) {
    console.error('Error patching runtime player by pId:', error);
    return NextResponse.json({ error: 'Failed to patch runtime player' }, { status: 500 });
  }
}
