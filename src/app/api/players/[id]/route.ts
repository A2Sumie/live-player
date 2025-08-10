import { NextRequest, NextResponse } from 'next/server';
import { getDb, players } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { eq, and, ne } from 'drizzle-orm';
import { cache, CACHE_KEYS } from '@/lib/cache';

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    
    if (!user || user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Permission denied' },
        { status: 403 }
      );
    }

    const { name, pId, description, url, coverUrl, announcement } = await request.json() as any;
    const params = await context.params;
    const playerId = parseInt(params.id);

    if (isNaN(playerId)) {
      return NextResponse.json(
        { error: 'Invalid Player ID' },
        { status: 400 }
      );
    }

    if (!name || !pId || !url) {
      return NextResponse.json(
        { error: 'Name, ID and URL are required' },
        { status: 400 }
      );
    }

    const db = getDb();
    
    // Check if another player with the same pId exists (excluding current player)
    const existingPlayer = await db.select()
      .from(players)
      .where(and(eq(players.pId, pId), ne(players.id, playerId)))
      .limit(1);

    if (existingPlayer.length > 0) {
      return NextResponse.json(
        { error: 'Player ID already exists' },
        { status: 400 }
      );
    }

    const [player] = await db.update(players)
      .set({
        name,
        pId,
        description: description || null,
        url,
        coverUrl: coverUrl || null,
        announcement: announcement || null,
        updatedAt: new Date().toISOString()
      })
      .where(eq(players.id, playerId))
      .returning();

    cache.delete(CACHE_KEYS.PLAYER_LIST);
    cache.delete(CACHE_KEYS.PLAYER(pId));
    // Convert binary coverImage to base64 for frontend use
    const playerWithBase64 = {
      ...player,
      coverImageBase64: player.coverImage ? 
        `data:image/jpeg;base64,${Buffer.from(player.coverImage as ArrayBuffer).toString('base64')}` : 
        null
    };

    return NextResponse.json(playerWithBase64);
  } catch (error) {
    console.error('Error updating player:', error);
    return NextResponse.json(
      { error: 'Failed to update player' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    
    if (!user || user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Permission denied' },
        { status: 403 }
      );
    }

    const params = await context.params;
    const playerId = parseInt(params.id);

    if (isNaN(playerId)) {
      return NextResponse.json(
        { error: 'Invalid Player ID' },
        { status: 400 }
      );
    }

    const db = getDb();
    
    const [existingPlayer] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
    
    await db.delete(players).where(eq(players.id, playerId));

    if (existingPlayer) {
      cache.delete(CACHE_KEYS.PLAYER_LIST);
      cache.delete(CACHE_KEYS.PLAYER(existingPlayer.pId));
    }

    return NextResponse.json({ message: 'Player deleted successfully' });
  } catch (error) {
    console.error('Error deleting player:', error);
    return NextResponse.json(
      { error: 'Failed to delete player' },
      { status: 500 }
    );
  }
}