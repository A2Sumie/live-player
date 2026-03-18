import { NextRequest } from 'next/server';
import { proxyRequest } from '@/lib/proxy';

export async function GET(req: NextRequest) {
  const query = req.nextUrl.search || '';
  return proxyRequest(req, `/api/articles${query}`);
}
