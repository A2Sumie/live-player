import { NextRequest } from 'next/server';
import { proxyRequest } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ finder: string }> }
) {
    const params = await context.params;
    const { finder } = params;
    return proxyRequest(req, `/api/cookies/${finder}`);
}
