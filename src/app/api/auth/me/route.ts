import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      // Anonymous access is valid for the public site. Keep this probe quiet
      // in browser developer tools; protected APIs still enforce auth.
      return NextResponse.json(null);
    }

    return NextResponse.json({
      username: user.username,
      role: user.role
    });
  } catch (error) {
    console.error('Auth check error:', error);
    return NextResponse.json(
      { error: 'Authentication check failed' },
      { status: 500 }
    );
  }
}
