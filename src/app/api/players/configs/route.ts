import { NextResponse } from 'next/server';
import { cache, CACHE_KEYS, CACHE_TTL } from '@/lib/cache';
import { listPlayerRuntimeRecords } from '@/lib/player-runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const playerConfigs = await cache.getOrFetch(
            CACHE_KEYS.PLAYER_CONFIGS,
            async () => {
                const records = await listPlayerRuntimeRecords();
                return records.map(({ player, runtime }) => ({
                    id: player.id,
                    pId: player.pId,
                    name: player.name,
                    streamConfig: player.streamConfig,
                    runtimeStreamConfig: runtime?.streamConfig ?? null,
                    runtimeStatus: runtime?.status ?? null,
                    runtimeUpdatedAt: runtime?.updatedAt ?? null,
                }));
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
