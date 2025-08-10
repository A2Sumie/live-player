import { NextRequest, NextResponse } from 'next/server';
import { getDb, players } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { eq } from 'drizzle-orm';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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

    const formData = await request.formData();
    const file = formData.get('cover') as File;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Check file type
    if (!file.type.startsWith('image/')) {
      return NextResponse.json(
        { error: 'File must be an image' },
        { status: 400 }
      );
    }

    // Check file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'File size must be less than 5MB' },
        { status: 400 }
      );
    }

    const buffer = await file.arrayBuffer();
    const imageData = new Uint8Array(buffer);

    const db = getDb();
    
    // Update player with cover image binary data
    const [player] = await db.update(players)
      .set({
        coverImage: imageData,
        updatedAt: new Date().toISOString()
      })
      .where(eq(players.id, playerId))
      .returning();

    if (!player) {
      return NextResponse.json(
        { error: 'Player not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ 
      message: 'Cover image uploaded successfully',
      fileSize: file.size,
      fileType: file.type 
    });
  } catch (error) {
    console.error('Error uploading cover image:', error);
    return NextResponse.json(
      { error: 'Failed to upload cover image' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const params = await context.params;
    const playerId = parseInt(params.id);

    if (isNaN(playerId)) {
      return NextResponse.json(
        { error: 'Invalid Player ID' },
        { status: 400 }
      );
    }

    const db = getDb();
    const [player] = await db.select({ 
      coverImage: players.coverImage 
    }).from(players).where(eq(players.id, playerId)).limit(1);

    if (!player || !player.coverImage) {
      return NextResponse.json(
        { error: 'Cover image not found' },
        { status: 404 }
      );
    }

    // Return the binary data as image response
    return new NextResponse(Buffer.from(player.coverImage as ArrayBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg', // Default to JPEG, could be enhanced to detect type
        'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
      },
    });
  } catch (error) {
    console.error('Error retrieving cover image:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve cover image' },
      { status: 500 }
    );
  }
}