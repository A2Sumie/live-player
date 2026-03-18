'use client';

import { useEffect, useMemo, useState } from 'react';

type CookieFile = {
  name: string;
  filename: string;
  lastModified: string;
  size: number;
};

type CookieDetail = {
  name: string;
  content: string;
  lastModified: string;
  size: number;
};

type CrawlerSummary = {
  name: string;
  cookieFile: string | null;
};

export default function CookiesPanel() {
  const [cookies, setCookies] = useState<CookieFile[]>([]);
  const [crawlers, setCrawlers] = useState<CrawlerSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'edit' | 'create'>('list');
  const [editorFinder, setEditorFinder] = useState('');
  const [editorContent, setEditorContent] = useState('');
  const [editorStatus, setEditorStatus] = useState<string | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [selectedCookies, setSelectedCookies] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const [cookiesRes, crawlersRes] = await Promise.all([
        fetch('/api/cookies/list'),
        fetch('/api/config/crawlers'),
      ]);

      if (!cookiesRes.ok) {
        throw new Error('获取 Cookies 失败');
      }

      const cookiesData = (await cookiesRes.json()) as CookieFile[];
      const crawlersData = crawlersRes.ok
        ? ((await crawlersRes.json()) as CrawlerSummary[])
        : [];

      cookiesData.sort((a, b) => {
        const aUsed = crawlersData.some((crawler) =>
          crawler.cookieFile?.includes(a.filename)
        );
        const bUsed = crawlersData.some((crawler) =>
          crawler.cookieFile?.includes(b.filename)
        );

        if (aUsed && !bUsed) return -1;
        if (!aUsed && bUsed) return 1;
        return a.name.localeCompare(b.name);
      });

      setCookies(cookiesData);
      setCrawlers(crawlersData);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载 Cookies 失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const cookieUsage = useMemo(() => {
    const usage = new Map<string, CrawlerSummary[]>();
    for (const cookie of cookies) {
      usage.set(
        cookie.filename,
        crawlers.filter((crawler) => crawler.cookieFile?.includes(cookie.filename))
      );
    }
    return usage;
  }, [cookies, crawlers]);

  const handleCreate = () => {
    setEditorFinder('');
    setEditorContent('');
    setEditorStatus(null);
    setViewMode('create');
  };

  const handleEdit = async (name: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/cookies/view/${encodeURIComponent(name)}`);
      if (!res.ok) {
        throw new Error('读取 Cookie 失败');
      }

      const data = (await res.json()) as CookieDetail;
      setEditorFinder(data.name);
      setEditorContent(data.content);
      setEditorStatus(null);
      setViewMode('edit');
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取 Cookie 失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setEditorLoading(true);
    setEditorStatus(null);

    try {
      const res = await fetch('/api/cookies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          finder: editorFinder,
          cookie: editorContent,
        }),
      });

      const text = await res.text();
      if (!res.ok) {
        throw new Error(text || '保存 Cookie 失败');
      }

      setEditorStatus('已保存');
      await fetchData();
      if (viewMode === 'create') {
        setViewMode('list');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存失败';
      setEditorStatus(message);
    } finally {
      setEditorLoading(false);
    }
  };

  const toggleSelection = (filename: string) => {
    setSelectedCookies((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) {
        next.delete(filename);
      } else {
        next.add(filename);
      }
      return next;
    });
  };

  const handleSelectAll = (select: boolean) => {
    if (select) {
      setSelectedCookies(new Set(cookies.map((cookie) => cookie.filename)));
    } else {
      setSelectedCookies(new Set());
    }
  };

  const handleSelectUnused = () => {
    const unused = cookies
      .filter((cookie) => (cookieUsage.get(cookie.filename) || []).length === 0)
      .map((cookie) => cookie.filename);
    setSelectedCookies(new Set(unused));
  };

  const handleBulkDelete = async () => {
    if (selectedCookies.size === 0) {
      return;
    }

    if (!confirm(`确认删除这 ${selectedCookies.size} 个 Cookie 文件吗？`)) {
      return;
    }

    setDeleting(true);
    try {
      const res = await fetch('/api/cookies/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filenames: Array.from(selectedCookies) }),
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      await fetchData();
      setSelectedCookies(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除 Cookies 失败');
    } finally {
      setDeleting(false);
    }
  };

  const handleRestart = async () => {
    if (!confirm('确认现在重启内部服务吗？')) {
      return;
    }

    setRestarting(true);
    try {
      const res = await fetch('/api/server/restart', { method: 'POST' });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      alert('已发送重启请求。');
    } catch (err) {
      alert(err instanceof Error ? err.message : '重启失败');
    } finally {
      setRestarting(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300/80">
              Cookie 管理
            </div>
            <h2 className="mt-2 text-3xl font-semibold text-white">
              已托管的抓取 Cookie 文件
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              创建、更新和清理供抓取器使用的 Netscape 格式 Cookie 文件，走现有代理接口完成读写。
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleRestart}
              disabled={restarting}
              className="rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-100 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {restarting ? '重启中...' : '重启服务'}
            </button>
            {viewMode === 'list' ? (
              <button
                type="button"
                onClick={handleCreate}
                className="rounded-full bg-cyan-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-300"
              >
                新建 Cookie
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/10"
              >
                返回列表
              </button>
            )}
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      )}

      {viewMode === 'list' ? (
        <div className="space-y-4">
          <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300">
            <button
              type="button"
              onClick={() => handleSelectAll(true)}
              className="transition hover:text-white"
            >
              全选
            </button>
            <button
              type="button"
              onClick={() => handleSelectAll(false)}
              className="transition hover:text-white"
            >
              取消选择
            </button>
            <button
              type="button"
              onClick={handleSelectUnused}
              className="text-cyan-300 transition hover:text-cyan-200"
            >
              选中未使用项
            </button>
            <button
              type="button"
              onClick={fetchData}
              className="transition hover:text-white"
            >
              刷新
            </button>
            <span className="ml-auto">
              已选择 {selectedCookies.size} 项
            </span>
            {selectedCookies.size > 0 && (
              <button
                type="button"
                onClick={handleBulkDelete}
                disabled={deleting}
                className="rounded-full border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deleting ? '删除中...' : '删除所选'}
              </button>
            )}
          </section>

          {loading ? (
            <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-10 text-center text-slate-400">
              正在加载 Cookies...
            </div>
          ) : cookies.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 px-6 py-10 text-center text-slate-500">
              暂无 Cookie 文件。
            </div>
          ) : (
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {cookies.map((cookie) => {
                const usedBy = cookieUsage.get(cookie.filename) || [];
                const selected = selectedCookies.has(cookie.filename);
                return (
                  <article
                    key={cookie.filename}
                    onClick={() => toggleSelection(cookie.filename)}
                    className={`rounded-3xl border p-5 transition ${
                      selected
                        ? 'border-cyan-400/40 bg-cyan-400/10'
                        : 'border-white/10 bg-slate-950/75 hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-lg font-semibold text-white">
                          {cookie.name}
                        </h3>
                        <p className="mt-1 break-all font-mono text-xs text-slate-400">
                          {cookie.filename}
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleSelection(cookie.filename)}
                        onClick={(event) => event.stopPropagation()}
                        className="accent-cyan-400"
                      />
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {usedBy.length === 0 ? (
                        <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-xs text-amber-100">
                          未使用
                        </span>
                      ) : (
                        usedBy.map((crawler) => (
                          <span
                            key={crawler.name}
                            className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-100"
                          >
                            {crawler.name}
                          </span>
                        ))
                      )}
                    </div>

                    <div className="mt-5 flex items-center justify-between text-xs text-slate-400">
                      <span>{(cookie.size / 1024).toFixed(2)} KB</span>
                      <span>{new Date(cookie.lastModified).toLocaleDateString()}</span>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleEdit(cookie.name);
                        }}
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-200 transition hover:bg-white/10"
                      >
                        编辑
                      </button>
                    </div>
                  </article>
                );
              })}
            </section>
          )}
        </div>
      ) : (
        <section className="rounded-3xl border border-white/10 bg-slate-950/80 p-6">
          <h3 className="text-xl font-semibold text-white">
            {viewMode === 'create' ? '新建 Cookie' : `编辑 ${editorFinder}`}
          </h3>
          <form onSubmit={handleSave} className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-200">
                查找名
              </span>
              <input
                type="text"
                required
                disabled={viewMode === 'edit'}
                value={editorFinder}
                onChange={(event) => setEditorFinder(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/50 disabled:opacity-60"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-200">
                Cookie 内容
              </span>
              <textarea
                rows={14}
                required
                value={editorContent}
                onChange={(event) => setEditorContent(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 font-mono text-xs text-white outline-none transition focus:border-cyan-400/50"
              />
            </label>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={editorLoading}
                className="rounded-full bg-emerald-400 px-5 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {editorLoading ? '保存中...' : '保存'}
              </button>
              {editorStatus && (
                <span className="text-sm text-slate-300">{editorStatus}</span>
              )}
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
