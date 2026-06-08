import { NextRequest, NextResponse } from 'next/server';
import { getDb, schedules } from '@/lib/db';
import {
    readJsonBodyWithLimit,
    requireApiKeyOrAdmin,
    oversizedBodyResponse,
} from '@/lib/request-security';

const WEBHOOK_BODY_LIMIT_BYTES = 32 * 1024;

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
        const body = await readJsonBodyWithLimit<{
            title: string;
            description?: string;
            externalKey?: string;
            scheduleType: string;
            executionTime: string;
            recurrence?: string;
            payload?: any;
            apiKey?: string;
        }>(request, WEBHOOK_BODY_LIMIT_BYTES);

        const authFailure = await requireApiKeyOrAdmin(
            request,
            [process.env.WEBHOOK_API_KEY, process.env.INTERNAL_API_SECRET],
            body.apiKey
        );
        if (authFailure) {
            return authFailure;
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
        const now = new Date().toISOString();
        const payload = {
            title: body.title,
            description: body.description || null,
            externalKey: body.externalKey || null,
            scheduleType: body.scheduleType,
            executionTime: body.executionTime,
            recurrence: body.recurrence || null,
            payload: body.payload ? JSON.stringify(body.payload) : null,
            createdBy: 'webhook',
            status: 'pending',
            updatedAt: now,
        };

        let schedule;
        if (body.externalKey) {
            const [upserted] = await db
                .insert(schedules)
                .values(payload)
                .onConflictDoUpdate({
                    target: schedules.externalKey,
                    set: payload,
                })
                .returning();
            schedule = upserted;
        } else {
            const [created] = await db.insert(schedules).values(payload).returning();
            schedule = created;
        }

        return NextResponse.json({
            success: true,
            scheduleId: schedule.id,
            schedule: schedule
        });
    } catch (error) {
        const bodyError = oversizedBodyResponse(error);
        if (bodyError) {
            return bodyError;
        }

        console.error('Error processing webhook:', error);
        return NextResponse.json(
            { error: 'Failed to create schedule' },
            { status: 500 }
        );
    }
}
