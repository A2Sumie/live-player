import { NextRequest } from 'next/server';
import { proxyRequest } from '@/lib/proxy';

export async function POST(req: NextRequest) {
  return proxyRequest(req, '/api/actions/articles/reprocess', {
    method: 'POST',
    body: req.body,
    headers: { 'Content-Type': 'application/json' },
    requireAdmin: true,
  });
}
