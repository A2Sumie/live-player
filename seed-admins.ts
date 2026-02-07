import { getDb, admins } from './src/lib/db';
import * as schema from './src/lib/db/schema';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

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

    console.log('🌱 Seeding admins table...');

    const accounts = [
        // 1. Environment / Default account (Legacy)
        {
            username: process.env.ADMIN_ACCOUNT || 'sumie',
            password: process.env.ADMIN_PASSWORD || 'REDACTED_ADMIN_PASSWORD'
        },
        // 2. New specific account
        {
            username: 'seed-admin',
            password: 'REDACTED_ADMIN_PASSWORD'
        }
    ];

    for (const acc of accounts) {
        if (!acc.password) {
            console.warn(`⚠️ Password not set for ${acc.username}, skipping...`);
            continue;
        }

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
            // Optional: Update password if exists, or just leave it? 
            // Usually seed scripts ensure state matches code, so let's update.
            await db.update(admins)
                .set({ passwordHash: passwordHash, isActive: true })
                .where(eq(admins.username, acc.username));
            console.log(`ℹ️ Admin "${acc.username}" updated`);
        }
    }

    console.log('✅ Seeding complete!');
}

seedAdmins().catch(console.error);
