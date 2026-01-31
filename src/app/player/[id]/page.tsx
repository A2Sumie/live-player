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
  try {
    console.log(`[PlayerPage] Fetching info for ID: ${resolvedParams.id}`);
    const player = await getPlayer(resolvedParams.id);

    if (!player) {
      console.error(`[PlayerPage] ❌ Player config not found for ID: ${resolvedParams.id}`);
      notFound();
    }

    // Assuming player.streamUrl exists based on the new code structure
    // If player.url was the original field, it needs to be mapped to streamUrl or adjusted.
    // For now, I'll assume player.streamUrl is the correct field name based on the provided edit.
    console.log(`[PlayerPage] ✅ Found player: ${player.name}, URL: ${player.url}`);

    if (!player.url) {
      console.error(`[PlayerPage] ❌ ID ${resolvedParams.id} has empty url!`);
      throw new Error("Stream URL is missing in database configuration");
    }

    const { signStreamUrl } = await import('@/lib/stream-auth');
    const signedUrl = signStreamUrl(player.url);
    console.log(`[PlayerPage] 🔏 Signed URL: ${signedUrl}`);

    // Update player object with signed URL
    const signedPlayer = { ...player, url: signedUrl };

    return (
      <div className="min-h-screen bg-black">
        <PlayerComponent player={signedPlayer} />
      </div>
    );
  } catch (e: any) {
    console.error(`[PlayerPage] 💥 Critical Error: ${e.message}`, e);
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="p-4 border border-red-500 rounded bg-red-900/50">
          <h1 className="text-xl font-bold mb-2">Error Loading Player</h1>
          <p className="font-mono text-sm">{e?.message || "Unknown Error"}</p>
        </div>
      </div>
    );
  }
}