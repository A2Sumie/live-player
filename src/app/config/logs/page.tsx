'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/middleware/WithAuth';
import { useRouter } from 'next/navigation';

export default function LogsPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const [logs, setLogs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

    useEffect(() => {
        if (!authLoading && !user) {
            router.push('/auth/login?redirect=/config/logs');
        }
    }, [user, authLoading, router]);

    const fetchLogs = async () => {
        if (!user) return; // double check

        setLoading(true);
        try {
            const res = await fetch('/api/logs?limit=100');
            if (res.status === 403 || res.status === 401) {
                // Handling API rejection if UI check passes but token invalid
                // But generally handled by useAuth
            }
            if (res.ok) {
                const data = await res.json() as any[];
                setLogs(data);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (user) {
            fetchLogs();
        }
    }, [user]); // Add user dependency

    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (autoRefresh) {
            interval = setInterval(() => {
                // Background fetch without setting global loading state
                fetch('/api/logs?limit=100').then(res => {
                    if (res.ok) res.json().then((data) => setLogs(data as any[]));
                });
            }, 5000);
        }
        return () => clearInterval(interval);
    }, [autoRefresh]);

    const toggleRow = (id: number) => {
        const newSet = new Set(expandedRows);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setExpandedRows(newSet);
    };

    const getLevelColor = (level: string) => {
        switch (level) {
            case 'error': return 'text-red-500 font-bold';
            case 'warn': return 'text-yellow-500 font-bold';
            default: return 'text-blue-400';
        }
    };

    if (authLoading || !user) {
        return <div className="min-h-screen bg-black flex items-center justify-center text-white">Loading...</div>;
    }

    return (
        <div className="min-h-screen bg-gray-900 text-white p-8">
            <div className="flex justify-between items-center mb-6">
                <div className="flex items-center space-x-4">
                    <h1 className="text-2xl font-bold">System Logs</h1>
                    <span className="bg-gray-800 px-2 py-1 rounded text-xs text-gray-400">Last 100 entries</span>
                </div>
                <div className="flex items-center space-x-4">
                    <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={autoRefresh}
                            onChange={(e) => setAutoRefresh(e.target.checked)}
                            className="form-checkbox h-5 w-5 text-blue-600"
                        />
                        <span className="text-sm">Auto Refresh (5s)</span>
                    </label>
                    <button onClick={fetchLogs} className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-700 transition">
                        {loading ? 'Refreshing...' : 'Refresh'}
                    </button>
                    <Link href="/config" className="px-4 py-2 bg-gray-700 rounded hover:bg-gray-600 transition">Back to Config</Link>
                </div>
            </div>

            <div className="bg-gray-800 rounded-lg overflow-hidden shadow-xl border border-gray-700">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-gray-900 text-gray-400 uppercase text-xs">
                            <tr>
                                <th className="px-4 py-3 border-b border-gray-700 w-48">Time</th>
                                <th className="px-4 py-3 border-b border-gray-700 w-24">Level</th>
                                <th className="px-4 py-3 border-b border-gray-700 w-32">Source</th>
                                <th className="px-4 py-3 border-b border-gray-700">Message</th>
                                <th className="px-4 py-3 border-b border-gray-700 w-20">Details</th>
                            </tr>
                        </thead>
                        <tbody className="text-sm divide-y divide-gray-700">
                            {logs.map((log) => (
                                <>
                                    <tr
                                        key={log.id}
                                        className={`hover:bg-gray-750 cursor-pointer ${expandedRows.has(log.id) ? 'bg-gray-750' : ''}`}
                                        onClick={() => toggleRow(log.id)}
                                    >
                                        <td className="px-4 py-3 text-gray-400 text-xs font-mono whitespace-nowrap">
                                            {new Date(log.createdAt).toLocaleString()}
                                        </td>
                                        <td className={`px-4 py-3 ${getLevelColor(log.level)} uppercase text-xs`}>
                                            {log.level}
                                        </td>
                                        <td className="px-4 py-3 text-gray-300 font-medium">
                                            {log.source || '-'}
                                        </td>
                                        <td className="px-4 py-3 text-white">
                                            {log.message}
                                        </td>
                                        <td className="px-4 py-3 text-center text-gray-500">
                                            {log.details ? (expandedRows.has(log.id) ? '▼' : '▶') : ''}
                                        </td>
                                    </tr>
                                    {expandedRows.has(log.id) && log.details && (
                                        <tr>
                                            <td colSpan={5} className="px-4 py-3 bg-gray-900/50 border-b border-gray-700">
                                                <pre className="text-xs text-green-400 font-mono overflow-x-auto p-2 bg-black/30 rounded border border-gray-700/50">
                                                    {(() => {
                                                        try {
                                                            // Try to prettify JSON
                                                            return JSON.stringify(JSON.parse(log.details), null, 2);
                                                        } catch {
                                                            return log.details;
                                                        }
                                                    })()}
                                                </pre>
                                            </td>
                                        </tr>
                                    )}
                                </>
                            ))}
                            {logs.length === 0 && !loading && (
                                <tr>
                                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500 italic">
                                        No logs found.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
