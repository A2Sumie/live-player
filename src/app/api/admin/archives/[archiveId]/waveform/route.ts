import { NextRequest } from 'next/server';
import { proxyArchivePassthroughRequest } from '@/lib/archive-proxy';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ archiveId: string }> }
) {
  const { archiveId } = await context.params;
  const search = new URL(req.url).search;
  return proxyArchivePassthroughRequest(
    req,
    `/archives/${encodeURIComponent(archiveId)}/waveform${search}`,
    {
      requireAdmin: true,
      timeoutMs: 180_000,
    }
  );
}
