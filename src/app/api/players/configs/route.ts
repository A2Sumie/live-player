import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserFromRequestOrInternalAdmin } from '@/lib/auth';
import { cache, CACHE_KEYS, CACHE_TTL } from '@/lib/cache';
import { getEffectiveStreamConfig, getPlayerConfigsVersion, listPlayerRuntimeRecords } from '@/lib/player-runtime';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const user = await getCurrentUserFromRequestOrInternalAdmin(request);
        if (!user || user.role !== 'admin') {
            return NextResponse.json(
                { error: 'Permission denied' },
                { status: 403 }
            );
        }

        const version = await cache.getOrFetch(
            CACHE_KEYS.PLAYER_CONFIGS_VERSION,
            async () => getPlayerConfigsVersion(),
            CACHE_TTL.PLAYER_CONFIGS_VERSION
        );

        const playerConfigs = await cache.getOrFetch(
            CACHE_KEYS.PLAYER_CONFIGS,
            async () => {
                const records = await listPlayerRuntimeRecords();
                return records.map((record) => {
                    const { player, runtime } = record;
                    return {
                        id: player.id,
                        pId: player.pId,
                        name: player.name,
                        streamConfig: getEffectiveStreamConfig(record),
                        editorialStreamConfig: player.streamConfig,
                        runtimeStreamConfig: runtime?.streamConfig ?? null,
                        runtimeStatus: runtime?.status ?? null,
                        runtimeUpdatedAt: runtime?.updatedAt ?? null,
                    };
                });
            },
            CACHE_TTL.PLAYER_LIST
        );

        return NextResponse.json(playerConfigs, {
            headers: {
                ETag: `"${version.version}"`,
                'Cache-Control': 'private, no-store',
            },
        });
    } catch (error) {
        console.error('Error fetching player configs:', error);
        return NextResponse.json(
            { error: 'Failed to fetch player configs' },
            { status: 500 }
        );
    }
}
