import { NextRequest } from 'next/server';
import {
  proxyArchivePassthroughRequest,
  redirectArchiveDownloadRequest,
} from '@/lib/archive-proxy';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ archiveId: string }> }
) {
  const { archiveId } = await context.params;
  const upstreamSearchParams = new URLSearchParams(req.nextUrl.searchParams);
  upstreamSearchParams.delete('mode');
  const archivePath = `/archives/${encodeURIComponent(archiveId)}/download${upstreamSearchParams.toString() ? `?${upstreamSearchParams.toString()}` : ''}`;
  if (req.nextUrl.searchParams.get('mode') === 'proxy') {
    return proxyArchivePassthroughRequest(req, archivePath, { requireAdmin: true });
  }
  return redirectArchiveDownloadRequest(req, archivePath, { requireAdmin: true });
}
