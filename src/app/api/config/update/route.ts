import { NextRequest } from 'next/server';
import { proxyRequest } from '@/lib/proxy';

export async function POST(req: NextRequest) {
    return proxyRequest(req, '/api/config/update', {
        method: 'POST',
        body: await req.text(),
        headers: { 'Content-Type': 'application/json' }
    });
}
