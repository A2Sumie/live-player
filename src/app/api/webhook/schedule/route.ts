import { NextRequest, NextResponse } from 'next/server';
import { getDb, schedules } from '@/lib/db';

/**
 * POST /api/webhook/schedule - Webhook for external systems
 * 
 * Example from tweet crawler:
 * {
 *   "title": "转播推特空间",
 *   "description": "XXX的直播",
 *   "scheduleType": "stream",
 *   "executionTime": "2026-01-27T20:00:00Z",
 *   "payload": {
 *     "type": "start_network_stream",
 *     "playerId": "web-1",
 *     "source": "https://twitter.com/i/spaces/...",
 *     "name": "XXX推特空间"
 *   },
 *   "apiKey": "your-api-key"
 * }
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json() as {
            title: string;
            description?: string;
            scheduleType: string;
            executionTime: string;
            recurrence?: string;
            payload?: any;
            apiKey?: string;
        };

        // API key验证（可选，后续配置）
        const apiKey = body.apiKey || request.headers.get('X-API-Key');
        const expectedKey = process.env.WEBHOOK_API_KEY;

        if (expectedKey && apiKey !== expectedKey) {
            return NextResponse.json(
                { error: 'Invalid API key' },
                { status: 401 }
            );
        }

        // 验证必填字段
        if (!body.title || !body.scheduleType || !body.executionTime) {
            return NextResponse.json(
                { error: 'title, scheduleType, and executionTime are required' },
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
            createdBy: 'webhook', // 标记为webhook创建
            status: 'pending',
            updatedAt: new Date().toISOString()
        }).returning();

        return NextResponse.json({
            success: true,
            scheduleId: schedule.id,
            schedule: schedule
        });
    } catch (error) {
        console.error('Error processing webhook:', error);
        return NextResponse.json(
            { error: 'Failed to create schedule' },
            { status: 500 }
        );
    }
}
