import { NextRequest, NextResponse } from 'next/server';
import { getDb, players } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { desc, eq } from 'drizzle-orm';
import { cache, CACHE_KEYS, CACHE_TTL } from '@/lib/cache';

export async function GET() {
  try {
    const playerList = await cache.getOrFetch(
      CACHE_KEYS.PLAYER_LIST,
      async () => {
        const db = getDb();
        return await db.select().from(players).orderBy(desc(players.updatedAt));
      },
      CACHE_TTL.PLAYER_LIST
    );
    
    // Convert binary coverImage to array for JSON serialization
    const playersWithArrayImages = playerList.map(player => ({
      ...player,
      coverImage: player.coverImage ? Array.from(new Uint8Array(player.coverImage as ArrayBuffer)) : null
    }));
    
    return NextResponse.json(playersWithArrayImages);
  } catch (error) {
    console.error('Error fetching players:', error);
    return NextResponse.json(
      { error: 'Failed to fetch player list' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    
    if (!user || user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Permission denied' },
        { status: 403 }
      );
    }

    const { name, pId, description, url, coverUrl, announcement } = await request.json() as any;

    if (!name || !pId || !url) {
      return NextResponse.json(
        { error: 'Name, ID and URL are required' },
        { status: 400 }
      );
    }

    const db = getDb();
    
    // Check if player with pId already exists
    const existingPlayer = await db.select().from(players).where(eq(players.pId, pId)).limit(1);

    if (existingPlayer.length > 0) {
      return NextResponse.json(
        { error: 'Player ID already exists' },
        { status: 400 }
      );
    }

    const [player] = await db.insert(players).values({
      name,
      pId,
      description: description || null,
      url,
      coverUrl: coverUrl || null,
      announcement: announcement || null,
      updatedAt: new Date().toISOString()
    }).returning();

    // Convert binary coverImage to array for JSON serialization
    const playerWithArrayImage = {
      ...player,
      coverImage: player.coverImage ? Array.from(new Uint8Array(player.coverImage as ArrayBuffer)) : null
    };

    return NextResponse.json(playerWithArrayImage);
  } catch (error) {
    console.error('Error creating player:', error);
    return NextResponse.json(
      { error: 'Failed to create player' },
      { status: 500 }
    );
  }
}