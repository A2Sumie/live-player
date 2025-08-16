import { notFound } from 'next/navigation';
import { getDb, players } from '@/lib/db';
import PlayerComponent from '@/components/Player';
import { eq } from 'drizzle-orm';
import { cache, CACHE_KEYS, CACHE_TTL } from '@/lib/cache';

interface PlayerPageProps {
  params: Promise<{ id: string }>;
}

async function getPlayer(pId: string) {
  try {
    return await cache.getOrFetch(
      CACHE_KEYS.PLAYER(pId),
      async () => {
        const db = getDb();
        const [player] = await db.select().from(players).where(eq(players.pId, pId)).limit(1);
        return player || null;
      },
      CACHE_TTL.PLAYER
    );
  } catch (error) {
    console.error('Error fetching player:', error);
    return null;
  }
}

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