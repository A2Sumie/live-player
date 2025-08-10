import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

export async function GET() {
  try {
    const user = await getCurrentUser();
    
    if (!user) {
      return NextResponse.json(
        { username: 'guest', role: 'user' },
        { status: 200 }
      );
    }
    
    return NextResponse.json({
      username: user.username,
      role: user.role
    });
  } catch (error) {
    console.error('Auth check error:', error);
    return NextResponse.json(
      { username: 'guest', role: 'user' },
      { status: 200 }
    );
  }
}