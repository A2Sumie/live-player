import { NextRequest } from 'next/server';
import { proxyRequest } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    return proxyRequest(req, '/api/cookies', {
        method: 'POST',
        body: req.body,
        headers: { 'Content-Type': 'application/json' },
        textResponse: true,
        requireAdmin: true
    });
}
