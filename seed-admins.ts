import { getDb, admins } from './src/lib/db';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

async function seedAdmins() {
    const db = getDb();

    console.log('🌱 Seeding admins table...');

    // 迁移现有的管理员账户
    const adminUser = process.env.ADMIN_ACCOUNT || 'sumie';
    const adminPass = process.env.ADMIN_PASSWORD;

    if (!adminPass) {
        console.warn('⚠️ ADMIN_PASSWORD not set, skipping default admin creation');
        return;
    }

    const existingAdmin = await db.select().from(admins).where(eq(admins.username, adminUser)).limit(1);

    if (existingAdmin.length === 0) {
        const passwordHash = await bcrypt.hash(adminPass, 10);

        await db.insert(admins).values({
            username: adminUser,
            passwordHash: passwordHash,
            role: 'admin',
            isActive: true
        });

        console.log(`✅ Default admin "${adminUser}" created`);
    } else {
        const passwordHash = await bcrypt.hash(adminPass, 10);
        await db.update(admins)
            .set({ passwordHash: passwordHash, isActive: true })
            .where(eq(admins.username, adminUser));
        console.log(`ℹ️ Admin "${adminUser}" already exists, updated password from environment`);
    }

    console.log('✅ Seeding complete!');
}

seedAdmins().catch(console.error);
