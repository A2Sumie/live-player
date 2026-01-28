import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

const API_SECRET = process.env.INTERNAL_API_SECRET;
const INTERNAL_API_URL = process.env.INTERNAL_API_URL;
const WAF_BYPASS_HEADER = process.env.WAF_BYPASS_HEADER;

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ finder: string }> }
) {
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

        const params = await context.params;
        const { finder } = params;

        // Proxy request to internal API
        const response = await fetch(`${INTERNAL_API_URL}/api/cookie/${finder}`, {
            headers: {
                'Authorization': `Bearer ${API_SECRET}`,
                'x-bypass-waf': WAF_BYPASS_HEADER
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            if (response.status === 404) {
                return NextResponse.json(
                    { error: 'Cookie not found' },
                    { status: 404 }
                );
            }
            console.error(`Internal API returned ${response.status} for /api/cookie/${finder}: ${errorText}`);
            return NextResponse.json(
                { error: `Upstream Error: ${response.statusText} - ${errorText}` },
                { status: response.status }
            );
        }

        const data = await response.json();
        return NextResponse.json(data);

    } catch (error) {
        console.error('Proxy error for /api/cookies/view/[finder]:', error);
        return NextResponse.json(
            { error: `Internal Proxy Error: ${error instanceof Error ? error.message : String(error)}` },
            { status: 500 }
        );
    }
}
