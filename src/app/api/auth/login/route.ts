import { NextRequest, NextResponse } from 'next/server';
import { signToken, validateAdmin } from '@/lib/auth';
import { readJsonBodyWithLimit, oversizedBodyResponse } from '@/lib/request-security';

const LOGIN_BODY_LIMIT_BYTES = 8 * 1024;

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await readJsonBodyWithLimit<{
      username: string;
      password: string;
    }>(request, LOGIN_BODY_LIMIT_BYTES);

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      );
    }

    const isValidAdmin = await validateAdmin(username, password);

    if (!isValidAdmin) {
      return NextResponse.json(
        { error: 'Invalid username or password' },
        { status: 401 }
      );
    }

    const token = await signToken({
      username,
      role: 'admin'
    });

    const response = NextResponse.json({
      username,
      role: 'admin'
    });
    const authCookieDomain = process.env.AUTH_COOKIE_DOMAIN?.trim();

    response.cookies.set('auth-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      domain: authCookieDomain || undefined,
      path: '/',
      maxAge: 7 * 24 * 60 * 60
    });
    if (!authCookieDomain) {
      response.headers.append('Set-Cookie', legacyAuthCookieDeleteHeader());
    }

    return response;

  } catch (error) {
    const bodyError = oversizedBodyResponse(error);
    if (bodyError) {
      return bodyError;
    }

    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Failed to log in' },
      { status: 500 }
    );
  }
}

function legacyAuthCookieDeleteHeader() {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `auth-token=; Path=/; Domain=.n2nj.moe; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}
