import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserFromRequestOrInternalAdmin } from '@/lib/auth';
import { cache, CACHE_KEYS, CACHE_TTL } from '@/lib/cache';
import { getPlayerConfigsVersion } from '@/lib/player-runtime';

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

    const etag = `"${version.version}"`;
    const ifNoneMatch = request.headers.get('if-none-match')?.trim();
    if (ifNoneMatch && ifNoneMatch === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: etag,
          'Cache-Control': 'private, no-store',
        },
      });
    }

    return NextResponse.json(version, {
      headers: {
        ETag: etag,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('Error fetching player config version:', error);
    return NextResponse.json(
      { error: 'Failed to fetch player config version' },
      { status: 500 }
    );
  }
}
