import { NextRequest } from 'next/server';
import { proxyArchiveRequest } from '@/lib/archive-proxy';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ archiveId: string }> }
) {
  const { archiveId } = await context.params;
  return proxyArchiveRequest(req, `/archives/${encodeURIComponent(archiveId)}`, {
    requireAdmin: true,
    timeoutMs: 20_000,
  });
}
