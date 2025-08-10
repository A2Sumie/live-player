import { sqliteTable, text, integer, blob } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const players = sqliteTable('players', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  pId: text('p_id').notNull().unique(),
  description: text('description'),
  url: text('url').notNull(),
  coverUrl: text('cover_url'),
  coverImage: blob('cover_image'),
  announcement: text('announcement'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;
export type PlayerWithBase64Image = Player & { coverImageBase64: string | null };