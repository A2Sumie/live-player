import { NextRequest, NextResponse } from 'next/server';
import { executeSchedules } from '@/lib/scheduler';
import {
    readRequestTextWithLimit,
    requireApiKeyOrAdmin,
    oversizedBodyResponse,
} from '@/lib/request-security';

const EXECUTION_BODY_LIMIT_BYTES = 8 * 1024;

type ExecuteRequestBody = {
    apiKey?: string;
    scheduleId?: number | string;
    externalKey?: string;
    limit?: number | string;
    force?: boolean | string;
};

/**
 * Protected one-shot schedule execution endpoint for external integrations.
 * By default it executes one due pending schedule; pass a scheduleId/externalKey
 * or an explicit limit when an integration needs a larger controlled batch.
 */
export async function GET(request: NextRequest) {
    return executeFromRequest(request);
}

export async function POST(request: NextRequest) {
    try {
        const rawBody = await readRequestTextWithLimit(request, EXECUTION_BODY_LIMIT_BYTES);
        const body = rawBody.trim() ? JSON.parse(rawBody) as ExecuteRequestBody : {};
        return executeFromRequest(request, body);
    } catch (error) {
        const bodyError = oversizedBodyResponse(error);
        if (bodyError) {
            return bodyError;
        }
        console.error('Cron execution request error:', error);
        return NextResponse.json(
            { error: 'Invalid execution request' },
            { status: 400 }
        );
    }
}

async function executeFromRequest(request: NextRequest, body: ExecuteRequestBody = {}) {
    try {
        const authFailure = await requireApiKeyOrAdmin(
            request,
            [process.env.SCHEDULE_EXECUTION_KEY, process.env.WEBHOOK_API_KEY],
            body.apiKey
        );
        if (authFailure) {
            return authFailure;
        }

        const scheduleIdInput = body.scheduleId ?? request.nextUrl.searchParams.get('scheduleId');
        const limitInput = body.limit ?? request.nextUrl.searchParams.get('limit');
        const scheduleId = parseOptionalInteger(scheduleIdInput);
        if (hasValue(scheduleIdInput) && (!scheduleId || scheduleId < 1)) {
            return NextResponse.json({ error: 'Invalid scheduleId' }, { status: 400 });
        }

        const externalKey = body.externalKey || request.nextUrl.searchParams.get('externalKey') || undefined;
        const explicitLimit = parseOptionalInteger(limitInput);
        if (hasValue(limitInput) && (!explicitLimit || explicitLimit < 1)) {
            return NextResponse.json({ error: 'Invalid limit' }, { status: 400 });
        }

        const force = parseBoolean(body.force ?? request.nextUrl.searchParams.get('force'));

        const result = await executeSchedules({
            scheduleId,
            externalKey,
            limit: explicitLimit,
            onlyDue: !force,
        });

        return NextResponse.json({
            ...result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Cron execution error:', error);
        return NextResponse.json(
            { error: 'Failed to execute schedules', details: String(error) },
            { status: 500 }
        );
    }
}

function hasValue(value: number | string | null | undefined) {
    return value !== null && value !== undefined && value !== '';
}

function parseOptionalInteger(value: number | string | null | undefined): number | undefined {
    if (value === null || value === undefined || value === '') {
        return undefined;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
        return undefined;
    }

    return parsed;
}

function parseBoolean(value: boolean | string | null | undefined): boolean {
    if (typeof value === 'boolean') {
        return value;
    }
    return value === '1' || value === 'true';
}
