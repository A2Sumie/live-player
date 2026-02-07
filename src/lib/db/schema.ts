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
  createdBy: integer('created_by'),
  streamConfig: text('stream_config'), // JSON format
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const admins = sqliteTable('admins', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('admin'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const schedules = sqliteTable('schedules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  description: text('description'),
  scheduleType: text('schedule_type').notNull(), // 'reminder', 'workflow', 'stream'
  executionTime: text('execution_time').notNull(), // ISO datetime
  recurrence: text('recurrence'), // cron expression or null for one-time
  status: text('status').notNull().default('pending'), // 'pending', 'completed', 'failed', 'cancelled'
  payload: text('payload'), // JSON payload for workflow
  createdBy: text('created_by'), // Admin username or 'system'
  executedAt: text('executed_at'),
  result: text('result'), // Execution result
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const systemLogs = sqliteTable('system_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  level: text('level').notNull(), // 'info', 'warn', 'error'
  message: text('message').notNull(),
  details: text('details'), // JSON string, stack trace, etc.
  source: text('source'), // e.g., 'PlayerPage', 'Auth', 'Scheduler'
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;
export type PlayerWithBase64Image = Player & { coverImageBase64: string | null };

export type Admin = typeof admins.$inferSelect;
export type NewAdmin = typeof admins.$inferInsert;

export type Schedule = typeof schedules.$inferSelect;
export type NewSchedule = typeof schedules.$inferInsert;

export type SystemLog = typeof systemLogs.$inferSelect;
export type NewSystemLog = typeof systemLogs.$inferInsert;