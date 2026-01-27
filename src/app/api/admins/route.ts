import { NextRequest, NextResponse } from 'next/server';
import { getDb, admins, type Admin } from '@/lib/db';
import { getCurrentUser, createAdmin } from '@/lib/auth';
import { eq } from 'drizzle-orm';

/**
 * GET /api/admins - 获取所有管理员列表（仅管理员可访问）
 */
export async function GET() {
    try {
        const user = await getCurrentUser();

        if (!user || user.role !== 'admin') {
            return NextResponse.json(
                { error: 'Permission denied' },
                { status: 403 }
            );
        }

        const db = getDb();
        const adminList = await db.select({
            id: admins.id,
            username: admins.username,
            role: admins.role,
            isActive: admins.isActive,
            createdAt: admins.createdAt,
            updatedAt: admins.updatedAt
        }).from(admins);

        return NextResponse.json(adminList);
    } catch (error) {
        console.error('Error fetching admins:', error);
        return NextResponse.json(
            { error: 'Failed to fetch admin list' },
            { status: 500 }
        );
    }
}

/**
 * POST /api/admins - 创建新管理员（仅管理员可访问）
 */
export async function POST(request: NextRequest) {
    try {
        const user = await getCurrentUser();

        if (!user || user.role !== 'admin') {
            return NextResponse.json(
                { error: 'Permission denied' },
                { status: 403 }
            );
        }

        const { username, password } = await request.json() as {
            username: string;
            password: string;
        };

        if (!username || !password) {
            return NextResponse.json(
                { error: 'Username and password are required' },
                { status: 400 }
            );
        }

        // 验证密码强度（至少10个字符）
        if (password.length < 10) {
            return NextResponse.json(
                { error: 'Password must be at least 10 characters long' },
                { status: 400 }
            );
        }

        // 创建管理员
        const success = await createAdmin(username, password);

        if (!success) {
            return NextResponse.json(
                { error: 'Admin username already exists' },
                { status: 400 }
            );
        }

        // 获取新创建的管理员信息
        const db = getDb();
        const [newAdmin] = await db
            .select({
                id: admins.id,
                username: admins.username,
                role: admins.role,
                isActive: admins.isActive,
                createdAt: admins.createdAt,
                updatedAt: admins.updatedAt
            })
            .from(admins)
            .where(eq(admins.username, username))
            .limit(1);

        return NextResponse.json(newAdmin);
    } catch (error) {
        console.error('Error creating admin:', error);
        return NextResponse.json(
            { error: 'Failed to create admin' },
            { status: 500 }
        );
    }
}
