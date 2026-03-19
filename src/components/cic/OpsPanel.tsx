'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

type RuntimeStatus = {
  uptime_sec: number;
  crawlers: number;
  processors: number;
  formatters: number;
  forward_targets: number;
  forwarders: number;
  pending_tasks: number;
  processing_tasks: number;
};

type ArticleRow = {
  id: number;
  platform: number;
  a_id: string;
  u_id: string;
  username: string;
  created_at: number;
  content: string | null;
  translation?: string | null;
  url: string;
  has_media?: boolean;
  media?: Array<{ type?: string; url?: string }> | null;
};

type ProcessorDef = {
  id?: string;
  name?: string;
};

type ConfigPayload = {
  crawlers?: Array<{ name?: string; origin?: string; websites?: string[]; paths?: string[] }>;
  processors?: ProcessorDef[];
};

type QueueTask = {
  id: number;
  type: string;
  status: string;
  action_type?: string | null;
  result_summary?: string | null;
  last_error?: string | null;
  created_at: number;
};

type ProcessorRun = {
  id: number;
  processor_id: string | null;
  action: string;
  source_ref: string | null;
  created_at: number;
};

const PLATFORM_OPTIONS = [
  { value: '1', label: 'X / Twitter' },
  { value: '2', label: 'Instagram' },
  { value: '3', label: 'TikTok' },
  { value: '4', label: 'YouTube' },
  { value: '5', label: '官网 / FC' },
];

const PLATFORM_LABELS: Record<string, string> = {
  '1': 'X',
  '2': 'Instagram',
  '3': 'TikTok',
  '4': 'YouTube',
  '5': '官网 / FC',
};

function inferWebsiteSourceLabel(url?: string) {
  const value = String(url || '').toLowerCase();
  if (!value) return '官网 / FC';
  if (value.includes('/gallery') || value.includes('photoga') || value.includes('member_photo_')) {
    return 'FC PHOTO';
  }
  if (value.includes('/diary/official_blog/')) {
    return 'FC BLOG';
  }
  if (value.includes('/ticket/')) {
    return 'FC TICKET';
  }
  if (value.includes('ct=radio')) {
    return 'FC RADIO';
  }
  if (value.includes('/diary/nananiji_movie')) {
    return 'FC MOVIE';
  }
  if (value.includes('/diary/special/')) {
    return 'FC SPECIAL';
  }
  if (value.includes('/news/')) {
    return '官网 NEWS';
  }
  return '官网 / FC';
}

function inferArticleSourceLabel(article: ArticleRow) {
  if (String(article.platform) !== '5') {
    return null;
  }
  return inferWebsiteSourceLabel(article.url);
}

export default function OpsPanel() {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [config, setConfig] = useState<ConfigPayload | null>(null);
  const [articles, setArticles] = useState<ArticleRow[]>([]);
  const [tasks, setTasks] = useState<QueueTask[]>([]);
  const [runs, setRuns] = useState<ProcessorRun[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState({
    platform: '1',
    u_id: '',
    a_id: '',
    q: '',
    limit: '20',
  });
  const [actionState, setActionState] = useState({
    crawlerName: '',
    processorId: '',
    resendCrawlerName: '',
    processorAction: 'extract',
    processorText: '',
    processorPlatform: '1',
    processorArticleId: '',
    processorUid: '',
    processorStart: '',
    processorEnd: '',
    simulateCrawlerName: '',
    simulateUid: '',
    simulateUsername: '',
    simulateArticleId: '',
    simulateUrl: '',
    simulateCreatedAt: '',
    simulateContent: '',
    simulateMediaUrls: '',
    simulateProcess: true,
    simulateForward: false,
  });
  const [processorResult, setProcessorResult] = useState<any>(null);

  const crawlerOptions = useMemo(
    () => (config?.crawlers || []).map((crawler) => crawler.name).filter(Boolean) as string[],
    [config]
  );
  const processorOptions = useMemo(
    () =>
      (config?.processors || [])
        .map((processor) => processor.id || processor.name)
        .filter(Boolean) as string[],
    [config]
  );

  const loadMeta = async () => {
    const [statusRes, configRes, tasksRes, runsRes] = await Promise.all([
      fetch('/api/runtime/status'),
      fetch('/api/config'),
      fetch('/api/tasks?limit=20'),
      fetch('/api/processor-runs?limit=20'),
    ]);

    if (statusRes.ok) {
      setStatus(await statusRes.json());
    }
    if (configRes.ok) {
      const payload = (await configRes.json()) as ConfigPayload;
      setConfig(payload);
      setActionState((prev) => ({
        ...prev,
        crawlerName: prev.crawlerName || payload.crawlers?.[0]?.name || '',
        resendCrawlerName:
          prev.resendCrawlerName || payload.crawlers?.[0]?.name || '',
        simulateCrawlerName:
          prev.simulateCrawlerName || payload.crawlers?.[0]?.name || '',
        processorId:
          prev.processorId ||
          payload.processors?.[0]?.id ||
          payload.processors?.[0]?.name ||
          '',
      }));
    }
    if (tasksRes.ok) {
      setTasks((await tasksRes.json()) as QueueTask[]);
    }
    if (runsRes.ok) {
      setRuns((await runsRes.json()) as ProcessorRun[]);
    }
  };

  const searchArticles = async (background = false) => {
    if (!background) {
      setLoading(true);
    }
    const params = new URLSearchParams();
    params.set('platform', query.platform);
    params.set('limit', query.limit || '20');
    if (query.u_id) params.set('u_id', query.u_id);
    if (query.a_id) params.set('a_id', query.a_id);
    if (query.q) params.set('q', query.q);
    const res = await fetch(`/api/articles?${params.toString()}`);
    if (res.ok) {
      setArticles((await res.json()) as ArticleRow[]);
    }
    if (!background) {
      setLoading(false);
    }
  };

  useEffect(() => {
    Promise.all([loadMeta(), searchArticles()]).finally(() => setLoading(false));
    const timer = setInterval(() => {
      loadMeta();
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  const resolveCrawlerPlatform = (origin?: string, websites?: string[]) => {
    const normalized = (origin || websites?.[0] || '').toLowerCase();
    if (!normalized) return null;
    if (normalized.includes('x.com') || normalized.includes('twitter.com')) return '1';
    if (normalized.includes('instagram.com')) return '2';
    if (normalized.includes('tiktok.com')) return '3';
    if (normalized.includes('youtube.com') || normalized.includes('youtu.be')) return '4';
    return '5';
  };

  const resolveCrawlerByName = (crawlerName?: string) =>
    (config?.crawlers || []).find((crawler) => crawler.name === crawlerName) || null;

  const resolveResendCrawlerName = (platform: number | string, preferredName?: string) => {
    const targetPlatform = String(platform);
    const compatible = (config?.crawlers || []).filter(
      (crawler) =>
        crawler.name &&
        resolveCrawlerPlatform(crawler.origin, crawler.websites) === targetPlatform
    );
    if (
      preferredName &&
      compatible.some((crawler) => crawler.name === preferredName)
    ) {
      return preferredName;
    }
    return compatible[0]?.name || '';
  };

  const runCrawler = async () => {
    const res = await fetch('/api/actions/crawlers/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ crawler: actionState.crawlerName }),
    });
    if (!res.ok) {
      setMessage(`运行 crawler 失败: ${await res.text()}`);
      return;
    }
    setMessage(`已调度 crawler: ${actionState.crawlerName}`);
    loadMeta();
  };

  const reprocessArticle = async (article: ArticleRow) => {
    const res = await fetch('/api/actions/articles/reprocess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: String(article.platform),
        id: article.id,
        processorId: actionState.processorId,
        force: true,
      }),
    });
    if (!res.ok) {
      setMessage(`重处理失败: ${await res.text()}`);
      return;
    }
    setMessage(`已重处理 ${article.a_id}`);
    searchArticles(true);
    loadMeta();
  };

  const resendArticle = async (article: ArticleRow) => {
    const crawlerName = resolveResendCrawlerName(
      article.platform,
      actionState.resendCrawlerName
    );
    if (!crawlerName) {
      setMessage(`重发失败: 未找到平台 ${article.platform} 对应的 crawler`);
      return;
    }
    setActionState((prev) => ({ ...prev, resendCrawlerName: crawlerName }));
    const res = await fetch('/api/actions/articles/resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: String(article.platform),
        id: article.id,
        crawlerName,
      }),
    });
    if (!res.ok) {
      setMessage(`重发失败: ${await res.text()}`);
      return;
    }
    setMessage(`已重发 ${article.a_id} -> ${crawlerName}`);
    loadMeta();
  };

  const simulateArticle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const crawler = resolveCrawlerByName(actionState.simulateCrawlerName);
    const payload: Record<string, unknown> = {
      crawlerName: actionState.simulateCrawlerName,
      processWithCrawler: actionState.simulateProcess,
      forwardAfterSave: actionState.simulateForward,
      content: actionState.simulateContent,
    };

    if (actionState.simulateUid) payload.u_id = actionState.simulateUid;
    if (actionState.simulateUsername) payload.username = actionState.simulateUsername;
    if (actionState.simulateArticleId) payload.a_id = actionState.simulateArticleId;
    if (actionState.simulateUrl) payload.url = actionState.simulateUrl;
    if (actionState.simulateCreatedAt) payload.created_at = actionState.simulateCreatedAt;
    if (actionState.simulateMediaUrls.trim()) {
      payload.mediaUrls = actionState.simulateMediaUrls
        .split('\n')
        .map((entry) => entry.trim())
        .filter(Boolean);
    }

    if (!payload.u_id && crawler?.paths?.[0]) {
      payload.u_id = crawler.paths[0].replace(/^@+/, '');
    }

    const res = await fetch('/api/actions/articles/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => null)) as any;
    if (!res.ok) {
      setMessage(`模拟抓取失败: ${data?.error || 'unknown error'}`);
      return;
    }

    setMessage(
      `已模拟抓取 ${data?.article?.a_id || actionState.simulateArticleId || 'new article'}${
        data?.forwarded ? ' 并完成重发' : ''
      }`
    );
    setActionState((prev) => ({
      ...prev,
      simulateArticleId: '',
      simulateUrl: '',
      simulateCreatedAt: '',
      simulateContent: '',
      simulateMediaUrls: '',
    }));
    searchArticles(true);
    loadMeta();
  };

  const runProcessor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload: Record<string, unknown> = {
      processorId: actionState.processorId,
      action: actionState.processorAction,
    };
    if (actionState.processorText) {
      payload.text = actionState.processorText;
    } else if (actionState.processorArticleId) {
      payload.platform = actionState.processorPlatform;
      payload.id = Number(actionState.processorArticleId);
    } else if (
      actionState.processorUid &&
      actionState.processorStart &&
      actionState.processorEnd
    ) {
      payload.platform = actionState.processorPlatform;
      payload.u_id = actionState.processorUid;
      payload.start = Number(actionState.processorStart);
      payload.end = Number(actionState.processorEnd);
    }

    const res = await fetch('/api/actions/processors/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => null)) as any;
    if (!res.ok) {
      setMessage(`processor 执行失败: ${data?.error || 'unknown error'}`);
      return;
    }
    setProcessorResult(data?.result || data);
    setMessage(`processor 执行完成: ${actionState.processorAction}`);
    loadMeta();
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300/80">
              Ops
            </div>
            <h2 className="mt-2 text-3xl font-semibold text-white">
              Runtime actions and fixed views
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
              这里提供 CIC 白名单热操作、数据库查询和 processor 结果查看，不开放任意 SQL。
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <select
              value={actionState.crawlerName}
              onChange={(event) =>
                setActionState((prev) => ({
                  ...prev,
                  crawlerName: event.target.value,
                  resendCrawlerName: prev.resendCrawlerName || event.target.value,
                }))
              }
              className="rounded-full border border-white/10 bg-black/20 px-4 py-2 text-sm text-white"
            >
              {crawlerOptions.map((crawler) => (
                <option key={crawler} value={crawler}>
                  {crawler}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={runCrawler}
              className="rounded-full bg-cyan-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-300"
            >
              立即运行 Crawler
            </button>
          </div>
        </div>

        {message && (
          <div className="mt-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
            {message}
          </div>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Crawlers" value={String(status?.crawlers || 0)} />
        <StatCard label="Processors" value={String(status?.processors || 0)} />
        <StatCard label="Pending Tasks" value={String(status?.pending_tasks || 0)} />
        <StatCard
          label="Uptime"
          value={`${Math.floor((status?.uptime_sec || 0) / 60)} min`}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="space-y-6">
          <section className="rounded-3xl border border-white/10 bg-slate-950/80 p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h3 className="text-2xl font-semibold text-white">
                  Articles / 文章检索
                </h3>
                <p className="mt-2 text-sm text-slate-300">
                  按平台、账号、文章 ID、关键词或 URL 片段查询数据库中的内容。
                  官网与 FC 共用 `官网 / FC` 平台。
                </p>
              </div>
              <button
                type="button"
                onClick={() => searchArticles()}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-100"
              >
                刷新
              </button>
            </div>

            <form
              className="mt-5 grid gap-4 md:grid-cols-5"
              onSubmit={(event) => {
                event.preventDefault();
                searchArticles();
              }}
            >
              <SelectControl
                label="平台"
                value={query.platform}
                onChange={(platform) => setQuery((prev) => ({ ...prev, platform }))}
                options={PLATFORM_OPTIONS}
              />
              <InputControl
                label="u_id"
                value={query.u_id}
                onChange={(u_id) => setQuery((prev) => ({ ...prev, u_id }))}
              />
              <InputControl
                label="article id"
                value={query.a_id}
                onChange={(a_id) => setQuery((prev) => ({ ...prev, a_id }))}
              />
              <InputControl
                label="关键词 / URL"
                value={query.q}
                onChange={(q) => setQuery((prev) => ({ ...prev, q }))}
              />
              <InputControl
                label="数量"
                value={query.limit}
                onChange={(limit) => setQuery((prev) => ({ ...prev, limit }))}
              />
            </form>

            <div className="mt-5 space-y-4">
              {loading ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-sm text-slate-400">
                  正在加载文章...
                </div>
              ) : articles.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-sm text-slate-500">
                  没有匹配的文章。
                </div>
              ) : (
                articles.map((article) => (
                  <article
                    key={`${article.platform}:${article.id}`}
                    className="rounded-2xl border border-white/10 bg-black/20 p-4"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-semibold text-white">
                            {article.username} · {article.u_id}
                          </div>
                          <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100">
                            {PLATFORM_LABELS[String(article.platform)] || 'Unknown'}
                          </span>
                          {inferArticleSourceLabel(article) && (
                            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300">
                              {inferArticleSourceLabel(article)}
                            </span>
                          )}
                          {article.has_media && (
                            <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-100">
                              {article.media?.length || 0} media
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          {article.a_id} · {new Date(article.created_at * 1000).toLocaleString()}
                        </div>
                        {article.url && (
                          <a
                            href={article.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 block truncate text-xs text-cyan-200/90 hover:text-cyan-100"
                          >
                            {article.url}
                          </a>
                        )}
                        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-200">
                          {article.content || '(empty)'}
                        </p>
                        {article.translation && (
                          <p className="mt-3 whitespace-pre-wrap rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
                            {article.translation}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => reprocessArticle(article)}
                          className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-100"
                        >
                          Reprocess
                        </button>
                        <button
                          type="button"
                          onClick={() => resendArticle(article)}
                          className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-100"
                        >
                          Resend
                        </button>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-3xl border border-white/10 bg-slate-950/80 p-6">
            <h3 className="text-2xl font-semibold text-white">Processor</h3>
            <form className="mt-5 space-y-4" onSubmit={runProcessor}>
              <SelectControl
                label="processor"
                value={actionState.processorId}
                onChange={(processorId) =>
                  setActionState((prev) => ({ ...prev, processorId }))
                }
                options={processorOptions.map((value) => ({ value, label: value }))}
              />
              <SelectControl
                label="action"
                value={actionState.processorAction}
                onChange={(processorAction) =>
                  setActionState((prev) => ({ ...prev, processorAction }))
                }
                options={['translate', 'extract', 'merge', 'plan']}
              />
              <SelectControl
                label="platform"
                value={actionState.processorPlatform}
                onChange={(processorPlatform) =>
                  setActionState((prev) => ({ ...prev, processorPlatform }))
                }
                options={PLATFORM_OPTIONS}
              />
              <InputControl
                label="article id"
                value={actionState.processorArticleId}
                onChange={(processorArticleId) =>
                  setActionState((prev) => ({ ...prev, processorArticleId }))
                }
              />
              <InputControl
                label="u_id"
                value={actionState.processorUid}
                onChange={(processorUid) =>
                  setActionState((prev) => ({ ...prev, processorUid }))
                }
              />
              <div className="grid gap-4 md:grid-cols-2">
                <InputControl
                  label="start unix"
                  value={actionState.processorStart}
                  onChange={(processorStart) =>
                    setActionState((prev) => ({ ...prev, processorStart }))
                  }
                />
                <InputControl
                  label="end unix"
                  value={actionState.processorEnd}
                  onChange={(processorEnd) =>
                    setActionState((prev) => ({ ...prev, processorEnd }))
                  }
                />
              </div>
              <TextAreaControl
                label="manual text"
                value={actionState.processorText}
                onChange={(processorText) =>
                  setActionState((prev) => ({ ...prev, processorText }))
                }
              />
              <button
                type="submit"
                className="rounded-full bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950"
              >
                运行 Processor
              </button>
            </form>

            {processorResult && (
              <pre className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-black/30 p-4 text-xs text-emerald-300">
                {JSON.stringify(processorResult, null, 2)}
              </pre>
            )}
          </section>

          <section className="rounded-3xl border border-white/10 bg-slate-950/80 p-6">
            <h3 className="text-2xl font-semibold text-white">Simulate Capture</h3>
            <p className="mt-2 text-sm text-slate-300">
              伪造一条“刚刚被 crawler 抓到”的最新内容，用于测试 cookies、processor
              和转发链路，不必等真实平台更新。
            </p>
            <form className="mt-5 space-y-4" onSubmit={simulateArticle}>
              <SelectControl
                label="crawler"
                value={actionState.simulateCrawlerName}
                onChange={(simulateCrawlerName) =>
                  setActionState((prev) => ({ ...prev, simulateCrawlerName }))
                }
                options={crawlerOptions.map((value) => ({ value, label: value }))}
              />
              <div className="grid gap-4 md:grid-cols-2">
                <InputControl
                  label="u_id"
                  value={actionState.simulateUid}
                  onChange={(simulateUid) =>
                    setActionState((prev) => ({ ...prev, simulateUid }))
                  }
                />
                <InputControl
                  label="username"
                  value={actionState.simulateUsername}
                  onChange={(simulateUsername) =>
                    setActionState((prev) => ({ ...prev, simulateUsername }))
                  }
                />
                <InputControl
                  label="article id (optional)"
                  value={actionState.simulateArticleId}
                  onChange={(simulateArticleId) =>
                    setActionState((prev) => ({ ...prev, simulateArticleId }))
                  }
                />
                <InputControl
                  label="created_at (unix / ISO)"
                  value={actionState.simulateCreatedAt}
                  onChange={(simulateCreatedAt) =>
                    setActionState((prev) => ({ ...prev, simulateCreatedAt }))
                  }
                />
              </div>
              <InputControl
                label="url (optional)"
                value={actionState.simulateUrl}
                onChange={(simulateUrl) =>
                  setActionState((prev) => ({ ...prev, simulateUrl }))
                }
              />
              <TextAreaControl
                label="content"
                value={actionState.simulateContent}
                onChange={(simulateContent) =>
                  setActionState((prev) => ({ ...prev, simulateContent }))
                }
              />
              <TextAreaControl
                label="media urls (one per line)"
                value={actionState.simulateMediaUrls}
                onChange={(simulateMediaUrls) =>
                  setActionState((prev) => ({ ...prev, simulateMediaUrls }))
                }
              />
              <div className="grid gap-3 md:grid-cols-2">
                <CheckboxControl
                  label="保存后执行 crawler 处理器"
                  checked={actionState.simulateProcess}
                  onChange={(simulateProcess) =>
                    setActionState((prev) => ({ ...prev, simulateProcess }))
                  }
                />
                <CheckboxControl
                  label="保存后立即按该 crawler 重发"
                  checked={actionState.simulateForward}
                  onChange={(simulateForward) =>
                    setActionState((prev) => ({ ...prev, simulateForward }))
                  }
                />
              </div>
              <button
                type="submit"
                className="rounded-full bg-amber-300 px-4 py-2 text-sm font-medium text-slate-950"
              >
                模拟最新抓取
              </button>
            </form>
          </section>

          <section className="rounded-3xl border border-white/10 bg-slate-950/80 p-6">
            <h3 className="text-xl font-semibold text-white">Tasks</h3>
            <div className="mt-4 space-y-3">
              {tasks.map((task) => (
                <div key={task.id} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                  <div className="text-sm font-medium text-white">
                    #{task.id} · {task.type}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {task.status} · {task.action_type || 'n/a'}
                  </div>
                  {task.result_summary && (
                    <div className="mt-2 text-sm text-slate-300">{task.result_summary}</div>
                  )}
                  {task.last_error && (
                    <div className="mt-2 text-sm text-rose-200">{task.last_error}</div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-slate-950/80 p-6">
            <h3 className="text-xl font-semibold text-white">Processor Runs</h3>
            <div className="mt-4 space-y-3">
              {runs.map((run) => (
                <div key={run.id} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                  <div className="text-sm font-medium text-white">
                    #{run.id} · {run.action}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {run.processor_id || 'unknown'} · {run.source_ref || 'n/a'}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-3xl border border-white/10 bg-slate-950/80 p-5">
      <div className="text-xs uppercase tracking-[0.2em] text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-white">{value}</div>
    </article>
  );
}

function InputControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-slate-300">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white"
      />
    </label>
  );
}

function TextAreaControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-slate-300">{label}</span>
      <textarea
        rows={5}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white"
      />
    </label>
  );
}

function SelectControl({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<string | { value: string; label: string }>;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-slate-300">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white"
      >
        {options.map((option) => {
          const normalized =
            typeof option === 'string'
              ? { value: option, label: option || '（空）' }
              : option;
          return (
            <option key={normalized.value} value={normalized.value}>
              {normalized.label}
            </option>
          );
        })}
      </select>
    </label>
  );
}

function CheckboxControl({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-200">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-cyan-400"
      />
      {label}
    </label>
  );
}
