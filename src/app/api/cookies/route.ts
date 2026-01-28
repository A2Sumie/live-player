import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json()
        const authHeader = req.headers.get('Authorization')

        const API_SECRET = process.env.INTERNAL_API_SECRET;
        const INTERNAL_API_URL = process.env.INTERNAL_API_URL;
        const WAF_BYPASS_HEADER = process.env.WAF_BYPASS_HEADER;

        if (!API_SECRET || !INTERNAL_API_URL || !WAF_BYPASS_HEADER) {
            console.error('Missing environment variables for internal API');
            return new NextResponse('Server configuration error', { status: 500 })
        }

        // Internal API URL
        const internalUrl = `${INTERNAL_API_URL}/api/cookies`

        const response = await fetch(internalUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_SECRET}`,
                'x-bypass-waf': WAF_BYPASS_HEADER
            },
            body: JSON.stringify(body)
        })

        const text = await response.text()

        if (!response.ok) {
            console.error(`Internal API returned ${response.status} for /api/cookie (update): ${text}`);
            return new NextResponse(text, { status: response.status })
        }

        return new NextResponse(text, {
            status: 200,
            headers: {
                'Content-Type': 'text/plain'
            }
        })

    } catch (error) {
        console.error('Proxy error:', error)
        return new NextResponse(`Internal Proxy Error: ${error instanceof Error ? error.message : String(error)}`, { status: 500 })
    }
}
