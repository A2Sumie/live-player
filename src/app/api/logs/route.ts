import { NextRequest, NextResponse } from 'next/server';
import { getDb, systemLogs } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { desc } from 'drizzle-orm';



export async function GET(request: NextRequest) {
    try {
        const user = await getCurrentUser();

        if (!user || user.role !== 'admin') {
            return NextResponse.json(
                { error: 'Permission denied' },
                { status: 403 }
            );
        }

        const { searchParams } = new URL(request.url);
        const limit = parseInt(searchParams.get('limit') || '50');

        const db = getDb();
        const logs = await db.select()
            .from(systemLogs)
            .orderBy(desc(systemLogs.createdAt))
            .limit(limit);

        return NextResponse.json(logs);
    } catch (error) {
        console.error('Error fetching logs:', error);
        return NextResponse.json(
            { error: 'Failed to fetch logs' },
            { status: 500 }
        );
    }
}
