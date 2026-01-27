import { NextRequest, NextResponse } from 'next/server';
import { getDb, admins } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

/**
 * PUT /api/admins/:id - 更新管理员信息
 */
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getCurrentUser();

        if (!user || user.role !== 'admin') {
            return NextResponse.json(
                { error: 'Permission denied' },
                { status: 403 }
            );
        }

        const { id } = await params;
        const adminId = parseInt(id);

        if (isNaN(adminId)) {
            return NextResponse.json(
                { error: 'Invalid admin ID' },
                { status: 400 }
            );
        }

        const body = await request.json() as {
            password?: string;
            isActive?: boolean;
        };

        const updateData: any = {
            updatedAt: new Date().toISOString()
        };

        // 如果提供了新密码，进行更新
        if (body.password) {
            if (body.password.length < 10) {
                return NextResponse.json(
                    { error: 'Password must be at least 10 characters long' },
                    { status: 400 }
                );
            }
            updateData.passwordHash = await bcrypt.hash(body.password, 10);
        }

        // 如果提供了isActive状态，进行更新
        if (typeof body.isActive === 'boolean') {
            updateData.isActive = body.isActive;
        }

        const db = getDb();

        // 检查管理员是否存在
        const [existingAdmin] = await db
            .select()
            .from(admins)
            .where(eq(admins.id, adminId))
            .limit(1);

        if (!existingAdmin) {
            return NextResponse.json(
                { error: 'Admin not found' },
                { status: 404 }
            );
        }

        // 更新管理员
        await db
            .update(admins)
            .set(updateData)
            .where(eq(admins.id, adminId));

        // 返回更新后的管理员信息（不包含密码）
        const [updatedAdmin] = await db
            .select({
                id: admins.id,
                username: admins.username,
                role: admins.role,
                isActive: admins.isActive,
                createdAt: admins.createdAt,
                updatedAt: admins.updatedAt
            })
            .from(admins)
            .where(eq(admins.id, adminId))
            .limit(1);

        return NextResponse.json(updatedAdmin);
    } catch (error) {
        console.error('Error updating admin:', error);
        return NextResponse.json(
            { error: 'Failed to update admin' },
            { status: 500 }
        );
    }
}

/**
 * DELETE /api/admins/:id - 删除管理员
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getCurrentUser();

        if (!user || user.role !== 'admin') {
            return NextResponse.json(
                { error: 'Permission denied' },
                { status: 403 }
            );
        }

        const { id } = await params;
        const adminId = parseInt(id);

        if (isNaN(adminId)) {
            return NextResponse.json(
                { error: 'Invalid admin ID' },
                { status: 400 }
            );
        }

        const db = getDb();

        // 检查管理员是否存在
        const [existingAdmin] = await db
            .select()
            .from(admins)
            .where(eq(admins.id, adminId))
            .limit(1);

        if (!existingAdmin) {
            return NextResponse.json(
                { error: 'Admin not found' },
                { status: 404 }
            );
        }

        // 防止删除所有管理员（至少保留一个）
        const allAdmins = await db.select().from(admins);
        if (allAdmins.length <= 1) {
            return NextResponse.json(
                { error: 'Cannot delete the last admin' },
                { status: 400 }
            );
        }

        // 删除管理员
        await db.delete(admins).where(eq(admins.id, adminId));

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error deleting admin:', error);
        return NextResponse.json(
            { error: 'Failed to delete admin' },
            { status: 500 }
        );
    }
}
