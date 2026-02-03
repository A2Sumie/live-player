import { notFound } from 'next/navigation';
import { getDb, players, type Player } from '@/lib/db';

import { eq } from 'drizzle-orm';

import PlayerWrapper from '@/components/PlayerWrapper';
import { cache as memoryCache, CACHE_KEYS, CACHE_TTL } from '@/lib/cache';
import { cache } from 'react';
import { logger } from '@/lib/logger';
import { signStreamUrl } from '@/lib/stream-auth';

interface PlayerPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const getPlayer = cache(async (pId: string): Promise<Player | null> => {
  try {
    const player = await memoryCache.getOrFetch(
      CACHE_KEYS.PLAYER(pId),
      async () => {
        const db = getDb();
        const [player] = await db.select().from(players).where(eq(players.pId, pId)).limit(1);
        return player || null;
      },
      CACHE_TTL.PLAYER
    );

    return player;
  } catch (error) {
    logger.error('Error fetching player', error, 'PlayerPage:getPlayer');
    return null;
  }
});

export async function generateMetadata({ params }: PlayerPageProps) {
  const resolvedParams = await params;
  const player = await getPlayer(resolvedParams.id);

  if (!player) {
    return {
      title: 'Player Not Found',
    };
  }

  return {
    title: `${player.name}`,
    description: player.description || `watch ${player.name}`,
  };
}

export default async function PlayerPage({ params, searchParams }: PlayerPageProps) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const isDebug = resolvedSearchParams?.debug === '1';

  try {
    if (isDebug) logger.info(`Fetching info for ID: ${resolvedParams.id}`, null, 'PlayerPage');
    const player = await getPlayer(resolvedParams.id);

    if (!player) {
      logger.error(`Player config not found for ID: ${resolvedParams.id}`, null, 'PlayerPage');
      notFound();
    }

    if (isDebug) logger.info(`Found player: ${player.name}, URL: ${player.url}`, null, 'PlayerPage');

    if (!player.url) {
      const msg = `ID ${resolvedParams.id} has empty url!`;
      logger.error(msg, null, 'PlayerPage');
      throw new Error("Stream URL is missing in database configuration");
    }



    const signedUrl = signStreamUrl(player.url);
    if (isDebug) logger.info(`Signed URL: ${signedUrl}`, null, 'PlayerPage');

    // Update player object with signed URL
    const signedPlayer = { ...player, url: signedUrl };

    return (
      <div className="min-h-screen bg-black">
        <PlayerWrapper player={signedPlayer} debug={isDebug} />
      </div>
    );
  } catch (e: any) {
    logger.error(`Critical Error loading player ${resolvedParams.id}`, e, 'PlayerPage');
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="p-4 border border-red-500 rounded bg-red-900/50">
          <h1 className="text-xl font-bold mb-2">Error Loading Player</h1>
          <p className="font-mono text-sm">{e?.message || "Unknown Error"}</p>
          {isDebug && <pre className="mt-2 text-xs opacity-50 whitespace-pre-wrap">{e?.stack}</pre>}
        </div>
      </div>
    );
  }
}