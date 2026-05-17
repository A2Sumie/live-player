import { NextRequest } from 'next/server';
import { proxyArchiveRequest } from '@/lib/archive-proxy';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ archiveId: string }> }
) {
  const { archiveId } = await context.params;
  const search = new URL(req.url).search;
  return proxyArchiveRequest(
    req,
    `/archives/${encodeURIComponent(archiveId)}/silence${search}`,
    {
      requireAdmin: true,
      timeoutMs: 90_000,
    }
  );
}
