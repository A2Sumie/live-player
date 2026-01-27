import { NextResponse } from 'next/server';
import { executeSchedules } from '@/lib/scheduler';

/**
 * Cloudflare Cron trigger endpoint
 * Runs every minute to check and execute due schedules
 */
export async function GET() {
    try {
        const result = await executeSchedules();

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
