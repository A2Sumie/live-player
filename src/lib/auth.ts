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
const STREAMSERV_WORKER_USER_AGENT = process.env.STREAMSERV_WORKER_USER_AGENT || 'N2NJ-Stream-Bot/1.0';

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
 * 验证管理员账户（优先验证环境变量以规避 bcrypt CPU 超限，数据库作为此要账号）
 */
export async function validateAdmin(username: string, password: string): Promise<boolean> {
  try {
    // 1. 优先验证环境变量主账户 (Fast path, O(1) CPU time)
    // 彻底解决主账户登录时 bcrypt 导致的 CF Worker 1102 Resource Exceeded 问题
    if (username === ADMIN_ACCOUNT) {
      return password === ADMIN_PASSWORD;
    }

    // 2. 尝试从数据库查找管理员（仅针对非主账户）
    const db = getDb();
    const [admin] = await db
      .select()
      .from(admins)
      .where(eq(admins.username, username))
      .limit(1);

    if (admin) {
      if (!admin.isActive) {
        console.log(`Admin ${username} is inactive`);
        return false;
      }

      // 注意：次要管理员仍会使用 bcrypt，但通常只有主账户高频登录
      const isValid = await bcrypt.compare(password, admin.passwordHash);
      return isValid;
    }

    return false;

  } catch (error) {
    console.error('Error validating admin:', error);
    // 兜底方案
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

export async function getCurrentUserFromRequestOrInternalAdmin(request: NextRequest): Promise<JWTPayload | null> {
  if (await isStreamServInternalRequest(request)) {
    return {
      username: 'streamserv',
      role: 'admin',
    };
  }

  return getCurrentUserFromRequest(request);
}

export async function isStreamServInternalRequest(request: NextRequest): Promise<boolean> {
  const expectedSecret = extractWafBypassSecret(process.env.WAF_BYPASS_HEADER);
  if (!expectedSecret) {
    return false;
  }

  const userAgent = request.headers.get('user-agent')?.trim();
  if (userAgent !== STREAMSERV_WORKER_USER_AGENT) {
    return false;
  }

  const providedSecret = request.headers.get('x-bypass-waf')?.trim();
  if (!providedSecret) {
    return false;
  }

  return timingSafeEqualStrings(providedSecret, expectedSecret);
}

function extractWafBypassSecret(rawHeader?: string): string | null {
  const normalized = rawHeader?.trim();
  if (!normalized) {
    return null;
  }

  const separatorIndex = normalized.indexOf(':');
  if (separatorIndex > 0) {
    const value = normalized.slice(separatorIndex + 1).trim();
    return value || null;
  }

  return normalized;
}

async function timingSafeEqualStrings(provided: string, expected: string): Promise<boolean> {
  const [providedHash, expectedHash] = await Promise.all([
    sha256(provided),
    sha256(expected),
  ]);

  let diff = providedHash.byteLength ^ expectedHash.byteLength;
  for (let i = 0; i < providedHash.byteLength; i += 1) {
    diff |= providedHash[i] ^ expectedHash[i];
  }
  return diff === 0;
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}
