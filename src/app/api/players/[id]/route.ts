import { NextRequest, NextResponse } from 'next/server';
import { getDb, playerRuntime, players } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { eq, and, ne } from 'drizzle-orm';
import { serializeStreamConfig } from '@/lib/stream-config';
import { getPlayerRuntimeRecordById, invalidatePlayerCaches } from '@/lib/player-runtime';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const params = await context.params;
    const playerId = parseInt(params.id);

    if (isNaN(playerId)) {
      return NextResponse.json({ error: 'Invalid Player ID' }, { status: 400 });
    }

    const db = getDb();
    const record = await getPlayerRuntimeRecordById(playerId, db);

    if (!record) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 });
    }

    const { player, runtime } = record;
    const { coverImage, ...playerWithoutImage } = player;
    return NextResponse.json({
      ...playerWithoutImage,
      runtimeName: runtime?.name ?? null,
      runtimeDescription: runtime?.description ?? null,
      runtimeUrl: runtime?.url ?? null,
      runtimeCoverUrl: runtime?.coverUrl ?? null,
      runtimeStreamConfig: runtime?.streamConfig ?? null,
      runtimeStatus: runtime?.status ?? null,
      runtimeLastError: runtime?.lastError ?? null,
      runtimeLastSeenAt: runtime?.lastSeenAt ?? null,
      runtimeUpdatedAt: runtime?.updatedAt ?? null,
    });
  } catch (error) {
    console.error('Error fetching player:', error);
    return NextResponse.json({ error: 'Failed to fetch player' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();

    if (!user || user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Permission denied' },
        { status: 403 }
      );
    }

    const { name, pId, description, url, coverUrl, announcement, streamConfig, sources } = await request.json() as any;
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

    let serializedStreamConfig: string | null = null;
    try {
      serializedStreamConfig = serializeStreamConfig(streamConfig);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Invalid streamConfig' },
        { status: 400 }
      );
    }

    const db = getDb();

    const currentRecord = await getPlayerRuntimeRecordById(playerId, db);
    if (!currentRecord) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 });
    }

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
        streamConfig: serializedStreamConfig,
        sources: sources ? sources : null, // Assuming JSON input
        updatedAt: new Date().toISOString()
      })
      .where(eq(players.id, playerId))
      .returning();

    invalidatePlayerCaches(currentRecord.player.pId, pId);
    // Convert binary coverImage to array for JSON serialization
    // [MODIFIED] Exclude coverImage to save bandwidth
    const { coverImage: _ignored, ...playerWithoutImage } = player;
    const playerWithArrayImage = playerWithoutImage;

    return NextResponse.json(playerWithArrayImage);
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

    const existingRecord = await getPlayerRuntimeRecordById(playerId, db);

    await db.delete(playerRuntime).where(eq(playerRuntime.playerId, playerId));
    await db.delete(players).where(eq(players.id, playerId));

    if (existingRecord) {
      invalidatePlayerCaches(existingRecord.player.pId);
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
