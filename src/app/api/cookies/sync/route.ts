import { NextRequest } from 'next/server';
import { proxyRequest } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  return proxyRequest(req, '/api/cookies/sync', {
    method: 'POST',
    body: await req.text(),
    headers: { 'Content-Type': 'application/json' },
  });
}
