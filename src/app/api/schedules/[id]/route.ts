import { NextRequest, NextResponse } from 'next/server';
import { getDb, schedules } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { eq } from 'drizzle-orm';

/**
 * GET /api/schedules/:id - 获取单个日程详情
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getCurrentUser();

        if (!user || user.role !== 'admin') {
            return NextResponse.json(
                { error: 'Permission denied' },
                { status: 403 }
            );
        }

        const { id } = await params;
        const scheduleId = parseInt(id);

        if (isNaN(scheduleId)) {
            return NextResponse.json(
                { error: 'Invalid schedule ID' },
                { status: 400 }
            );
        }

        const db = getDb();
        const [schedule] = await db
            .select()
            .from(schedules)
            .where(eq(schedules.id, scheduleId))
            .limit(1);

        if (!schedule) {
            return NextResponse.json(
                { error: 'Schedule not found' },
                { status: 404 }
            );
        }

        return NextResponse.json(schedule);
    } catch (error) {
        console.error('Error fetching schedule:', error);
        return NextResponse.json(
            { error: 'Failed to fetch schedule' },
            { status: 500 }
        );
    }
}

/**
 * PUT /api/schedules/:id - 更新日程
 */
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getCurrentUser();

        if (!user || user.role !== 'admin') {
            return NextResponse.json(
                { error: 'Permission denied' },
                { status: 403 }
            );
        }

        const { id } = await params;
        const scheduleId = parseInt(id);

        if (isNaN(scheduleId)) {
            return NextResponse.json(
                { error: 'Invalid schedule ID' },
                { status: 400 }
            );
        }

        const body = await request.json() as {
            title?: string;
            description?: string;
            executionTime?: string;
            recurrence?: string;
            status?: string;
            payload?: any;
        };

        const db = getDb();

        // 检查日程是否存在
        const [existing] = await db
            .select()
            .from(schedules)
            .where(eq(schedules.id, scheduleId))
            .limit(1);

        if (!existing) {
            return NextResponse.json(
                { error: 'Schedule not found' },
                { status: 404 }
            );
        }

        // 构建更新数据
        const updateData: any = {
            updatedAt: new Date().toISOString()
        };

        if (body.title) updateData.title = body.title;
        if (body.description !== undefined) updateData.description = body.description;
        if (body.executionTime) updateData.executionTime = body.executionTime;
        if (body.recurrence !== undefined) updateData.recurrence = body.recurrence;
        if (body.status) updateData.status = body.status;
        if (body.payload) updateData.payload = JSON.stringify(body.payload);

        // 更新日程
        await db
            .update(schedules)
            .set(updateData)
            .where(eq(schedules.id, scheduleId));

        // 返回更新后的日程
        const [updated] = await db
            .select()
            .from(schedules)
            .where(eq(schedules.id, scheduleId))
            .limit(1);

        return NextResponse.json(updated);
    } catch (error) {
        console.error('Error updating schedule:', error);
        return NextResponse.json(
            { error: 'Failed to update schedule' },
            { status: 500 }
        );
    }
}

/**
 * DELETE /api/schedules/:id - 删除日程
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getCurrentUser();

        if (!user || user.role !== 'admin') {
            return NextResponse.json(
                { error: 'Permission denied' },
                { status: 403 }
            );
        }

        const { id } = await params;
        const scheduleId = parseInt(id);

        if (isNaN(scheduleId)) {
            return NextResponse.json(
                { error: 'Invalid schedule ID' },
                { status: 400 }
            );
        }

        const db = getDb();

        // 检查日程是否存在
        const [existing] = await db
            .select()
            .from(schedules)
            .where(eq(schedules.id, scheduleId))
            .limit(1);

        if (!existing) {
            return NextResponse.json(
                { error: 'Schedule not found' },
                { status: 404 }
            );
        }

        // 删除日程
        await db.delete(schedules).where(eq(schedules.id, scheduleId));

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error deleting schedule:', error);
        return NextResponse.json(
            { error: 'Failed to delete schedule' },
            { status: 500 }
        );
    }
}
