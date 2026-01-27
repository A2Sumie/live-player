import { NextResponse } from 'next/server';
import { getDb, schedules } from '@/lib/db';
import { gte, and, eq } from 'drizzle-orm';

/**
 * GET /api/schedules/public - 公开的只读日程列表
 * 不需要认证，用于公开显示未来的日程
 */
export async function GET() {
    try {
        const db = getDb();

        // 只返回未来的、pending状态的日程
        const scheduleList = await db
            .select({
                id: schedules.id,
                title: schedules.title,
                description: schedules.description,
                scheduleType: schedules.scheduleType,
                executionTime: schedules.executionTime,
                createdAt: schedules.createdAt
            })
            .from(schedules)
            .where(
                and(
                    gte(schedules.executionTime, new Date().toISOString()),
                    eq(schedules.status, 'pending')
                )
            )
            .orderBy(schedules.executionTime)
            .limit(50);

        return NextResponse.json(scheduleList);
    } catch (error) {
        console.error('Error fetching public schedules:', error);
        return NextResponse.json(
            { error: 'Failed to fetch schedules' },
            { status: 500 }
        );
    }
}
