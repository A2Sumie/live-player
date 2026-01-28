'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/middleware/WithAuth';

interface Schedule {
    id: number;
    title: string;
    description: string | null;
    scheduleType: string;
    executionTime: string;
    status: string;
    createdBy: string | null;
}

export default function CICPage() {
    const [schedules, setSchedules] = useState<Schedule[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();

    // Require authentication
    useEffect(() => {
        if (!authLoading && !user) {
            router.push('/auth/login?redirect=/cic');
        }
    }, [user, authLoading, router]);

    useEffect(() => {
        if (user) {
            loadSchedules();
            const interval = setInterval(loadSchedules, 30000); // 每30秒刷新
            return () => clearInterval(interval);
        }
    }, [user]);

    async function loadSchedules() {
        try {
            const res = await fetch('/api/schedules?upcoming=true');
            if (res.ok) {
                const data = await res.json() as Schedule[];
                setSchedules(data);
            }
        } catch (error) {
            console.error('Failed to load schedules:', error);
        } finally {
            setLoading(false);
        }
    }

    async function createSchedule(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);

        const payload: any = {
            title: formData.get('title'),
            description: formData.get('description'),
            scheduleType: formData.get('scheduleType'),
            executionTime: new Date(formData.get('executionTime') as string).toISOString(),
        };

        // 如果是workflow类型，添加payload
        if (payload.scheduleType === 'workflow' || payload.scheduleType === 'stream') {
            payload.payload = {
                type: 'start_network_stream',
                playerId: formData.get('playerId'),
                source: formData.get('source'),
                name: formData.get('title')
            };
        }

        try {
            const res = await fetch('/api/schedules', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                setShowCreateForm(false);
                loadSchedules();
                (e.target as HTMLFormElement).reset();
            } else {
                alert('创建失败');
            }
        } catch (error) {
            console.error('Failed to create schedule:', error);
            alert('创建失败');
        }
    }

    async function deleteSchedule(id: number) {
        if (!confirm('确认删除此日程？')) return;

        try {
            const res = await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
            if (res.ok) {
                loadSchedules();
            }
        } catch (error) {
            console.error('Failed to delete schedule:', error);
        }
    }

    // Show loading state while checking auth
    if (authLoading || !user) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
                    <p className="text-white">Loading...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-600 to-blue-600 p-8">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <header className="bg-white rounded-lg shadow-lg p-6 mb-8">
                    <h1 className="text-3xl font-bold text-gray-800">🎬 StreamServ Control Center</h1>
                    <p className="text-gray-600 mt-2">集中控制面板 - cic.n2nj.moe</p>
                    <p className="text-sm text-gray-500 mt-1">Logged in as: {user.username} ({user.role})</p>
                </header>

                {/* Actions */}
                <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
                    <div className="flex gap-3 flex-wrap">
                        <button
                            onClick={() => setShowCreateForm(!showCreateForm)}
                            className="bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700 transition"
                        >
                            {showCreateForm ? '取消' : '+ 创建新日程'}
                        </button>
                        <a
                            href="/cookies"
                            className="bg-orange-600 text-white px-6 py-2 rounded-lg hover:bg-orange-700 transition inline-flex items-center gap-2"
                        >
                            <span>🍪</span>
                            <span>Cookie Manager</span>
                        </a>
                        <a
                            href="/config"
                            className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition inline-flex items-center gap-2"
                        >
                            <span>⚙️</span>
                            <span>Crawler Config</span>
                        </a>
                    </div>
                </div>

                {/* Create Form */}
                {showCreateForm && (
                    <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
                        <h2 className="text-2xl font-bold mb-4">创建新日程</h2>
                        <form onSubmit={createSchedule} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">标题 *</label>
                                <input
                                    type="text"
                                    name="title"
                                    required
                                    className="w-full border rounded px-3 py-2"
                                    placeholder="例如：转播推特空间"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1">描述</label>
                                <textarea
                                    name="description"
                                    className="w-full border rounded px-3 py-2"
                                    rows={3}
                                    placeholder="详细描述..."
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1">类型 *</label>
                                    <select
                                        name="scheduleType"
                                        required
                                        className="w-full border rounded px-3 py-2"
                                    >
                                        <option value="stream">直播流</option>
                                        <option value="workflow">工作流</option>
                                        <option value="reminder">提醒</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium mb-1">执行时间 *</label>
                                    <input
                                        type="datetime-local"
                                        name="executionTime"
                                        required
                                        className="w-full border rounded px-3 py-2"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1">播放器ID</label>
                                    <input
                                        type="text"
                                        name="playerId"
                                        className="w-full border rounded px-3 py-2"
                                        placeholder="web-1, web-2..."
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium mb-1">流地址</label>
                                    <input
                                        type="url"
                                        name="source"
                                        className="w-full border rounded px-3 py-2"
                                        placeholder="https://..."
                                    />
                                </div>
                            </div>

                            <button
                                type="submit"
                                className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 transition"
                            >
                                创建日程
                            </button>
                        </form>
                    </div>
                )}

                {/* Schedules List */}
                <div className="bg-white rounded-lg shadow-lg p-6">
                    <h2 className="text-2xl font-bold mb-4">📅 即将到来的日程</h2>

                    {loading ? (
                        <p className="text-gray-500 text-center py-8">加载中...</p>
                    ) : schedules.length === 0 ? (
                        <p className="text-gray-500 text-center py-8">暂无日程</p>
                    ) : (
                        <div className="space-y-4">
                            {schedules.map(schedule => (
                                <div
                                    key={schedule.id}
                                    className="border rounded-lg p-4 hover:shadow-md transition"
                                >
                                    <div className="flex justify-between items-start">
                                        <div className="flex-1">
                                            <h3 className="text-lg font-semibold">{schedule.title}</h3>
                                            {schedule.description && (
                                                <p className="text-gray-600 mt-1">{schedule.description}</p>
                                            )}
                                            <div className="flex gap-4 mt-2 text-sm text-gray-500">
                                                <span>⏰ {new Date(schedule.executionTime).toLocaleString('zh-CN')}</span>
                                                <span>📋 {schedule.scheduleType}</span>
                                                <span>✅ {schedule.status}</span>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => deleteSchedule(schedule.id)}
                                            className="text-red-600 hover:text-red-800 ml-4"
                                        >
                                            删除
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Public API Info */}
                <div className="bg-white rounded-lg shadow-lg p-6 mt-8">
                    <h2 className="text-xl font-bold mb-2">📖 公开API</h2>
                    <p className="text-gray-600">
                        公开只读日程: <code className="bg-gray-100 px-2 py-1 rounded">GET /api/schedules/public</code>
                    </p>
                    <p className="text-gray-600 mt-2">
                        这个API可以在公开网页上使用，无需认证。
                    </p>
                </div>
            </div>
        </div>
    );
}
