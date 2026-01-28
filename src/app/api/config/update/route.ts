import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

const API_SECRET = process.env.INTERNAL_API_SECRET;
const INTERNAL_API_URL = process.env.INTERNAL_API_URL;
const WAF_BYPASS_HEADER = process.env.WAF_BYPASS_HEADER;

export async function POST(req: NextRequest) {
    try {
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

        const body = await req.json();

        const response = await fetch(`${INTERNAL_API_URL}/api/config/update`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_SECRET}`,
                'x-bypass-waf': WAF_BYPASS_HEADER
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Internal API returned ${response.status} for /api/config/update: ${errorText}`);
            return NextResponse.json(
                { error: `Upstream Error: ${response.statusText} - ${errorText}` },
                { status: response.status }
            );
        }

        const data = await response.json();
        return NextResponse.json(data);

    } catch (error) {
        console.error('Proxy error for /api/config/update:', error);
        return NextResponse.json(
            { error: `Internal Proxy Error: ${error instanceof Error ? error.message : String(error)}` },
            { status: 500 }
        );
    }
}
