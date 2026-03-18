
import { NextRequest, NextResponse } from 'next/server';
import { getDb, players } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { eq } from 'drizzle-orm';
import { cache, CACHE_KEYS } from '@/lib/cache';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    try {
        const user = await getCurrentUser();

        if (!user || user.role !== 'admin') {
            // Allow if API Key is present? For now simpler to rely on Cookie auth of the browser
            // If extension runs in context of logged-in admin, it works.
            return NextResponse.json(
                { error: 'Permission denied' },
                { status: 403 }
            );
        }

        const { action, streamConfig, metadata } = await request.json() as any;
        const params = await context.params;

        // Support 'relay' literal or numeric ID
        let playerId: number;
        let pidStr = params.id;

        const db = getDb();

        // Find player by ID or pId
        let targetPlayer;

        // If ID is numeric, try finding by internal ID first
        if (!isNaN(parseInt(pidStr))) {
            [targetPlayer] = await db.select().from(players).where(eq(players.id, parseInt(pidStr))).limit(1);
        }

        // If not found or not numeric, try finding by pId (e.g. 'relay')
        if (!targetPlayer) {
            [targetPlayer] = await db.select().from(players).where(eq(players.pId, pidStr)).limit(1);
        }

        if (!targetPlayer) {
            return NextResponse.json({ error: 'Player not found' }, { status: 404 });
        }

        playerId = targetPlayer.id;

        if (!action) {
            return NextResponse.json({ error: 'Action required' }, { status: 400 });
        }

        const updates: any = {
            updatedAt: new Date().toISOString()
        };

        if (action === 'stop') {
            // Clear Config
            updates.streamConfig = "{}"; // Empty JSON Object
            console.log(`[API] Stopping Relay for Player ${targetPlayer.name} (${playerId})`);
        }
        else if (action === 'start' || action === 'sync') {
            if (!streamConfig) {
                return NextResponse.json({ error: 'streamConfig required for start/sync' }, { status: 400 });
            }
            updates.streamConfig = JSON.stringify(streamConfig);

            // Optional Metadata Sync
            if (metadata) {
                if (metadata.title) updates.name = metadata.title; // Update Player Name? Maybe risky if auto?
                // Let's only update non-critical info or description
                if (metadata.coverUrl) updates.coverUrl = metadata.coverUrl;
            }
            console.log(`[API] Syncing/Starting Relay for Player ${targetPlayer.name} (${playerId})`);
        } else {
            return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
        }

        // Execute Update
        const [updatedPlayer] = await db.update(players)
            .set(updates)
            .where(eq(players.id, playerId))
            .returning();

        // Cache Invalidation
        cache.delete(CACHE_KEYS.PLAYER_LIST);
        cache.delete(CACHE_KEYS.PLAYER(targetPlayer.pId));

        return NextResponse.json({
            success: true,
            message: `Relay ${action} successful`,
            player: { pId: updatedPlayer.pId, name: updatedPlayer.name, active: action !== 'stop' }
        });

    } catch (error) {
        console.error('Error in relay control:', error);
        return NextResponse.json(
            { error: 'Internal Server Error' },
            { status: 500 }
        );
    }
}
