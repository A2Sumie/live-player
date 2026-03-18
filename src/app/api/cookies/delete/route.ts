import { NextRequest } from 'next/server';
import { proxyRequest } from '@/lib/proxy';

// Use Edge Runtime for better performance if possible, but Node.js runtime is needed for environment variables usually
// export const runtime = 'edge';

export async function POST(req: NextRequest) {
    return proxyRequest(req, '/api/cookies/delete', {
        method: 'POST',
        body: await req.text(),
        headers: { 'Content-Type': 'application/json' }
    });
}
