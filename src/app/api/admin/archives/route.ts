import { NextRequest } from 'next/server';
import { proxyArchiveRequest } from '@/lib/archive-proxy';

export async function GET(req: NextRequest) {
  const search = new URL(req.url).search;
  return proxyArchiveRequest(req, `/archives${search}`, {
    requireAdmin: true,
    timeoutMs: 20_000,
  });
}
