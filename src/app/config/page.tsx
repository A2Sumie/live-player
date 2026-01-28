'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/middleware/WithAuth';

interface Crawler {
    name: string;
    type: string;
    schedule: string | null;
    cookieFile: string | null;
    enabled: boolean;
}

export default function ConfigManagePage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const [crawlers, setCrawlers] = useState<Crawler[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [editingSchedule, setEditingSchedule] = useState<string | null>(null);
    const [newSchedule, setNewSchedule] = useState('');

    useEffect(() => {
        if (!authLoading && !user) {
            router.push('/auth/login?redirect=/config');
        }
    }, [user, authLoading, router]);

    useEffect(() => {
        if (user) {
            fetchCrawlers();
        }
    }, [user]);

    const fetchCrawlers = async () => {
        setLoading(true);
        setError('');

        try {
            const response = await fetch('/api/config/crawlers');

            if (response.status === 401) {
                router.push('/auth/login?redirect=/config');
                return;
            }

            if (!response.ok) {
                throw new Error('Failed to fetch crawler config');
            }

            const data = await response.json() as Crawler[];
            setCrawlers(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load crawlers');
        } finally {
            setLoading(false);
        }
    };

    const parseCronExpression = (cron: string | null): string => {
        if (!cron) return 'No schedule';

        // 简单的cron表达式解析
        const parts = cron.split(' ');
        if (parts.length === 5) {
            const [minute, hour, , , weekday] = parts;

            if (minute === '*/5') return 'Every 5 minutes';
            if (minute === '*/10') return 'Every 10 minutes';
            if (minute === '*/30') return 'Every 30 minutes';
            if (hour === '*/1') return 'Every hour';

            if (hour !== '*' && minute !== '*') {
                return `Daily at ${hour}:${minute.padStart(2, '0')}`;
            }
        }

        return cron;
    };

    if (authLoading || !user) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-indigo-900 flex items-center justify-center">
                <div className="text-white text-xl">Loading...</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-indigo-900 p-8">
            <div className="max-w-7xl mx-auto">
                <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
                    <h1 className="text-4xl font-bold text-white mb-6 flex items-center gap-3">
                        <span className="text-5xl">⚙️</span>
                        Crawler Configuration
                    </h1>

                    <div className="mb-6 text-sm text-white/60">
                        Logged in as <span className="font-semibold text-white">{user.username}</span>
                    </div>

                    {error && (
                        <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200">
                            {error}
                        </div>
                    )}

                    {/* Crawler Table */}
                    {(
                        <div className="space-y-4">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-2xl font-bold text-white">Crawlers ({crawlers.length})</h2>
                                <button
                                    onClick={fetchCrawlers}
                                    disabled={loading}
                                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-lg transition-colors"
                                >
                                    {loading ? 'Loading...' : 'Refresh'}
                                </button>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="text-left border-b border-white/20">
                                            <th className="pb-3 px-4 text-white font-semibold">Name</th>
                                            <th className="pb-3 px-4 text-white font-semibold">Type</th>
                                            <th className="pb-3 px-4 text-white font-semibold">Schedule</th>
                                            <th className="pb-3 px-4 text-white font-semibold">Cookie File</th>
                                            <th className="pb-3 px-4 text-white font-semibold">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {crawlers.map(crawler => (
                                            <tr
                                                key={crawler.name}
                                                className="border-b border-white/10 hover:bg-white/5 transition-colors"
                                            >
                                                <td className="py-4 px-4 text-white font-medium">{crawler.name}</td>
                                                <td className="py-4 px-4">
                                                    <span className="px-2 py-1 bg-blue-600/30 text-blue-200 rounded text-sm">
                                                        {crawler.type}
                                                    </span>
                                                </td>
                                                <td className="py-4 px-4">
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-white/80 text-sm">
                                                            {parseCronExpression(crawler.schedule)}
                                                        </span>
                                                        {crawler.schedule && (
                                                            <span className="text-white/40 text-xs font-mono">
                                                                {crawler.schedule}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="py-4 px-4">
                                                    {crawler.cookieFile ? (
                                                        <span className="text-green-400 text-sm font-mono">
                                                            {crawler.cookieFile.split('/').pop()}
                                                        </span>
                                                    ) : (
                                                        <span className="text-white/40 text-sm">N/A</span>
                                                    )}
                                                </td>
                                                <td className="py-4 px-4">
                                                    <span className={`px-2 py-1 rounded text-sm ${crawler.enabled
                                                        ? 'bg-green-600/30 text-green-200'
                                                        : 'bg-gray-600/30 text-gray-200'
                                                        }`}>
                                                        {crawler.enabled ? 'Enabled' : 'Disabled'}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <div className="mt-6 p-4 bg-yellow-500/20 border border-yellow-500/50 rounded-lg">
                                <p className="text-yellow-200 text-sm">
                                    <strong>Note:</strong> Schedule editing will be available in a future update.
                                    For now, this page provides a read-only view of your crawler configurations.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
