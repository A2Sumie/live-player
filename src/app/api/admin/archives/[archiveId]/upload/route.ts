import { NextRequest } from 'next/server';
import { proxyArchiveRequest } from '@/lib/archive-proxy';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ archiveId: string }> }
) {
  const { archiveId } = await context.params;
  return proxyArchiveRequest(req, `/archives/${encodeURIComponent(archiveId)}/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': req.headers.get('content-type') || 'application/json',
    },
    body: req.body,
    requireAdmin: true,
    timeoutMs: 14_400_000,
  });
}
