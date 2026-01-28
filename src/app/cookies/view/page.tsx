'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/middleware/WithAuth';

interface CookieFile {
    name: string;
    filename: string;
    lastModified: string;
    size: number;
}

interface CookieDetail {
    name: string;
    content: string;
    lastModified: string;
    size: number;
}

export default function CookieViewPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const [cookies, setCookies] = useState<CookieFile[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [selectedCookie, setSelectedCookie] = useState<CookieDetail | null>(null);
    const [viewingCookie, setViewingCookie] = useState(false);

    useEffect(() => {
        if (!authLoading && !user) {
            router.push('/auth/login?redirect=/cookies/view');
        }
    }, [user, authLoading, router]);

    useEffect(() => {
        if (user) {
            fetchCookies();
        }
    }, [user]);

    const fetchCookies = async () => {
        setLoading(true);
        setError('');

        try {
            const response = await fetch('/api/cookies/list');

            if (response.status === 401) {
                router.push('/auth/login?redirect=/cookies/view');
                return;
            }

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Failed to fetch cookies' })) as { error?: string };
                throw new Error(errorData.error || 'Failed to fetch cookies');
            }

            const data = await response.json() as CookieFile[];
            setCookies(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load cookies');
        } finally {
            setLoading(false);
        }
    };

    const viewCookie = async (name: string) => {
        setViewingCookie(true);
        setError('');

        try {
            const response = await fetch(`/api/cookies/view/${name}`);

            if (response.status === 401) {
                router.push('/auth/login?redirect=/cookies/view');
                return;
            }

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Failed to fetch cookie details' })) as { error?: string };
                throw new Error(errorData.error || 'Failed to fetch cookie details');
            }

            const data = await response.json() as CookieDetail;
            setSelectedCookie(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load cookie');
        } finally {
            setViewingCookie(false);
        }
    };

    if (authLoading || !user) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-violet-900 flex items-center justify-center">
                <div className="text-white text-xl">Loading...</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-violet-900 p-8">
            <div className="max-w-6xl mx-auto">
                <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
                    <h1 className="text-4xl font-bold text-white mb-6 flex items-center gap-3">
                        <span className="text-5xl">🍪</span>
                        Cookie Manager - View
                    </h1>

                    <div className="mb-6 text-sm text-white/60">
                        Logged in as <span className="font-semibold text-white">{user.username}</span>
                    </div>

                    {error && (
                        <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200">
                            {error}
                        </div>
                    )}

                    {/* Cookie List */}
                    {!selectedCookie && (
                        <div className="space-y-4">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-2xl font-bold text-white">Available Cookies</h2>
                                <button
                                    onClick={fetchCookies}
                                    disabled={loading}
                                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white rounded-lg transition-colors"
                                >
                                    {loading ? 'Loading...' : 'Refresh'}
                                </button>
                            </div>

                            {cookies.length === 0 && !loading && (
                                <div className="text-white/60 text-center py-8">
                                    No cookies found
                                </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {cookies.map(cookie => (
                                    <div
                                        key={cookie.name}
                                        className="p-4 bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 transition-all cursor-pointer"
                                        onClick={() => viewCookie(cookie.name)}
                                    >
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <h3 className="text-lg font-semibold text-white">{cookie.name}</h3>
                                                <p className="text-sm text-white/60 mt-1">{cookie.filename}</p>
                                            </div>
                                            <button className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded-lg transition-colors">
                                                View
                                            </button>
                                        </div>
                                        <div className="mt-3 flex gap-4 text-xs text-white/60">
                                            <span>Size: {(cookie.size / 1024).toFixed(2)} KB</span>
                                            <span>Modified: {new Date(cookie.lastModified).toLocaleString()}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Cookie Detail View */}
                    {selectedCookie && (
                        <div className="space-y-4">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-2xl font-bold text-white">{selectedCookie.name}</h2>
                                <button
                                    onClick={() => setSelectedCookie(null)}
                                    className="px-4 py-2 bg gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors"
                                >
                                    ← Back to List
                                </button>
                            </div>

                            <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                                <div className="flex gap-4 text-sm text-white/60 mb-4">
                                    <span>Size: {(selectedCookie.size / 1024).toFixed(2)} KB</span>
                                    <span>Last Modified: {new Date(selectedCookie.lastModified).toLocaleString()}</span>
                                </div>

                                <div className="bg-black/30 rounded-lg p-4 overflow-auto max-h-96">
                                    <pre className="text-sm text-green-400 font-mono whitespace-pre-wrap">
                                        {selectedCookie.content}
                                    </pre>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
