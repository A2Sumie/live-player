import { notFound } from 'next/navigation';
import { getDb, players, type Player } from '@/lib/db';
import PlayerComponent from '@/components/Player';
import { eq } from 'drizzle-orm';
import { cache as memoryCache, CACHE_KEYS, CACHE_TTL } from '@/lib/cache';
import { cache } from 'react';

interface PlayerPageProps {
  params: Promise<{ id: string }>;
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
    console.error('Error fetching player:', error);
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

export default async function PlayerPage({ params }: PlayerPageProps) {
  const resolvedParams = await params;
  const player = await getPlayer(resolvedParams.id);

  if (!player) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-black">
      <PlayerComponent player={player} />
    </div>
  );
}