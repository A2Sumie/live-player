import { getDb, schedules, players } from './db';
import { asc, lte, eq, and } from 'drizzle-orm';

export type ExecuteSchedulesOptions = {
    scheduleId?: number;
    externalKey?: string;
    limit?: number;
    onlyDue?: boolean;
};

const DEFAULT_EXECUTION_LIMIT = 1;
const MAX_EXECUTION_LIMIT = 10;

/**
 * 执行到期的日程
 */
export async function executeSchedules(options: ExecuteSchedulesOptions = {}) {
    const db = getDb();
    const now = new Date().toISOString();
    const limit = clampExecutionLimit(options.limit);

    try {
        const conditions = [eq(schedules.status, 'pending')];
        if (options.onlyDue !== false) {
            conditions.push(lte(schedules.executionTime, now));
        }
        if (options.scheduleId !== undefined) {
            conditions.push(eq(schedules.id, options.scheduleId));
        }
        if (options.externalKey) {
            conditions.push(eq(schedules.externalKey, options.externalKey));
        }

        // 查找到期的 pending 日程，默认一次只执行一条，避免 HTTP 入口长时间扫队列。
        const dueSchedules = await db
            .select()
            .from(schedules)
            .where(and(...conditions))
            .orderBy(asc(schedules.executionTime))
            .limit(limit);

        console.log(`Found ${dueSchedules.length} due schedules`);

        for (const schedule of dueSchedules) {
            try {
                const result = await executeSchedule(schedule);

                // 更新为已完成
                await db
                    .update(schedules)
                    .set({
                        status: 'completed',
                        executedAt: new Date().toISOString(),
                        result: JSON.stringify(result),
                        updatedAt: new Date().toISOString()
                    })
                    .where(eq(schedules.id, schedule.id));

                console.log(`✅ Schedule ${schedule.id} executed successfully`);
            } catch (error) {
                // 标记为失败
                await db
                    .update(schedules)
                    .set({
                        status: 'failed',
                        executedAt: new Date().toISOString(),
                        result: JSON.stringify({ error: String(error) }),
                        updatedAt: new Date().toISOString()
                    })
                    .where(eq(schedules.id, schedule.id));

                console.error(`❌ Schedule ${schedule.id} failed:`, error);
            }
        }

        return {
            processed: dueSchedules.length,
            scheduleIds: dueSchedules.map((schedule) => schedule.id),
            success: true
        };
    } catch (error) {
        console.error('Error executing schedules:', error);
        throw error;
    }
}

function clampExecutionLimit(limit?: number) {
    if (!limit || limit < 1) {
        return DEFAULT_EXECUTION_LIMIT;
    }

    return Math.min(limit, MAX_EXECUTION_LIMIT);
}

/**
 * 执行单个日程
 */
async function executeSchedule(schedule: any) {
    const payload = schedule.payload ? JSON.parse(schedule.payload) : {};

    switch (schedule.scheduleType) {
        case 'stream':
        case 'workflow':
            return await executeWorkflow(payload);

        case 'reminder':
            return await sendReminder(schedule);

        default:
            throw new Error(`Unknown schedule type: ${schedule.scheduleType}`);
    }
}

/**
 * 执行工作流
 */
async function executeWorkflow(payload: any) {
    const { type } = payload;

    switch (type) {
        case 'start_network_stream':
            return await startNetworkStream(payload);

        case 'stop_network_stream':
            return await stopNetworkStream(payload);

        case 'update_network_stream':
            return await updateNetworkStream(payload);

        default:
            throw new Error(`Unknown workflow type: ${type}`);
    }
}

/**
 * 启动网络流
 */
async function startNetworkStream(payload: any) {
    const { playerId, source, name } = payload;

    if (!playerId || !source) {
        throw new Error('playerId and source are required');
    }

    const db = getDb();

    // 检查player是否存在
    const [player] = await db
        .select()
        .from(players)
        .where(eq(players.pId, playerId))
        .limit(1);

    if (player) {
        // 更新现有player
        await db
            .update(players)
            .set({
                name: name || `【直播】${playerId}`,
                url: source,
                description: `定时任务启动 | ${new Date().toLocaleString('zh-CN')}`,
                updatedAt: new Date().toISOString()
            })
            .where(eq(players.pId, playerId));
    } else {
        // 创建新player
        await db.insert(players).values({
            pId: playerId,
            name: name || `【直播】${playerId}`,
            url: source,
            description: `定时任务启动 | ${new Date().toLocaleString('zh-CN')}`,
            updatedAt: new Date().toISOString()
        });
    }

    return { action: 'started', playerId, source };
}

/**
 * 停止网络流
 */
async function stopNetworkStream(payload: any) {
    const { playerId } = payload;

    if (!playerId) {
        throw new Error('playerId is required');
    }

    const db = getDb();

    await db
        .update(players)
        .set({
            url: 'http://offline',
            description: `定时任务停止 | ${new Date().toLocaleString('zh-CN')}`,
            updatedAt: new Date().toISOString()
        })
        .where(eq(players.pId, playerId));

    return { action: 'stopped', playerId };
}

/**
 * 更新网络流源
 */
async function updateNetworkStream(payload: any) {
    const { playerId, source } = payload;

    if (!playerId || !source) {
        throw new Error('playerId and source are required');
    }

    const db = getDb();

    await db
        .update(players)
        .set({
            url: source,
            description: `定时任务更新 | ${new Date().toLocaleString('zh-CN')}`,
            updatedAt: new Date().toISOString()
        })
        .where(eq(players.pId, playerId));

    return { action: 'updated', playerId, source };
}

/**
 * 发送提醒
 */
async function sendReminder(schedule: any) {
    // 这里可以实现发送邮件、webhook通知等
    console.log(`📢 Reminder: ${schedule.title}`);

    return {
        action: 'reminder_sent',
        title: schedule.title,
        message: schedule.description
    };
}
