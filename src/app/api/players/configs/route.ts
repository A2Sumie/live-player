import { NextResponse } from 'next/server';
import { getDb, players } from '@/lib/db';
import { desc } from 'drizzle-orm';
import { cache, CACHE_KEYS, CACHE_TTL } from '@/lib/cache';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const playerConfigs = await cache.getOrFetch(
            CACHE_KEYS.PLAYER_CONFIGS,
            async () => {
                const db = getDb();
                return await db.select({
                    id: players.id,
                    pId: players.pId,
                    name: players.name,
                    streamConfig: players.streamConfig
                }).from(players).orderBy(desc(players.updatedAt));
            },
            CACHE_TTL.PLAYER_LIST
        );

        return NextResponse.json(playerConfigs);
    } catch (error) {
        console.error('Error fetching player configs:', error);
        return NextResponse.json(
            { error: 'Failed to fetch player configs' },
            { status: 500 }
        );
    }
}
