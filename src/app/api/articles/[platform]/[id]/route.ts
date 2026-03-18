import { NextRequest } from 'next/server';
import { proxyRequest } from '@/lib/proxy';

type Params = {
  params: Promise<{
    platform: string;
    id: string;
  }>;
};

export async function GET(req: NextRequest, context: Params) {
  const { platform, id } = await context.params;
  return proxyRequest(req, `/api/articles/${platform}/${encodeURIComponent(id)}`);
}
