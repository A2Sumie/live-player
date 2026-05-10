import { getDb, admins } from './src/lib/db';
import * as schema from './src/lib/db/schema';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

type SeedAccount = {
    username: string;
    password: string;
};

function getSeedAccounts(): SeedAccount[] {
    const accounts: SeedAccount[] = [];

    if (process.env.ADMIN_PASSWORD) {
        accounts.push({
            username: process.env.ADMIN_ACCOUNT || 'admin',
            password: process.env.ADMIN_PASSWORD,
        });
    }

    if (process.env.SEED_ADMIN_ACCOUNTS) {
        const parsed = JSON.parse(process.env.SEED_ADMIN_ACCOUNTS) as unknown;

        if (!Array.isArray(parsed)) {
            throw new Error('SEED_ADMIN_ACCOUNTS must be a JSON array');
        }

        for (const item of parsed) {
            if (!item || typeof item !== 'object') {
                throw new Error('Each SEED_ADMIN_ACCOUNTS item must be an object');
            }

            const { username, password } = item as Record<string, unknown>;
            if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
                throw new Error('Each SEED_ADMIN_ACCOUNTS item requires username and password strings');
            }

            accounts.push({ username, password });
        }
    }

    return accounts;
}

async function seedAdmins() {
    let db;
    try {
        db = getDb();
        // Test access
        try { await db.select().from(admins).limit(1); } catch { throw new Error('Context missing'); }
    } catch (e) {
        console.log("⚠️ Standard getDb failed (likely local script), trying Wrangler Platform Proxy...");
        const { getPlatformProxy } = await import('wrangler');
        const { env } = await getPlatformProxy();
        if (!env.DB) throw new Error('DB binding not found in Wrangler proxy');
        db = drizzle(env.DB as any, { schema });
    }

    console.log('🌱 Seeding admins table...');

    const accounts = getSeedAccounts();

    if (accounts.length === 0) {
        console.warn('⚠️ No seed admin credentials provided; set ADMIN_PASSWORD or SEED_ADMIN_ACCOUNTS to create/update admins');
        return;
    }

    for (const acc of accounts) {
        const existingAdmin = await db.select().from(admins).where(eq(admins.username, acc.username)).limit(1);
        const passwordHash = await bcrypt.hash(acc.password, 10);

        if (existingAdmin.length === 0) {
            await db.insert(admins).values({
                username: acc.username,
                passwordHash: passwordHash,
                role: 'admin',
                isActive: true
            });
            console.log(`✅ Admin "${acc.username}" created`);
        } else {
            await db.update(admins)
                .set({ passwordHash: passwordHash, isActive: true })
                .where(eq(admins.username, acc.username));
            console.log(`ℹ️ Admin "${acc.username}" updated`);
        }
    }

    console.log('✅ Seeding complete!');
}

seedAdmins().catch(console.error);
