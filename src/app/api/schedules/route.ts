import { NextRequest, NextResponse } from 'next/server';
import { getDb, schedules } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { desc, eq, gte, and } from 'drizzle-orm';

/**
 * GET /api/schedules - 获取日程列表（需要管理员权限）
 * Query params: 
 *   - type: 按类型筛选
 *   - status: 按状态筛选
 *   - upcoming: true只显示未来的日程
 */
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
        const type = searchParams.get('type');
        const status = searchParams.get('status');
        const upcoming = searchParams.get('upcoming') === 'true';

        const db = getDb();

        // 构建查询条件
        const conditions = [];

        if (type) {
            conditions.push(eq(schedules.scheduleType, type));
        }

        if (status) {
            conditions.push(eq(schedules.status, status));
        }

        if (upcoming) {
            conditions.push(gte(schedules.executionTime, new Date().toISOString()));
        }

        // 执行查询
        let scheduleList;
        if (conditions.length > 0) {
            scheduleList = await db
                .select()
                .from(schedules)
                .where(and(...conditions))
                .orderBy(desc(schedules.executionTime))
                .limit(100);
        } else {
            scheduleList = await db
                .select()
                .from(schedules)
                .orderBy(desc(schedules.executionTime))
                .limit(100);
        }

        return NextResponse.json(scheduleList);
    } catch (error) {
        console.error('Error fetching schedules:', error);
        return NextResponse.json(
            { error: 'Failed to fetch schedules' },
            { status: 500 }
        );
    }
}

/**
 * POST /api/schedules - 创建新日程（需要管理员权限）
 */
export async function POST(request: NextRequest) {
    try {
        const user = await getCurrentUser();

        if (!user || user.role !== 'admin') {
            return NextResponse.json(
                { error: 'Permission denied' },
                { status: 403 }
            );
        }

        const body = await request.json() as {
            title: string;
            description?: string;
            scheduleType: string;
            executionTime: string;
            recurrence?: string;
            payload?: any;
        };

        if (!body.title || !body.scheduleType || !body.executionTime) {
            return NextResponse.json(
                { error: 'Title, scheduleType, and executionTime are required' },
                { status: 400 }
            );
        }

        // 验证执行时间
        const execTime = new Date(body.executionTime);
        if (isNaN(execTime.getTime())) {
            return NextResponse.json(
                { error: 'Invalid executionTime format' },
                { status: 400 }
            );
        }

        const db = getDb();
        const [schedule] = await db.insert(schedules).values({
            title: body.title,
            description: body.description || null,
            scheduleType: body.scheduleType,
            executionTime: body.executionTime,
            recurrence: body.recurrence || null,
            payload: body.payload ? JSON.stringify(body.payload) : null,
            createdBy: user.username,
            status: 'pending',
            updatedAt: new Date().toISOString()
        }).returning();

        return NextResponse.json(schedule);
    } catch (error) {
        console.error('Error creating schedule:', error);
        return NextResponse.json(
            { error: 'Failed to create schedule' },
            { status: 500 }
        );
    }
}
