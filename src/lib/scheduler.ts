import { getDb, schedules, players } from './db';
import { lte, eq, and } from 'drizzle-orm';

/**
 * 执行到期的日程
 */
export async function executeSchedules() {
    const db = getDb();
    const now = new Date().toISOString();

    try {
        // 查找所有到期的pending日程
        const dueSchedules = await db
            .select()
            .from(schedules)
            .where(
                and(
                    lte(schedules.executionTime, now),
                    eq(schedules.status, 'pending')
                )
            )
            .limit(50);

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
            success: true
        };
    } catch (error) {
        console.error('Error executing schedules:', error);
        throw error;
    }
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
