import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

const API_SECRET = process.env.INTERNAL_API_SECRET;
const INTERNAL_API_URL = process.env.INTERNAL_API_URL;
const WAF_BYPASS_HEADER = process.env.WAF_BYPASS_HEADER;

export async function GET(req: NextRequest) {
    try {
        // Check authentication
        const user = await getCurrentUser();
        if (!user) {
            return NextResponse.json(
                { error: 'Not authenticated' },
                { status: 401 }
            );
        }

        if (!API_SECRET || !INTERNAL_API_URL || !WAF_BYPASS_HEADER) {
            console.error('Missing environment variables for internal API');
            return NextResponse.json(
                { error: 'Server configuration error' },
                { status: 500 }
            );
        }

        // Proxy request to internal API
        const response = await fetch(`${INTERNAL_API_URL}/api/cookies`, {
            headers: {
                'Authorization': `Bearer ${API_SECRET}`,
                'x-bypass-waf': WAF_BYPASS_HEADER
            }
        });

        if (!response.ok) {
            console.error(`Internal API returned ${response.status} for /api/cookie (list)`);
            throw new Error(`API returned ${response.status}`);
        }

        const data = await response.json();
        return NextResponse.json(data);

    } catch (error) {
        console.error('Proxy error for /api/cookies/list:', error);
        return NextResponse.json(
            { error: 'Failed to fetch cookies' },
            { status: 500 }
        );
    }
}
