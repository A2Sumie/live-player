import { NextRequest, NextResponse } from 'next/server';
import { useAuth } from '@/middleware/WithAuth';

// Use Edge Runtime for better performance if possible, but Node.js runtime is needed for environment variables usually
// export const runtime = 'edge';

export async function DELETE(req: NextRequest) {
    const apiSecret = process.env.API_SECRET;
    const apiUrl = process.env.API_URL || 'http://localhost:3000';

    if (!apiSecret) {
        return NextResponse.json({ error: 'Server misconfigured (missing API_SECRET)' }, { status: 500 });
    }

    try {
        const body = await req.json();

        const res = await fetch(`${apiUrl}/api/cookies`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiSecret}`,
            },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const errorText = await res.text();
            console.error('Backend DELETE error:', errorText);
            return NextResponse.json({ error: `Backend failed: ${res.status}` }, { status: res.status });
        }

        const data = await res.json();
        const response = NextResponse.json(data);
        response.headers.set('x-bypass-waf', 'true');
        return response;

    } catch (error) {
        console.error('DELETE proxy error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
