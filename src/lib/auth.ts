import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { getDb, admins } from './db';
import { eq } from 'drizzle-orm';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// 保留环境变量支持作为后备方案
const ADMIN_ACCOUNT = process.env.ADMIN_ACCOUNT || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

export interface JWTPayload {
  username: string;
  role: 'admin' | 'user';
  iat?: number;
  exp?: number;
}

export function signToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * 验证管理员账户（数据库优先，环境变量作为后备）
 */
export async function validateAdmin(username: string, password: string): Promise<boolean> {
  try {
    const db = getDb();

    // 尝试从数据库查找管理员
    const [admin] = await db
      .select()
      .from(admins)
      .where(eq(admins.username, username))
      .limit(1);

    if (admin) {
      // 数据库中存在该管理员
      if (!admin.isActive) {
        console.log(`Admin ${username} is inactive`);
        return false;
      }

      // 验证密码
      const isValid = await bcrypt.compare(password, admin.passwordHash);
      return isValid;
    }

    // 数据库中不存在，尝试环境变量后备方案
    console.log('Admin not found in database, falling back to environment variables');
    return username === ADMIN_ACCOUNT && password === ADMIN_PASSWORD;

  } catch (error) {
    console.error('Error validating admin:', error);
    // 数据库错误时使用环境变量
    return username === ADMIN_ACCOUNT && password === ADMIN_PASSWORD;
  }
}

/**
 * 创建新管理员（需要密码哈希）
 */
export async function createAdmin(username: string, password: string): Promise<boolean> {
  try {
    const db = getDb();

    // 检查用户名是否已存在
    const [existing] = await db
      .select()
      .from(admins)
      .where(eq(admins.username, username))
      .limit(1);

    if (existing) {
      return false;
    }

    // 哈希密码
    const passwordHash = await bcrypt.hash(password, 10);

    // 插入新管理员
    await db.insert(admins).values({
      username,
      passwordHash,
      role: 'admin',
      isActive: true
    });

    return true;
  } catch (error) {
    console.error('Error creating admin:', error);
    return false;
  }
}

export async function getCurrentUser(): Promise<JWTPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth-token')?.value;

  if (!token) {
    return null;
  }

  return verifyToken(token);
}

export function getCurrentUserFromRequest(request: NextRequest): JWTPayload | null {
  const token = request.cookies.get('auth-token')?.value;

  if (!token) {
    return null;
  }

  return verifyToken(token);
}