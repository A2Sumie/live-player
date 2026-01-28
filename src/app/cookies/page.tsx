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

interface Crawler {
    name: string;
    cookieFile: string | null;
}

export default function CookieManagerPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();

    // Data State
    const [cookies, setCookies] = useState<CookieFile[]>([]);
    const [crawlers, setCrawlers] = useState<Crawler[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // UI State
    const [viewMode, setViewMode] = useState<'list' | 'edit' | 'create'>('list');
    const [selectedCookie, setSelectedCookie] = useState<CookieDetail | null>(null);

    // Editor State
    const [editorFinder, setEditorFinder] = useState('');
    const [editorSecret, setEditorSecret] = useState('');
    const [editorContent, setEditorContent] = useState('');
    const [editorStatus, setEditorStatus] = useState<string | null>(null);
    const [editorLoading, setEditorLoading] = useState(false);

    // Selection & Delete State
    const [selectedCookies, setSelectedCookies] = useState<Set<string>>(new Set());
    const [deleting, setDeleting] = useState(false);

    useEffect(() => {
        if (!authLoading && !user) {
            router.push('/auth/login?redirect=/cookies');
        }
    }, [user, authLoading, router]);

    useEffect(() => {
        if (user) {
            fetchData();
        }
    }, [user]);

    const fetchData = async () => {
        setLoading(true);
        setError('');
        try {
            const [cookiesRes, crawlersRes] = await Promise.all([
                fetch('/api/cookies/list'),
                fetch('/api/config/crawlers')
            ]);

            if (cookiesRes.status === 401 || crawlersRes.status === 401) {
                router.push('/auth/login?redirect=/cookies');
                return;
            }

            if (!cookiesRes.ok) throw new Error('Failed to fetch cookies');
            // Crawlers might fail if not available, treat as empty but don't crash
            const cookiesData = await cookiesRes.json() as CookieFile[];

            let crawlersData: Crawler[] = [];
            if (crawlersRes.ok) {
                crawlersData = await crawlersRes.json() as Crawler[];
            }

            // Sort: Used first, then Alphabetical
            cookiesData.sort((a, b) => {
                const aUsed = crawlersData.some(c => c.cookieFile?.includes(a.filename));
                const bUsed = crawlersData.some(c => c.cookieFile?.includes(b.filename));

                if (aUsed && !bUsed) return -1;
                if (!aUsed && bUsed) return 1;
                return a.name.localeCompare(b.name);
            });

            setCookies(cookiesData);
            setCrawlers(crawlersData);

        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load data');
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = () => {
        setEditorFinder('');
        setEditorContent('');
        setEditorStatus(null);
        setViewMode('create');
    };

    const handleEdit = async (name: string) => {
        setLoading(true);
        try {
            const res = await fetch(`/api/cookies/view/${name}`);
            if (!res.ok) throw new Error('Failed to load cookie details');
            const data = await res.json() as CookieDetail;

            setSelectedCookie(data);
            setEditorFinder(data.name);
            setEditorContent(data.content);
            setEditorStatus(null);
            setViewMode('edit');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load cookie for editing');
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setEditorLoading(true);
        setEditorStatus(null);

        try {
            const res = await fetch('/api/cookies', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${editorSecret}`
                },
                body: JSON.stringify({
                    finder: editorFinder,
                    cookie: editorContent
                })
            });

            const text = await res.text();

            if (res.ok) {
                setEditorStatus('Success: Cookie updated!');
                // Refresh list
                fetchData();
                // Optionally go back to list after delay
                setTimeout(() => {
                    if (viewMode === 'create') setViewMode('list');
                }, 1500);
            } else {
                setEditorStatus(`Error: ${text} (${res.status})`);
            }
        } catch (err: any) {
            setEditorStatus(`Error: ${err.message}`);
        } finally {
            setEditorLoading(false);
        }
    };

    const getUsedBy = (cookie: CookieFile) => {
        return crawlers.filter(c => c.cookieFile && c.cookieFile.includes(cookie.filename));
    };

    const toggleSelection = (filename: string) => {
        const newSelected = new Set(selectedCookies);
        if (newSelected.has(filename)) {
            newSelected.delete(filename);
        } else {
            newSelected.add(filename);
        }
        setSelectedCookies(newSelected);
    };

    const handleSelectAll = (select: boolean) => {
        if (select) {
            setSelectedCookies(new Set(cookies.map(c => c.filename)));
        } else {
            setSelectedCookies(new Set());
        }
    };

    const handleSelectUnused = () => {
        const unused = cookies.filter(c => {
            const usedBy = getUsedBy(c);
            return usedBy.length === 0;
        }).map(c => c.filename);
        setSelectedCookies(new Set(unused));
    };

    const handleBulkDelete = async () => {
        if (selectedCookies.size === 0) return;
        if (!confirm(`Are you sure you want to delete ${selectedCookies.size} cookies? This cannot be undone.`)) return;

        setDeleting(true);
        try {
            const res = await fetch('/api/cookies/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filenames: Array.from(selectedCookies) })
            });

            const text = await res.text();
            if (!res.ok) throw new Error(`Delete failed: ${res.status} - ${text}`);

            await fetchData(); // Refresh list
            setSelectedCookies(new Set()); // Clear selection
        } catch (error: any) {
            console.error('Delete error', error);
            setError(`Failed to delete cookies: ${error.message}`);
        } finally {
            setDeleting(false);
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
                    {/* Header */}
                    <div className="flex justify-between items-center mb-8">
                        <div>
                            <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-3">
                                <span className="text-5xl">🍪</span>
                                Cookie Manager
                            </h1>
                            <div className="text-sm text-white/60">
                                Logged in as <span className="font-semibold text-white">{user.username}</span>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            {viewMode === 'list' && selectedCookies.size > 0 && (
                                <button
                                    onClick={handleBulkDelete}
                                    disabled={deleting}
                                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors flex items-center gap-2 font-medium"
                                >
                                    {deleting ? 'Deleting...' : `Delete (${selectedCookies.size})`}
                                </button>
                            )}
                            {viewMode !== 'list' && (
                                <button
                                    onClick={() => setViewMode('list')}
                                    className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors"
                                >
                                    ← Back to List
                                </button>
                            )}
                            {viewMode === 'list' && (
                                <button
                                    onClick={handleCreate}
                                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors font-medium shadow-lg shadow-purple-900/50"
                                >
                                    + New Cookie
                                </button>
                            )}
                        </div>
                    </div>

                    {error && (
                        <div className="mb-6 space-y-2">
                            <div className="p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 flex justify-between items-center">
                                <span>{error}</span>
                                <button onClick={() => setError('')} className="ml-4 underline text-xs hover:text-white">
                                    Close
                                </button>
                            </div>
                            <div className="p-2 bg-black/50 border border-white/10 rounded font-mono text-xs text-white/60">
                                <strong>Debug Log:</strong>
                                <pre className="whitespace-pre-wrap mt-1">{error}</pre>
                            </div>
                        </div>
                    )}

                    {/* List View */}
                    {viewMode === 'list' && (
                        <div className="space-y-4">
                            {/* Toolbar */}
                            <div className="bg-black/20 border border-white/5 rounded-lg p-2 flex gap-4 text-xs px-4 items-center">
                                <button onClick={() => handleSelectAll(true)} className="hover:text-white text-white/60 transition-colors">Select All</button>
                                <div className="w-px h-3 bg-white/10"></div>
                                <button onClick={() => handleSelectAll(false)} className="hover:text-white text-white/60 transition-colors">Deselect All</button>
                                <div className="w-px h-3 bg-white/10"></div>
                                <button onClick={handleSelectUnused} className="hover:text-blue-300 text-blue-400/80 transition-colors">Select Unused</button>
                                <span className="ml-auto text-white/40">{selectedCookies.size} selected</span>
                            </div>

                            {cookies.length === 0 && !loading && (
                                <div className="text-white/60 text-center py-12 border-2 border-dashed border-white/10 rounded-xl">
                                    <div className="text-4xl mb-4">📭</div>
                                    No cookies found. Create one to get started.
                                </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {cookies.map(cookie => {
                                    const usedBy = getUsedBy(cookie);
                                    const isUnused = usedBy.length === 0;

                                    return (
                                        <div
                                            key={cookie.name}
                                            onClick={() => toggleSelection(cookie.filename)}
                                            className={`group relative p-5 rounded-xl border transition-all cursor-pointer flex flex-col h-full ${selectedCookies.has(cookie.filename)
                                                ? 'bg-purple-900/40 border-purple-500/50 shadow-lg shadow-purple-900/20'
                                                : 'bg-black/20 border-white/10 hover:bg-black/40 hover:border-purple-500/30'
                                                }`}
                                        >
                                            <div className="absolute top-4 right-4 z-10">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedCookies.has(cookie.filename)}
                                                    onChange={() => toggleSelection(cookie.filename)}
                                                    className="w-5 h-5 rounded border-white/30 bg-black/50 checked:bg-purple-600 accent-purple-600 cursor-pointer"
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            </div>

                                            <div className="flex justify-between items-start mb-3 pr-8">
                                                <h3 className="text-lg font-bold text-white group-hover:text-purple-300 transition-colors truncate w-full" title={cookie.name}>
                                                    {cookie.name}
                                                </h3>
                                            </div>

                                            <div className="mb-3">
                                                {isUnused ? (
                                                    <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-200 text-xs rounded border border-yellow-500/30">
                                                        Unused
                                                    </span>
                                                ) : (
                                                    <div className="flex flex-wrap gap-1">
                                                        {usedBy.map(c => (
                                                            <span key={c.name} className="px-2 py-0.5 bg-green-500/20 text-green-200 text-xs rounded border border-green-500/30">
                                                                {c.name}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>

                                            <div className="flex-grow">
                                                <code className="text-xs text-white/40 break-all block">
                                                    {cookie.filename}
                                                </code>
                                            </div>

                                            <div className="mt-4 pt-4 border-t border-white/5 flex justify-between items-center text-xs text-white/50">
                                                <div className="flex gap-3">
                                                    <span>{(cookie.size / 1024).toFixed(2)} KB</span>
                                                    <span>{new Date(cookie.lastModified).toLocaleDateString()}</span>
                                                </div>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleEdit(cookie.name);
                                                    }}
                                                    className="p-1.5 hover:bg-white/10 rounded-full text-white/40 hover:text-white transition-colors"
                                                    title="Edit Content"
                                                >
                                                    <span className="text-lg">✏️</span>
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Edit/Create View */}
                    {(viewMode === 'edit' || viewMode === 'create') && (
                        <div className="max-w-2xl mx-auto">
                            <h2 className="text-2xl font-bold text-white mb-6">
                                {viewMode === 'create' ? 'Create New Cookie' : `Editing ${editorFinder}`}
                            </h2>

                            <form onSubmit={handleSave} className="space-y-6">
                                <div>
                                    <label className="block text-sm font-medium text-white/80 mb-1">
                                        Finder Name (Crawler Identifier)
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        disabled={viewMode === 'edit'}
                                        className="w-full px-4 py-2 bg-black/30 border border-white/10 rounded-lg text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
                                        placeholder="e.g. twitter"
                                        value={editorFinder}
                                        onChange={(e) => setEditorFinder(e.target.value)}
                                    />
                                    <p className="mt-1 text-xs text-white/40">This will determine the filename (e.g., twitter.txt)</p>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-white/80 mb-1">
                                        API Secret
                                    </label>
                                    <input
                                        type="password"
                                        required
                                        className="w-full px-4 py-2 bg-black/30 border border-white/10 rounded-lg text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-purple-500"
                                        placeholder="Enter server API secret to authorize"
                                        value={editorSecret}
                                        onChange={(e) => setEditorSecret(e.target.value)}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-white/80 mb-1">
                                        Cookie Content (Netscape Format)
                                    </label>
                                    <textarea
                                        rows={12}
                                        required
                                        className="w-full px-4 py-2 bg-black/30 border border-white/10 rounded-lg text-white font-mono text-xs placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-purple-500"
                                        placeholder="# Netscape HTTP Cookie File..."
                                        value={editorContent}
                                        onChange={(e) => setEditorContent(e.target.value)}
                                    />
                                </div>

                                <div className="flex gap-4">
                                    <button
                                        type="submit"
                                        disabled={editorLoading}
                                        className={`flex-1 py-3 px-4 rounded-lg text-white font-medium shadow-lg transition-all ${editorLoading
                                            ? 'bg-purple-600/50 cursor-not-allowed'
                                            : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 transform hover:-translate-y-0.5'
                                            }`}
                                    >
                                        {editorLoading ? 'Saving...' : 'Save Cookie'}
                                    </button>
                                </div>

                                {editorStatus && (
                                    <div className={`p-4 rounded-lg text-center text-sm ${editorStatus.startsWith('Success')
                                        ? 'bg-green-500/20 text-green-200 border border-green-500/30'
                                        : 'bg-red-500/20 text-red-200 border border-red-500/30'
                                        }`}>
                                        {editorStatus}
                                    </div>
                                )}
                            </form>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
