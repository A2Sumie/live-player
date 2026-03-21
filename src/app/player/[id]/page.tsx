import { notFound } from 'next/navigation';
import PlayerWrapper from '@/components/PlayerWrapper';
import { cache as memoryCache, CACHE_KEYS, CACHE_TTL } from '@/lib/cache';
import { cache } from 'react';
import { logger } from '@/lib/logger';
import { signStreamUrl } from '@/lib/stream-auth';
import { getPlayerViewByPid, type PlayerView } from '@/lib/player-runtime';

interface PlayerPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const getPlayer = cache(async (pId: string): Promise<PlayerView | null> => {
  try {
    const player = await memoryCache.getOrFetch(
      CACHE_KEYS.PLAYER(pId),
      async () => getPlayerViewByPid(pId),
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
      title: '频道不存在',
    };
  }

  // Strip §-obfuscation prefix for metadata (tab title doesn't need real name)
  let displayName = player.name;
  const sepIdx = displayName.indexOf('§');
  if (sepIdx !== -1) {
    const prefix = displayName.slice(0, sepIdx).trim();
    // If it's just '§...', use a generic name; otherwise use the prefix like '【ON AIR】'
    displayName = prefix ? `${prefix} ${player.pId}` : `频道 ${player.pId}`;
  }

  return {
    title: `${displayName}`,
    description: player.description || `观看 ${displayName}`,
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
      throw new Error('数据库配置中缺少播放地址');
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
          <h1 className="text-xl font-bold mb-2">频道加载失败</h1>
          <p className="font-mono text-sm">{e?.message || '未知错误'}</p>
          {isDebug && <pre className="mt-2 text-xs opacity-50 whitespace-pre-wrap">{e?.stack}</pre>}
        </div>
      </div>
    );
  }
}
