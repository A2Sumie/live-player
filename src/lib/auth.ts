import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { getDb, admins } from './db';
import { eq } from 'drizzle-orm';

// 严格要求环境变量配置，无默认值
if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}
if (!process.env.ADMIN_ACCOUNT || !process.env.ADMIN_PASSWORD) {
  throw new Error('ADMIN_ACCOUNT and ADMIN_PASSWORD environment variables are required');
}

const JWT_SECRET: string = process.env.JWT_SECRET;
const JWT_SECRET_KEY = new TextEncoder().encode(JWT_SECRET);
const ADMIN_ACCOUNT: string = process.env.ADMIN_ACCOUNT;
const ADMIN_PASSWORD: string = process.env.ADMIN_PASSWORD;

export interface JWTPayload {
  username: string;
  role: 'admin' | 'user';
  iat?: number;
  exp?: number;
  [key: string]: any; // Allow other standard claims
}

export async function signToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(JWT_SECRET_KEY);
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET_KEY);
    return payload as unknown as JWTPayload;
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

  return await verifyToken(token);
}

export async function getCurrentUserFromRequest(request: NextRequest): Promise<JWTPayload | null> {
  const token = request.cookies.get('auth-token')?.value;

  if (!token) {
    return null;
  }

  return await verifyToken(token);
}