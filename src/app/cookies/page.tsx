
'use client'

import { useState } from 'react'
import { useAuth } from '@/middleware/WithAuth'

export default function CookieManager() {
    const { user } = useAuth()
    const [finder, setFinder] = useState('twitter')
    const [secret, setSecret] = useState('')
    const [cookie, setCookie] = useState('')
    const [status, setStatus] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setStatus(null)

        try {
            const res = await fetch('/api/cookies', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${secret}`
                },
                body: JSON.stringify({ finder, cookie })
            })

            const text = await res.text()

            if (res.ok) {
                setStatus('Success: Cookie updated!')
            } else {
                setStatus(`Error: ${text} (${res.status})`)
            }
        } catch (err: any) {
            setStatus(`Error: ${err.message}`)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen p-8 flex items-center justify-center">
            <div className="max-w-2xl w-full space-y-8 p-8 border border-gray-200 dark:border-gray-800 rounded-lg shadow-lg bg-white dark:bg-black">
                <div>
                    <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-6 flex items-center gap-3">
                        <span className="text-5xl">🍪</span>
                        Cookie Manager
                    </h1>

                    <div className="mb-6 flex justify-between items-center">
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                            Logged in as <span className="font-semibold text-gray-900 dark:text-white">{user?.username || 'loading...'}</span>
                        </div>
                        <a
                            href="/cookies/view"
                            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
                        >
                            View Existing Cookies
                        </a>
                    </div>
                    <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
                        Update crawler cookies on 3020e
                    </p>
                </div>
                <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
                    <div className="rounded-md shadow-sm -space-y-px">
                        <div className="mb-4">
                            <label htmlFor="finder" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                Finder (Crawler Name)
                            </label>
                            <input
                                id="finder"
                                name="finder"
                                type="text"
                                required
                                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 dark:border-gray-700 placeholder-gray-500 text-gray-900 dark:text-white dark:bg-gray-900 rounded-t-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                                placeholder="e.g. twitter, instagram"
                                value={finder}
                                onChange={(e) => setFinder(e.target.value)}
                            />
                        </div>
                        <div className="mb-4">
                            <label htmlFor="secret" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                API Secret
                            </label>
                            <input
                                id="secret"
                                name="secret"
                                type="password"
                                required
                                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 dark:border-gray-700 placeholder-gray-500 text-gray-900 dark:text-white dark:bg-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                                placeholder="Secret Token"
                                value={secret}
                                onChange={(e) => setSecret(e.target.value)}
                            />
                        </div>
                        <div className="mb-4">
                            <label htmlFor="cookie" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                Cookie Content (Netscape Format)
                            </label>
                            <textarea
                                id="cookie"
                                name="cookie"
                                rows={10}
                                required
                                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 dark:border-gray-700 placeholder-gray-500 text-gray-900 dark:text-white dark:bg-gray-900 rounded-b-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm font-mono text-xs"
                                placeholder="# Netscape HTTP Cookie File..."
                                value={cookie}
                                onChange={(e) => setCookie(e.target.value)}
                            />
                        </div>
                    </div>

                    <div>
                        <button
                            type="submit"
                            disabled={loading}
                            className={`group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white ${loading ? 'bg-indigo-400' : 'bg-indigo-600 hover:bg-indigo-700'
                                } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500`}
                        >
                            {loading ? 'Updating...' : 'Update Cookie'}
                        </button>
                    </div>

                    {status && (
                        <div className={`mt-2 text-center text-sm ${status.startsWith('Success') ? 'text-green-600' : 'text-red-600'}`}>
                            {status}
                        </div>
                    )}
                </form>
            </div>
        </div>
    )
}
