import { NextResponse } from 'next/server';

const OUTBOUND_LINKS: Record<string, string> = {
  'qq-group': 'https://qm.qq.com/q/D3yFzyEk92',
};

type RouteContext = {
  params: Promise<{ linkId: string }>;
};

async function resolveLink(context: RouteContext) {
  const { linkId } = await context.params;
  const url = OUTBOUND_LINKS[linkId];
  if (!url) {
    return NextResponse.json({ error: 'Unknown outbound link' }, { status: 404 });
  }

  return NextResponse.json(
    { url },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}

export async function POST(_request: Request, context: RouteContext) {
  return resolveLink(context);
}
