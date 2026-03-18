import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    const hostname = request.headers.get('host') || '';
    const pathname = request.nextUrl.pathname;

    // Handle cic.n2nj.moe routing
    if (hostname === 'cic.n2nj.moe') {
        // If accessing root, redirect to /cic
        if (pathname === '/') {
            return NextResponse.redirect(new URL('/cic', request.url));
        }
    }

    // Continue to the requested page
    return NextResponse.next();
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - api (API routes)
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         */
        '/((?!api|_next/static|_next/image|favicon.ico).*)',
    ],
};
