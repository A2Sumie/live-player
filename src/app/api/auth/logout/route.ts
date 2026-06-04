import { NextResponse } from 'next/server';

export async function POST() {
  try {
    const response = NextResponse.json({ message: 'Logged out successfully' });
    const authCookieDomain = process.env.AUTH_COOKIE_DOMAIN?.trim();

    response.cookies.set('auth-token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      domain: authCookieDomain || undefined,
      path: '/',
      maxAge: 0,
    });

    if (!authCookieDomain) {
      response.headers.append('Set-Cookie', legacyAuthCookieDeleteHeader());
    }

    return response;
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json(
      { error: 'Failed to log out' },
      { status: 500 }
    );
  }
}

function legacyAuthCookieDeleteHeader() {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `auth-token=; Path=/; Domain=.n2nj.moe; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}
