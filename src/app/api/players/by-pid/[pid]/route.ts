import { NextRequest, NextResponse } from 'next/server';
import { getDb, players } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { cache, CACHE_KEYS, CACHE_TTL } from '@/lib/cache';

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
            async () => {
                const db = getDb();
                const [result] = await db.select().from(players).where(eq(players.pId, pId)).limit(1);
                return result || null;
            },
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

        // Allowed fields to patch
        const updateData: any = {};
        if (body.url !== undefined) updateData.url = body.url;
        if (body.description !== undefined) updateData.description = body.description;
        if (body.name !== undefined) updateData.name = body.name;
        if (body.streamConfig !== undefined) updateData.streamConfig = body.streamConfig ? JSON.stringify(body.streamConfig) : null;
        if (body.coverUrl !== undefined) updateData.coverUrl = body.coverUrl;
        if (body.announcement !== undefined) updateData.announcement = body.announcement;

        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ error: 'No valid fields provided for update' }, { status: 400 });
        }

        updateData.updatedAt = new Date().toISOString();

        const db = getDb();
        const [updatedPlayer] = await db.update(players)
            .set(updateData)
            .where(eq(players.pId, pId))
            .returning();

        if (!updatedPlayer) {
            return NextResponse.json({ error: 'Player not found' }, { status: 404 });
        }

        cache.delete(CACHE_KEYS.PLAYER_LIST);
        cache.delete(CACHE_KEYS.PLAYER_CONFIGS);
        cache.delete(CACHE_KEYS.PLAYER(pId));

        const { coverImage, ...playerWithoutImage } = updatedPlayer;
        return NextResponse.json(playerWithoutImage);
    } catch (error) {
        console.error('Error patching player by pId:', error);
        return NextResponse.json({ error: 'Failed to patch player' }, { status: 500 });
    }
}
