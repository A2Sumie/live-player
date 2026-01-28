import { NextRequest, NextResponse } from 'next/server';
import { useAuth } from '@/middleware/WithAuth';

// Use Edge Runtime for better performance if possible, but Node.js runtime is needed for environment variables usually
// export const runtime = 'edge';

export async function POST(req: NextRequest) {
    const API_SECRET = process.env.INTERNAL_API_SECRET;
    const INTERNAL_API_URL = process.env.INTERNAL_API_URL;
    const WAF_BYPASS_HEADER = process.env.WAF_BYPASS_HEADER;

    if (!API_SECRET || !INTERNAL_API_URL || !WAF_BYPASS_HEADER) {
        console.error('Missing environment variables for internal API');
        return NextResponse.json({ error: 'Server misconfigured (missing env vars)' }, { status: 500 });
    }

    try {
        const body = await req.json();

        const res = await fetch(`${INTERNAL_API_URL}/api/cookies/delete`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_SECRET}`,
                'x-bypass-waf': WAF_BYPASS_HEADER
            },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const errorText = await res.text();
            console.error('Backend DELETE error:', errorText);
            return NextResponse.json({ error: `Backend failed: ${res.status}` }, { status: res.status });
        }

        const data = await res.json();
        return NextResponse.json(data);

    } catch (error) {
        console.error('DELETE proxy error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
