import { getDb } from '@/lib/db';
import { systemLogs } from '@/lib/db/schema';

type LogLevel = 'info' | 'warn' | 'error';

export const logger = {
    async log(level: LogLevel, message: string, details?: any, source?: string) {
        // Always log to console for real-time visibility (Worker logs)
        const logFn = level === 'error' ? console.error : console.log;

        try {
            // Format details for console
            const detailsStr = details ? (details instanceof Error ? details.stack : JSON.stringify(details)) : '';
            logFn(`[${level.toUpperCase()}] [${source || 'System'}] ${message}`, detailsStr);

            // Attempt to write to DB
            const db = getDb();
            await db.insert(systemLogs).values({
                level,
                message,
                details: details ? (typeof details === 'string' ? details : JSON.stringify(details, Object.getOwnPropertyNames(details))) : null,
                source: source || 'System',
            });
        } catch (e) {
            // If DB logging fails (e.g. during build, or DB connection error), just fallback to console
            // Don't throw, as logging shouldn't crash the app
            console.error('SERVER LOGGING FAILED:', e);
        }
    },

    async info(message: string, details?: any, source?: string) {
        return this.log('info', message, details, source);
    },

    async warn(message: string, details?: any, source?: string) {
        return this.log('warn', message, details, source);
    },

    async error(message: string, details?: any, source?: string) {
        return this.log('error', message, details, source);
    }
};
