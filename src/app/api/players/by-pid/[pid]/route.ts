import { NextRequest, NextResponse } from 'next/server';
import { getDb, players } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { cache, CACHE_KEYS, CACHE_TTL } from '@/lib/cache';
import { serializeStreamConfig } from '@/lib/stream-config';
import { getPlayerViewByPid, invalidatePlayerCaches, upsertPlayerRuntimeByPid } from '@/lib/player-runtime';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ pid: string }> }) {
    try {
        const params = await context.params;
        const pId = params.pid;

        if (!pId) {
            return NextResponse.json({ error: 'Player ID required' }, { status: 400 });
        }

        const player = await cache.getOrFetch(
            CACHE_KEYS.PLAYER(pId),
            async () => getPlayerViewByPid(pId),
            CACHE_TTL.PLAYER
        );

        if (!player) {
            return NextResponse.json({ error: 'Player not found' }, { status: 404 });
        }

        const { coverImage, ...playerWithoutImage } = player;
        return NextResponse.json(playerWithoutImage);
    } catch (error) {
        console.error('Error fetching player by pId:', error);
        return NextResponse.json({ error: 'Failed to fetch player' }, { status: 500 });
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
        const baseUpdate: Record<string, string | null> = {};

        if (body.url !== undefined) runtimeUpdate.url = body.url ?? null;
        if (body.description !== undefined) runtimeUpdate.description = body.description ?? null;
        if (body.name !== undefined) runtimeUpdate.name = body.name ?? null;
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
        if (body.coverUrl !== undefined) runtimeUpdate.coverUrl = body.coverUrl ?? null;
        if (body.status !== undefined) runtimeUpdate.status = body.status ?? 'idle';
        if (body.runtimeStatus !== undefined) runtimeUpdate.status = body.runtimeStatus ?? 'idle';
        if (body.lastError !== undefined) runtimeUpdate.lastError = body.lastError ?? null;
        if (body.lastSeenAt !== undefined) runtimeUpdate.lastSeenAt = body.lastSeenAt ?? null;
        if (body.announcement !== undefined) baseUpdate.announcement = body.announcement ?? null;

        if (Object.keys(runtimeUpdate).length === 0 && Object.keys(baseUpdate).length === 0) {
            return NextResponse.json({ error: 'No valid fields provided for update' }, { status: 400 });
        }

        const db = getDb();
        const existingPlayer = await getPlayerViewByPid(pId, db);
        if (!existingPlayer) {
            return NextResponse.json({ error: 'Player not found' }, { status: 404 });
        }

        if (Object.keys(baseUpdate).length > 0) {
            await db.update(players)
                .set({
                    ...baseUpdate,
                    updatedAt: new Date().toISOString(),
                })
                .where(eq(players.pId, pId));
        }

        if (Object.keys(runtimeUpdate).length > 0) {
            const updatedRuntimePlayer = await upsertPlayerRuntimeByPid(pId, runtimeUpdate, db);
            if (!updatedRuntimePlayer) {
                return NextResponse.json({ error: 'Player not found' }, { status: 404 });
            }
        }

        invalidatePlayerCaches(pId);

        const updatedPlayer = await getPlayerViewByPid(pId, db);
        if (!updatedPlayer) {
            return NextResponse.json({ error: 'Player not found' }, { status: 404 });
        }

        const { coverImage, ...playerWithoutImage } = updatedPlayer;
        return NextResponse.json(playerWithoutImage);
    } catch (error) {
        console.error('Error patching player by pId:', error);
        return NextResponse.json({ error: 'Failed to patch player' }, { status: 500 });
    }
}
