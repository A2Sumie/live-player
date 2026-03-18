'use client';

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  analyzeConfig,
  AppConfig,
  buildReviewSummary,
  cloneAppConfig,
  Crawler,
  Forwarder,
  Formatter,
  ForwardTarget,
  getCrawlerConnectionKey,
  getCrawlerRouteFormatterIds,
  getFormatterConnectionKey,
  getFormatterInboundCrawlerCount,
  getFormatterTargetIds,
  getForwarderConnectionKey,
  getForwarderEffectiveTargetIds,
  getForwarderGraphTargetIds,
  getForwarderInlineTargetIds,
  getGlobalDefaultsSnapshot,
  getTargetConnectionKey,
  getTargetInboundCount,
  removeEntityConnections,
  renameConfigConnectionReferences,
  resolveCrawlerRouting,
  ReviewSection,
  sortUnique,
  summarizeTarget,
} from '@/lib/cic-config';

const RENDER_TYPE_OPTIONS = [
  'text',
  'tag',
  'img',
  'img-tag',
  'img-tag-dynamic',
  'img-with-meta',
];

const TARGET_PLATFORM_OPTIONS = ['telegram', 'qq', 'bilibili', 'none'];

type EntityKind = 'crawler' | 'formatter' | 'target' | 'forwarder';

type EntityEditorState =
  | null
  | { mode: 'create'; kind: EntityKind }
  | { mode: 'edit'; kind: EntityKind; index: number };

type RouteEditorState =
  | null
  | { kind: 'crawler'; index: number }
  | { kind: 'formatter'; index: number }
  | { kind: 'forwarder'; index: number };

export default function ConfigConsole() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [originalConfig, setOriginalConfig] = useState<AppConfig | null>(null);
  const [availableCookies, setAvailableCookies] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [editorState, setEditorState] = useState<EntityEditorState>(null);
  const [routeEditorState, setRouteEditorState] = useState<RouteEditorState>(null);
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [selectedCrawlerKey, setSelectedCrawlerKey] = useState<string>('');

  const loadConfig = async () => {
    setLoading(true);
    setError('');

    try {
      const [configRes, cookiesRes] = await Promise.all([
        fetch('/api/config'),
        fetch('/api/cookies/list'),
      ]);

      if (!configRes.ok) {
        throw new Error(await configRes.text());
      }

      const configData = (await configRes.json()) as AppConfig;
      const cookiesData = cookiesRes.ok
        ? ((await cookiesRes.json()) as Array<{ filename: string }>)
        : [];

      setConfig(configData);
      setOriginalConfig(cloneAppConfig(configData));
      setAvailableCookies(cookiesData.map((cookie) => cookie.filename));
      setDirty(false);
      setStatus(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load config');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const crawlerOptions = useMemo(() => {
    if (!config) {
      return [];
    }

    return (config.crawlers || []).map((crawler, index) => ({
      key: getCrawlerConnectionKey(crawler, index),
      label: crawler.name || `Crawler ${index + 1}`,
      index,
    }));
  }, [config]);

  useEffect(() => {
    if (!crawlerOptions.length) {
      setSelectedCrawlerKey('');
      return;
    }

    if (!crawlerOptions.some((crawler) => crawler.key === selectedCrawlerKey)) {
      setSelectedCrawlerKey(crawlerOptions[0].key);
    }
  }, [crawlerOptions, selectedCrawlerKey]);

  const issues = useMemo(() => (config ? analyzeConfig(config) : []), [config]);
  const reviewSections = useMemo<ReviewSection[]>(
    () =>
      config && originalConfig
        ? buildReviewSummary(originalConfig, config)
        : [],
    [config, originalConfig]
  );

  const explorer = useMemo(() => {
    if (!config) {
      return null;
    }

    const selected = (config.crawlers || []).find((crawler, index) => {
      return getCrawlerConnectionKey(crawler, index) === selectedCrawlerKey;
    });
    const index = (config.crawlers || []).findIndex((crawler, crawlerIndex) => {
      return getCrawlerConnectionKey(crawler, crawlerIndex) === selectedCrawlerKey;
    });

    if (!selected || index < 0) {
      return null;
    }

    const routing = resolveCrawlerRouting(config, selected, index);
    const formatterDetails = routing.formatterIds.map((formatterId) => {
      const formatter = (config.formatters || []).find(
        (entry, formatterIndex) =>
          getFormatterConnectionKey(entry, formatterIndex) === formatterId
      );

      const targetIds =
        config.connections?.['formatter-target']?.[formatterId] || [];
      const targets = targetIds
        .map((targetId) =>
          (config.forward_targets || []).find(
            (target, targetIndex) =>
              getTargetConnectionKey(target, targetIndex) === targetId
          )
        )
        .filter(Boolean) as ForwardTarget[];

      return {
        formatterId,
        formatter,
        targetIds,
        targets,
      };
    });

    return {
      crawler: selected,
      index,
      routing,
      formatterDetails,
    };
  }, [config, selectedCrawlerKey]);

  const markDirty = (nextConfig: AppConfig) => {
    setConfig(nextConfig);
    setDirty(true);
    setStatus(null);
  };

  const handleSaveDefaults = (nextDefaults: AppConfig) => {
    if (!config) {
      return;
    }

    const nextConfig = cloneAppConfig(config);
    nextConfig.cfg_crawler = nextDefaults.cfg_crawler || {};
    nextConfig.cfg_forward_target = nextDefaults.cfg_forward_target || {};
    nextConfig.cfg_forwarder = nextDefaults.cfg_forwarder || {};
    nextConfig.api = {
      ...(nextConfig.api || {}),
      port: nextDefaults.api?.port ? Number(nextDefaults.api.port) : undefined,
    };
    markDirty(nextConfig);
    setDefaultsOpen(false);
  };

  const handleSaveEntity = (entity: Crawler | Formatter | ForwardTarget | Forwarder) => {
    if (!config || !editorState) {
      return;
    }

    const nextConfig = cloneAppConfig(config);

    if (editorState.kind === 'crawler') {
      const nextCrawler = entity as Crawler;
      if (editorState.mode === 'create') {
        nextConfig.crawlers = [...(nextConfig.crawlers || []), nextCrawler];
      } else {
        const previous = nextConfig.crawlers?.[editorState.index];
        if (!nextConfig.crawlers || !previous) {
          return;
        }

        const oldKey = getCrawlerConnectionKey(previous, editorState.index);
        nextConfig.crawlers[editorState.index] = nextCrawler;
        const newKey = getCrawlerConnectionKey(nextCrawler, editorState.index);
        renameConfigConnectionReferences(nextConfig, 'crawler', oldKey, newKey);
      }
    }

    if (editorState.kind === 'formatter') {
      const nextFormatter = entity as Formatter;
      if (editorState.mode === 'create') {
        nextConfig.formatters = [...(nextConfig.formatters || []), nextFormatter];
      } else {
        const previous = nextConfig.formatters?.[editorState.index];
        if (!nextConfig.formatters || !previous) {
          return;
        }

        const oldKey = getFormatterConnectionKey(previous, editorState.index);
        nextConfig.formatters[editorState.index] = nextFormatter;
        const newKey = getFormatterConnectionKey(nextFormatter, editorState.index);
        renameConfigConnectionReferences(nextConfig, 'formatter', oldKey, newKey);
      }
    }

    if (editorState.kind === 'target') {
      const nextTarget = entity as ForwardTarget;
      if (editorState.mode === 'create') {
        nextConfig.forward_targets = [
          ...(nextConfig.forward_targets || []),
          nextTarget,
        ];
      } else {
        const previous = nextConfig.forward_targets?.[editorState.index];
        if (!nextConfig.forward_targets || !previous) {
          return;
        }

        const oldKey = getTargetConnectionKey(previous, editorState.index);
        nextConfig.forward_targets[editorState.index] = nextTarget;
        const newKey = getTargetConnectionKey(nextTarget, editorState.index);
        renameConfigConnectionReferences(nextConfig, 'target', oldKey, newKey);
      }
    }

    if (editorState.kind === 'forwarder') {
      const nextForwarder = entity as Forwarder;
      if (editorState.mode === 'create') {
        nextConfig.forwarders = [...(nextConfig.forwarders || []), nextForwarder];
      } else {
        const previous = nextConfig.forwarders?.[editorState.index];
        if (!nextConfig.forwarders || !previous) {
          return;
        }

        const oldKey = getForwarderConnectionKey(previous, editorState.index);
        nextConfig.forwarders[editorState.index] = nextForwarder;
        const newKey = getForwarderConnectionKey(nextForwarder, editorState.index);
        renameConfigConnectionReferences(nextConfig, 'forwarder', oldKey, newKey);
      }
    }

    markDirty(nextConfig);
    setEditorState(null);
  };

  const handleDeleteEntity = (kind: EntityKind, index: number) => {
    if (!config) {
      return;
    }

    const nextConfig = cloneAppConfig(config);

    if (kind === 'crawler') {
      const previous = nextConfig.crawlers?.[index];
      if (!previous || !nextConfig.crawlers) {
        return;
      }

      removeEntityConnections(
        nextConfig,
        'crawler',
        getCrawlerConnectionKey(previous, index)
      );
      nextConfig.crawlers.splice(index, 1);
    }

    if (kind === 'formatter') {
      const previous = nextConfig.formatters?.[index];
      if (!previous || !nextConfig.formatters) {
        return;
      }

      removeEntityConnections(
        nextConfig,
        'formatter',
        getFormatterConnectionKey(previous, index)
      );
      nextConfig.formatters.splice(index, 1);
    }

    if (kind === 'target') {
      const previous = nextConfig.forward_targets?.[index];
      if (!previous || !nextConfig.forward_targets) {
        return;
      }

      removeEntityConnections(
        nextConfig,
        'target',
        getTargetConnectionKey(previous, index)
      );
      nextConfig.forward_targets.splice(index, 1);
    }

    if (kind === 'forwarder') {
      const previous = nextConfig.forwarders?.[index];
      if (!previous || !nextConfig.forwarders) {
        return;
      }

      removeEntityConnections(
        nextConfig,
        'forwarder',
        getForwarderConnectionKey(previous, index)
      );
      nextConfig.forwarders.splice(index, 1);
    }

    markDirty(nextConfig);
  };

  const handleSaveRoutes = (selectedIds: string[]) => {
    if (!config || !routeEditorState) {
      return;
    }

    const nextConfig = cloneAppConfig(config);
    nextConfig.connections = nextConfig.connections || {};

    if (routeEditorState.kind === 'crawler') {
      const crawler = nextConfig.crawlers?.[routeEditorState.index];
      if (!crawler) {
        return;
      }

      const crawlerKey = getCrawlerConnectionKey(crawler, routeEditorState.index);
      nextConfig.connections['crawler-formatter'] =
        nextConfig.connections['crawler-formatter'] || {};

      if (selectedIds.length === 0) {
        delete nextConfig.connections['crawler-formatter'][crawlerKey];
      } else {
        nextConfig.connections['crawler-formatter'][crawlerKey] =
          sortUnique(selectedIds);
      }
    }

    if (routeEditorState.kind === 'formatter') {
      const formatter = nextConfig.formatters?.[routeEditorState.index];
      if (!formatter) {
        return;
      }

      const formatterKey = getFormatterConnectionKey(
        formatter,
        routeEditorState.index
      );
      nextConfig.connections['formatter-target'] =
        nextConfig.connections['formatter-target'] || {};

      if (selectedIds.length === 0) {
        delete nextConfig.connections['formatter-target'][formatterKey];
      } else {
        nextConfig.connections['formatter-target'][formatterKey] =
          sortUnique(selectedIds);
      }
    }

    if (routeEditorState.kind === 'forwarder') {
      const forwarder = nextConfig.forwarders?.[routeEditorState.index];
      if (!forwarder) {
        return;
      }

      const forwarderKey = getForwarderConnectionKey(
        forwarder,
        routeEditorState.index
      );
      nextConfig.connections['forwarder-target'] =
        nextConfig.connections['forwarder-target'] || {};

      if (selectedIds.length === 0) {
        delete nextConfig.connections['forwarder-target'][forwarderKey];
      } else {
        nextConfig.connections['forwarder-target'][forwarderKey] =
          sortUnique(selectedIds);
      }
    }

    markDirty(nextConfig);
    setRouteEditorState(null);
  };

  const saveConfig = async () => {
    if (!config) {
      return;
    }

    setSaving(true);
    setStatus('Saving...');

    try {
      const res = await fetch('/api/config/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      setOriginalConfig(cloneAppConfig(config));
      setDirty(false);
      setReviewOpen(false);
      setStatus('Saved. Restart the internal service to apply the new config.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save';
      setStatus(`Save failed: ${message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleRestart = async () => {
    if (!confirm('Restart the internal service now?')) {
      return;
    }

    setRestarting(true);
    try {
      const res = await fetch('/api/server/restart', { method: 'POST' });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      setStatus('Restart request sent.');
    } catch (err) {
      setStatus(
        `Restart failed: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    } finally {
      setRestarting(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-12 text-center text-slate-400">
        Loading configuration...
      </div>
    );
  }

  if (!config) {
    return (
      <div className="rounded-3xl border border-rose-500/20 bg-rose-500/10 px-6 py-12 text-center text-rose-100">
        {error || 'Config is unavailable.'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300/80">
              Config
            </div>
            <h2 className="mt-2 text-3xl font-semibold text-white">
              Route-first configuration editor
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
              Main flow is modeled explicitly as crawler to formatter to target.
              Templates stay available as supplementary routing paths without
              pretending to be part of the primary graph.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={loadConfig}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/10"
            >
              {dirty ? 'Discard & refresh' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={handleRestart}
              disabled={restarting}
              className="rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-100 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {restarting ? 'Restarting...' : 'Restart service'}
            </button>
            <button
              type="button"
              disabled={!dirty}
              onClick={() => setReviewOpen(true)}
              className="rounded-full bg-cyan-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Review & save
            </button>
          </div>
        </div>

        {(status || error || dirty) && (
          <div className="mt-4 flex flex-wrap gap-3">
            {dirty && (
              <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-amber-100">
                Unsaved changes
              </span>
            )}
            {status && (
              <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-100">
                {status}
              </span>
            )}
            {error && (
              <span className="rounded-full border border-rose-500/20 bg-rose-500/10 px-3 py-1 text-xs text-rose-100">
                {error}
              </span>
            )}
          </div>
        )}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
        <GlobalDefaultsCard
          snapshot={getGlobalDefaultsSnapshot(config)}
          onEdit={() => setDefaultsOpen(true)}
        />
        <IssueCard issues={issues} />
      </section>

      <EntitySection
        title="Crawlers"
        description="Primary ingestion definitions. Routing is edited explicitly per crawler."
        actionLabel="Add crawler"
        onAdd={() => setEditorState({ mode: 'create', kind: 'crawler' })}
      >
        {(config.crawlers || []).map((crawler, index) => {
          const routing = resolveCrawlerRouting(config, crawler, index);
          return (
            <EntityCard
              key={`crawler-${getCrawlerConnectionKey(crawler, index)}`}
              title={crawler.name || `Crawler ${index + 1}`}
              subtitle={crawler.origin || 'No origin configured'}
              badges={[
                crawler.task_type || 'article',
                crawler.cfg_crawler?.engine || 'engine: default',
                crawler.group || null,
              ]}
              metrics={[
                { label: 'schedule', value: crawler.cfg_crawler?.cron || '-' },
                {
                  label: 'cookie',
                  value: crawler.cfg_crawler?.cookie_file || 'none',
                },
                {
                  label: 'formatters',
                  value: String(routing.formatterIds.length),
                },
                { label: 'targets', value: String(routing.targetIds.length) },
              ]}
              actions={[
                { label: 'Edit', onClick: () => setEditorState({ mode: 'edit', kind: 'crawler', index }) },
                { label: 'Routing', onClick: () => setRouteEditorState({ kind: 'crawler', index }) },
                {
                  label: 'Delete',
                  tone: 'danger',
                  onClick: () => {
                    if (confirm(`Delete crawler "${crawler.name || `Crawler ${index + 1}`}"?`)) {
                      handleDeleteEntity('crawler', index);
                    }
                  },
                },
              ]}
            />
          );
        })}
      </EntitySection>

      <EntitySection
        title="Formatters"
        description="Render definitions reused by crawler routes."
        actionLabel="Add formatter"
        onAdd={() => setEditorState({ mode: 'create', kind: 'formatter' })}
      >
        {(config.formatters || []).map((formatter, index) => {
          const formatterId = getFormatterConnectionKey(formatter, index);
          return (
            <EntityCard
              key={`formatter-${formatterId}`}
              title={formatter.name || formatterId}
              subtitle={formatterId}
              badges={[
                formatter.render_type,
                formatter.aggregation ? 'aggregation' : null,
                formatter.deduplication ? 'deduplication' : null,
                formatter.group || null,
              ]}
              metrics={[
                {
                  label: 'targets',
                  value: String(getFormatterTargetIds(config, formatter, index).length),
                },
                {
                  label: 'crawlers',
                  value: String(getFormatterInboundCrawlerCount(config, formatterId)),
                },
              ]}
              actions={[
                { label: 'Edit', onClick: () => setEditorState({ mode: 'edit', kind: 'formatter', index }) },
                { label: 'Targets', onClick: () => setRouteEditorState({ kind: 'formatter', index }) },
                {
                  label: 'Delete',
                  tone: 'danger',
                  onClick: () => {
                    if (confirm(`Delete formatter "${formatter.name || formatterId}"?`)) {
                      handleDeleteEntity('formatter', index);
                    }
                  },
                },
              ]}
            />
          );
        })}
      </EntitySection>

      <EntitySection
        title="Targets"
        description="Delivery endpoints. Sensitive fields stay hidden in summaries and review output."
        actionLabel="Add target"
        onAdd={() => setEditorState({ mode: 'create', kind: 'target' })}
      >
        {(config.forward_targets || []).map((target, index) => {
          const targetId = getTargetConnectionKey(target, index);
          return (
            <EntityCard
              key={`target-${targetId}`}
              title={targetId}
              subtitle={target.platform}
              badges={[target.group || null]}
              metrics={[
                { label: 'summary', value: summarizeTarget(target, index) },
                {
                  label: 'inbound',
                  value: String(getTargetInboundCount(config, targetId)),
                },
              ]}
              actions={[
                { label: 'Edit', onClick: () => setEditorState({ mode: 'edit', kind: 'target', index }) },
                {
                  label: 'Delete',
                  tone: 'danger',
                  onClick: () => {
                    if (confirm(`Delete target "${targetId}"?`)) {
                      handleDeleteEntity('target', index);
                    }
                  },
                },
              ]}
            />
          );
        })}
      </EntitySection>

      <EntitySection
        title="Templates"
        description="Supplementary forwarder/template paths kept separate from the primary crawler route model."
        actionLabel="Add template"
        onAdd={() => setEditorState({ mode: 'create', kind: 'forwarder' })}
      >
        {(config.forwarders || []).map((forwarder, index) => {
          const forwarderId = getForwarderConnectionKey(forwarder, index);
          const inlineTargets = getForwarderInlineTargetIds(forwarder);
          const graphTargets = getForwarderGraphTargetIds(config, forwarder, index);
          const effectiveTargets = getForwarderEffectiveTargetIds(config, forwarder, index);

          return (
            <EntityCard
              key={`forwarder-${forwarderId}`}
              title={forwarder.name || forwarderId}
              subtitle={forwarder.origin || 'No matcher origin configured'}
              badges={[
                forwarder.task_type || 'article',
                forwarder.cfg_forwarder?.render_type || 'render default',
                forwarder.group || null,
              ]}
              metrics={[
                {
                  label: 'graph targets',
                  value: String(graphTargets.length),
                },
                {
                  label: 'inline subscribers',
                  value: String(inlineTargets.length),
                },
                {
                  label: 'effective targets',
                  value: String(effectiveTargets.length),
                },
              ]}
              actions={[
                { label: 'Edit', onClick: () => setEditorState({ mode: 'edit', kind: 'forwarder', index }) },
                { label: 'Targets', onClick: () => setRouteEditorState({ kind: 'forwarder', index }) },
                {
                  label: 'Delete',
                  tone: 'danger',
                  onClick: () => {
                    if (confirm(`Delete template "${forwarder.name || forwarderId}"?`)) {
                      handleDeleteEntity('forwarder', index);
                    }
                  },
                },
              ]}
            />
          );
        })}
      </EntitySection>

      <section className="rounded-3xl border border-white/10 bg-slate-950/80 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300/80">
              Routing Explorer
            </div>
            <h3 className="mt-2 text-2xl font-semibold text-white">
              Effective crawler delivery path
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Select a crawler to inspect the formatters and targets reached by
              the current route maps.
            </p>
          </div>

          <select
            value={selectedCrawlerKey}
            onChange={(event) => setSelectedCrawlerKey(event.target.value)}
            className="rounded-full border border-white/10 bg-black/20 px-4 py-2 text-sm text-white outline-none"
          >
            {crawlerOptions.map((crawler) => (
              <option key={crawler.key} value={crawler.key}>
                {crawler.label}
              </option>
            ))}
          </select>
        </div>

        {!explorer ? (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-sm text-slate-400">
            No crawler selected.
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-sm font-semibold text-white">
                {explorer.crawler.name || `Crawler ${explorer.index + 1}`}
              </div>
              <div className="mt-2 text-sm text-slate-300">
                {explorer.crawler.origin || 'No origin configured'}
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <Badge tone="neutral">
                  {explorer.routing.formatterIds.length} formatter(s)
                </Badge>
                <Badge tone="neutral">
                  {explorer.routing.targetIds.length} target(s)
                </Badge>
                {explorer.routing.missingFormatterIds.length > 0 && (
                  <Badge tone="danger">
                    missing formatter refs: {explorer.routing.missingFormatterIds.join(', ')}
                  </Badge>
                )}
                {explorer.routing.missingTargetIds.length > 0 && (
                  <Badge tone="danger">
                    missing target refs: {explorer.routing.missingTargetIds.join(', ')}
                  </Badge>
                )}
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              {explorer.formatterDetails.map((entry) => (
                <article
                  key={entry.formatterId}
                  className="rounded-2xl border border-white/10 bg-black/20 p-4"
                >
                  <div className="text-sm font-semibold text-white">
                    {entry.formatter?.name || entry.formatterId}
                  </div>
                  <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-400">
                    {entry.formatter?.render_type || 'missing formatter'}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {entry.targets.length === 0 ? (
                      <Badge tone="warn">No valid targets</Badge>
                    ) : (
                      entry.targets.map((target, targetIndex) => (
                        <Badge
                          key={`${entry.formatterId}-${getTargetConnectionKey(target, targetIndex)}`}
                          tone="neutral"
                        >
                          {getTargetConnectionKey(target, targetIndex)}
                        </Badge>
                      ))
                    )}
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </section>

      {defaultsOpen && (
        <DefaultsModal
          initialSnapshot={getGlobalDefaultsSnapshot(config)}
          availableCookies={availableCookies}
          onClose={() => setDefaultsOpen(false)}
          onSave={handleSaveDefaults}
        />
      )}

      {editorState && (
        <EntityEditorModal
          state={editorState}
          config={config}
          availableCookies={availableCookies}
          onClose={() => setEditorState(null)}
          onSave={handleSaveEntity}
        />
      )}

      {routeEditorState && (
        <RouteEditorModal
          state={routeEditorState}
          config={config}
          onClose={() => setRouteEditorState(null)}
          onSave={handleSaveRoutes}
        />
      )}

      {reviewOpen && (
        <ReviewModal
          saving={saving}
          sections={reviewSections}
          onClose={() => setReviewOpen(false)}
          onConfirm={saveConfig}
        />
      )}
    </div>
  );
}

function GlobalDefaultsCard({
  snapshot,
  onEdit,
}: {
  snapshot: ReturnType<typeof getGlobalDefaultsSnapshot>;
  onEdit: () => void;
}) {
  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/80 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300/80">
            Global Defaults
          </div>
          <h3 className="mt-2 text-2xl font-semibold text-white">
            Shared config baselines
          </h3>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Metric label="crawler engine" value={String(snapshot.cfg_crawler.engine || '-')} />
            <Metric label="default cookie" value={String(snapshot.cfg_crawler.cookie_file || '-')} />
            <Metric label="target filters" value={String((snapshot.cfg_forward_target.accept_keywords || []).length)} />
            <Metric label="api port" value={String(snapshot.api.port || '-')} />
          </div>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/10"
        >
          Edit defaults
        </button>
      </div>
    </section>
  );
}

function IssueCard({
  issues,
}: {
  issues: ReturnType<typeof analyzeConfig>;
}) {
  const counts = {
    error: issues.filter((issue) => issue.level === 'error').length,
    warn: issues.filter((issue) => issue.level === 'warn').length,
    info: issues.filter((issue) => issue.level === 'info').length,
  };

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/80 p-6">
      <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300/80">
        Validation
      </div>
      <h3 className="mt-2 text-2xl font-semibold text-white">Config health</h3>
      <div className="mt-4 flex flex-wrap gap-2">
        <Badge tone="danger">{counts.error} errors</Badge>
        <Badge tone="warn">{counts.warn} warnings</Badge>
        <Badge tone="neutral">{counts.info} notes</Badge>
      </div>
      <div className="mt-4 space-y-3">
        {issues.slice(0, 4).map((issue) => (
          <div
            key={issue.id}
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
          >
            <div className="text-sm font-medium text-white">{issue.title}</div>
            <div className="mt-1 text-sm text-slate-300">{issue.detail}</div>
          </div>
        ))}
        {issues.length === 0 && (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            No structural warnings detected.
          </div>
        )}
      </div>
    </section>
  );
}

function EntitySection({
  title,
  description,
  actionLabel,
  onAdd,
  children,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h3 className="text-2xl font-semibold text-white">{title}</h3>
          <p className="mt-1 text-sm text-slate-300">{description}</p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="rounded-full bg-cyan-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-300"
        >
          {actionLabel}
        </button>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">{children}</div>
    </section>
  );
}

function EntityCard({
  title,
  subtitle,
  badges,
  metrics,
  actions,
}: {
  title: string;
  subtitle: string;
  badges: Array<string | null | undefined>;
  metrics: Array<{ label: string; value: string }>;
  actions: Array<{ label: string; onClick: () => void; tone?: 'danger' }>;
}) {
  return (
    <article className="rounded-3xl border border-white/10 bg-slate-950/80 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h4 className="truncate text-lg font-semibold text-white">{title}</h4>
          <p className="mt-1 truncate text-sm text-slate-400">{subtitle}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {badges.filter(Boolean).map((badge) => (
              <Badge key={badge} tone="neutral">
                {badge}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                action.tone === 'danger'
                  ? 'border border-rose-500/30 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20'
                  : 'border border-white/10 bg-white/5 text-slate-100 hover:bg-white/10'
              }`}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <Metric key={metric.label} label={metric.label} value={metric.value} />
        ))}
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
      <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
        {label}
      </div>
      <div className="mt-1 break-all text-sm text-white">{value}</div>
    </div>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: 'danger' | 'warn' | 'neutral';
}) {
  const toneClass =
    tone === 'danger'
      ? 'border-rose-500/30 bg-rose-500/10 text-rose-100'
      : tone === 'warn'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-100'
        : 'border-white/10 bg-white/5 text-slate-200';

  return (
    <span
      className={`rounded-full border px-2 py-1 text-xs font-medium ${toneClass}`}
    >
      {children}
    </span>
  );
}

function DefaultsModal({
  initialSnapshot,
  availableCookies,
  onClose,
  onSave,
}: {
  initialSnapshot: ReturnType<typeof getGlobalDefaultsSnapshot>;
  availableCookies: string[];
  onClose: () => void;
  onSave: (config: AppConfig) => void;
}) {
  const [engine, setEngine] = useState(String(initialSnapshot.cfg_crawler.engine || 'browser'));
  const [cookieFile, setCookieFile] = useState(String(initialSnapshot.cfg_crawler.cookie_file || ''));
  const [userAgent, setUserAgent] = useState(String(initialSnapshot.cfg_crawler.user_agent || ''));
  const [intervalMin, setIntervalMin] = useState(String(initialSnapshot.cfg_crawler.interval_time?.min ?? ''));
  const [intervalMax, setIntervalMax] = useState(String(initialSnapshot.cfg_crawler.interval_time?.max ?? ''));
  const [immediateNotify, setImmediateNotify] = useState(Boolean(initialSnapshot.cfg_crawler.immediate_notify));
  const [forwarderCron, setForwarderCron] = useState(String(initialSnapshot.cfg_forwarder.cron || ''));
  const [forwarderRenderType, setForwarderRenderType] = useState(String(initialSnapshot.cfg_forwarder.render_type || 'text'));
  const [forwarderKeywords, setForwarderKeywords] = useState(linesToText(initialSnapshot.cfg_forwarder.keywords as string[] | undefined));
  const [forwarderAggregation, setForwarderAggregation] = useState(Boolean(initialSnapshot.cfg_forwarder.aggregation));
  const [forwarderDeduplication, setForwarderDeduplication] = useState(Boolean(initialSnapshot.cfg_forwarder.deduplication));
  const [forwarderBatchMode, setForwarderBatchMode] = useState(Boolean(initialSnapshot.cfg_forwarder.batch_mode));
  const [acceptKeywords, setAcceptKeywords] = useState(linesToText(initialSnapshot.cfg_forward_target.accept_keywords));
  const [filterKeywords, setFilterKeywords] = useState(linesToText(initialSnapshot.cfg_forward_target.filter_keywords));
  const [blockUntil, setBlockUntil] = useState(String(initialSnapshot.cfg_forward_target.block_until || ''));
  const [replaceRegex, setReplaceRegex] = useState(stringifyStructuredField(initialSnapshot.cfg_forward_target.replace_regex));
  const [blockRules, setBlockRules] = useState(stringifyStructuredField(initialSnapshot.cfg_forward_target.block_rules));
  const [apiPort, setApiPort] = useState(String(initialSnapshot.api.port || ''));
  const [formError, setFormError] = useState('');

  const handleSubmit = () => {
    try {
      const nextConfig: AppConfig = {
        cfg_crawler: {
          ...(initialSnapshot.cfg_crawler || {}),
          engine: emptyToUndefined(engine),
          cookie_file: emptyToUndefined(cookieFile),
          user_agent: emptyToUndefined(userAgent),
          immediate_notify: immediateNotify,
          interval_time:
            intervalMin || intervalMax
              ? {
                  min: numberOrUndefined(intervalMin),
                  max: numberOrUndefined(intervalMax),
                }
              : undefined,
        },
        cfg_forwarder: {
          ...(initialSnapshot.cfg_forwarder || {}),
          cron: emptyToUndefined(forwarderCron),
          render_type: emptyToUndefined(forwarderRenderType),
          keywords: linesFromText(forwarderKeywords),
          aggregation: forwarderAggregation,
          deduplication: forwarderDeduplication,
          batch_mode: forwarderBatchMode,
        },
        cfg_forward_target: {
          ...(initialSnapshot.cfg_forward_target || {}),
          accept_keywords: linesFromText(acceptKeywords),
          filter_keywords: linesFromText(filterKeywords),
          block_until: emptyToUndefined(blockUntil),
          replace_regex: parseStructuredField(replaceRegex),
          block_rules: parseJsonField(blockRules),
        },
        api: {
          port: numberOrUndefined(apiPort),
        },
      };

      onSave(nextConfig);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Invalid defaults');
    }
  };

  return (
    <ModalFrame
      title="Edit global defaults"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="rounded-full bg-cyan-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-300"
          >
            Save defaults
          </button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField
            label="Default crawler engine"
            value={engine}
            onChange={setEngine}
            options={['browser', 'cheerio', 'axios', 'api-graphql']}
          />
          <SelectField
            label="Default cookie file"
            value={cookieFile}
            onChange={setCookieFile}
            options={['', ...availableCookies]}
          />
          <InputField label="Default user agent" value={userAgent} onChange={setUserAgent} />
          <InputField label="API port" value={apiPort} onChange={setApiPort} type="number" />
          <InputField label="Default interval min" value={intervalMin} onChange={setIntervalMin} type="number" />
          <InputField label="Default interval max" value={intervalMax} onChange={setIntervalMax} type="number" />
          <InputField label="Template cron" value={forwarderCron} onChange={setForwarderCron} />
          <SelectField
            label="Template render type"
            value={forwarderRenderType}
            onChange={setForwarderRenderType}
            options={RENDER_TYPE_OPTIONS}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <TextAreaField label="Template keywords" value={forwarderKeywords} onChange={setForwarderKeywords} rows={4} />
          <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
            <CheckboxField label="Immediate notify" checked={immediateNotify} onChange={setImmediateNotify} />
            <CheckboxField label="Template aggregation" checked={forwarderAggregation} onChange={setForwarderAggregation} />
            <CheckboxField label="Template deduplication" checked={forwarderDeduplication} onChange={setForwarderDeduplication} />
            <CheckboxField label="Template batch mode" checked={forwarderBatchMode} onChange={setForwarderBatchMode} />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <TextAreaField label="Default accept keywords" value={acceptKeywords} onChange={setAcceptKeywords} rows={4} />
          <TextAreaField label="Default filter keywords" value={filterKeywords} onChange={setFilterKeywords} rows={4} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <InputField label="Default block until" value={blockUntil} onChange={setBlockUntil} />
          <TextAreaField label="Default replace regex" value={replaceRegex} onChange={setReplaceRegex} rows={4} />
        </div>

        <TextAreaField label="Default block rules (JSON)" value={blockRules} onChange={setBlockRules} rows={6} />

        {formError && (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {formError}
          </div>
        )}
      </div>
    </ModalFrame>
  );
}

function EntityEditorModal({
  state,
  config,
  availableCookies,
  onClose,
  onSave,
}: {
  state: NonNullable<EntityEditorState>;
  config: AppConfig;
  availableCookies: string[];
  onClose: () => void;
  onSave: (entity: Crawler | Formatter | ForwardTarget | Forwarder) => void;
}) {
  const entity =
    state.mode === 'create'
      ? createEntityDraft(state.kind)
      : getExistingEntity(config, state.kind, state.index);

  const [formError, setFormError] = useState('');
  const [draft, setDraft] = useState(cloneAppConfig({ entity }).entity as
    | Crawler
    | Formatter
    | ForwardTarget
    | Forwarder);

  useEffect(() => {
    setFormError('');
    setDraft(cloneAppConfig({ entity }).entity as
      | Crawler
      | Formatter
      | ForwardTarget
      | Forwarder);
  }, [entity]);

  const save = () => {
    try {
      if (state.kind === 'crawler') {
        onSave(normalizeCrawlerDraft(draft as Crawler));
        return;
      }
      if (state.kind === 'formatter') {
        onSave(normalizeFormatterDraft(draft as Formatter));
        return;
      }
      if (state.kind === 'target') {
        onSave(normalizeTargetDraft(draft as ForwardTarget));
        return;
      }
      onSave(normalizeForwarderDraft(draft as Forwarder));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Invalid entity');
    }
  };

  const title =
    state.kind === 'crawler'
      ? `${state.mode === 'create' ? 'Create' : 'Edit'} crawler`
      : state.kind === 'formatter'
        ? `${state.mode === 'create' ? 'Create' : 'Edit'} formatter`
        : state.kind === 'target'
          ? `${state.mode === 'create' ? 'Create' : 'Edit'} target`
          : `${state.mode === 'create' ? 'Create' : 'Edit'} template`;

  return (
    <ModalFrame
      title={title}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            className="rounded-full bg-cyan-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-300"
          >
            Save
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {state.kind === 'crawler' && (
          <CrawlerEditor
            value={draft as Crawler}
            availableCookies={availableCookies}
            onChange={(nextValue) => setDraft(nextValue)}
          />
        )}
        {state.kind === 'formatter' && (
          <FormatterEditor
            value={draft as Formatter}
            onChange={(nextValue) => setDraft(nextValue)}
          />
        )}
        {state.kind === 'target' && (
          <TargetEditor
            value={draft as ForwardTarget}
            onChange={(nextValue) => setDraft(nextValue)}
          />
        )}
        {state.kind === 'forwarder' && (
          <ForwarderEditor
            value={draft as Forwarder}
            onChange={(nextValue) => setDraft(nextValue)}
          />
        )}
        {formError && (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {formError}
          </div>
        )}
      </div>
    </ModalFrame>
  );
}

function RouteEditorModal({
  state,
  config,
  onClose,
  onSave,
}: {
  state: NonNullable<RouteEditorState>;
  config: AppConfig;
  onClose: () => void;
  onSave: (selectedIds: string[]) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    if (state.kind === 'crawler') {
      setSelectedIds(
        getCrawlerRouteFormatterIds(
          config,
          config.crawlers?.[state.index] || {},
          state.index
        )
      );
      return;
    }
    if (state.kind === 'formatter') {
      setSelectedIds(
        getFormatterTargetIds(
          config,
          config.formatters?.[state.index] || ({ render_type: 'text' } as Formatter),
          state.index
        )
      );
      return;
    }
    setSelectedIds(
      getForwarderGraphTargetIds(
        config,
        config.forwarders?.[state.index] || {},
        state.index
      )
    );
  }, [config, state]);

  const toggle = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id]
    );
  };

  const title =
    state.kind === 'crawler'
      ? `Edit formatter route for ${config.crawlers?.[state.index]?.name || 'crawler'}`
      : state.kind === 'formatter'
        ? `Edit targets for ${config.formatters?.[state.index]?.name || 'formatter'}`
        : `Edit graph targets for ${config.forwarders?.[state.index]?.name || 'template'}`;

  const options =
    state.kind === 'crawler'
      ? (config.formatters || []).map((formatter, index) => {
          const formatterId = getFormatterConnectionKey(formatter, index);
          return {
            id: formatterId,
            label: formatter.name || formatterId,
            meta: `${formatter.render_type} • ${getFormatterTargetIds(config, formatter, index).length} target(s)`,
          };
        })
      : (config.forward_targets || []).map((target, index) => {
          const targetId = getTargetConnectionKey(target, index);
          return {
            id: targetId,
            label: targetId,
            meta: `${target.platform} • ${summarizeTarget(target, index)}`,
          };
        });

  const previewTargetIds =
    state.kind === 'crawler'
      ? sortUnique(
          selectedIds.flatMap(
            (formatterId) => config.connections?.['formatter-target']?.[formatterId] || []
          )
        )
      : selectedIds;

  const inlineSubscriberIds =
    state.kind === 'forwarder'
      ? getForwarderInlineTargetIds(config.forwarders?.[state.index] || {})
      : [];

  return (
    <ModalFrame
      title={title}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(sortUnique(selectedIds))}
            className="rounded-full bg-cyan-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-300"
          >
            Save routing
          </button>
        </>
      }
    >
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-3">
          {options.map((option) => (
            <label
              key={option.id}
              className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3"
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(option.id)}
                onChange={() => toggle(option.id)}
                className="mt-1 accent-cyan-400"
              />
              <div>
                <div className="text-sm font-medium text-white">
                  {option.label}
                </div>
                <div className="mt-1 text-sm text-slate-400">{option.meta}</div>
              </div>
            </label>
          ))}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm font-semibold text-white">Preview</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {previewTargetIds.length === 0 ? (
                <Badge tone="warn">No resolved targets</Badge>
              ) : (
                previewTargetIds.map((targetId) => (
                  <Badge key={targetId} tone="neutral">
                    {targetId}
                  </Badge>
                ))
              )}
            </div>
          </div>

          {state.kind === 'forwarder' && inlineSubscriberIds.length > 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-sm font-semibold text-white">
                Existing inline subscribers
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {inlineSubscriberIds.map((targetId) => (
                  <Badge key={targetId} tone="neutral">
                    {targetId}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </ModalFrame>
  );
}

function ReviewModal({
  sections,
  saving,
  onClose,
  onConfirm,
}: {
  sections: ReviewSection[];
  saving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalFrame
      title="Review config changes"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/10"
          >
            Keep editing
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onConfirm}
            className="rounded-full bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Confirm & save'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {sections.map((section) => (
          <section
            key={section.title}
            className="rounded-2xl border border-white/10 bg-black/20 p-4"
          >
            <h4 className="text-lg font-semibold text-white">{section.title}</h4>
            <div className="mt-3 space-y-3">
              {section.items.map((item) => (
                <div
                  key={`${section.title}-${item.label}-${item.detail}`}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      tone={
                        item.kind === 'warn'
                          ? 'warn'
                          : item.kind === 'removed'
                            ? 'danger'
                            : 'neutral'
                      }
                    >
                      {item.kind}
                    </Badge>
                    <span className="text-sm font-medium text-white">
                      {item.label}
                    </span>
                  </div>
                  <div className="mt-2 text-sm text-slate-300">
                    {item.detail}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
        {sections.length === 0 && (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            No semantic changes detected.
          </div>
        )}
      </div>
    </ModalFrame>
  );
}

function CrawlerEditor({
  value,
  availableCookies,
  onChange,
}: {
  value: Crawler;
  availableCookies: string[];
  onChange: (value: Crawler) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <InputField label="Name" value={String(value.name || '')} onChange={(name) => onChange({ ...value, name })} />
        <InputField label="Group" value={String(value.group || '')} onChange={(group) => onChange({ ...value, group })} />
        <InputField label="Origin" value={String(value.origin || '')} onChange={(origin) => onChange({ ...value, origin })} />
        <SelectField
          label="Task type"
          value={String(value.task_type || 'article')}
          onChange={(task_type) => onChange({ ...value, task_type })}
          options={['article', 'follows']}
        />
        <InputField
          label="Cron"
          value={String(value.cfg_crawler?.cron || '')}
          onChange={(cron) =>
            onChange({
              ...value,
              cfg_crawler: { ...(value.cfg_crawler || {}), cron },
            })
          }
        />
        <SelectField
          label="Cookie file"
          value={String(value.cfg_crawler?.cookie_file || '')}
          onChange={(cookie_file) =>
            onChange({
              ...value,
              cfg_crawler: { ...(value.cfg_crawler || {}), cookie_file },
            })
          }
          options={['', ...availableCookies]}
        />
        <SelectField
          label="Engine"
          value={String(value.cfg_crawler?.engine || 'browser')}
          onChange={(engine) =>
            onChange({
              ...value,
              cfg_crawler: { ...(value.cfg_crawler || {}), engine },
            })
          }
          options={['browser', 'cheerio', 'axios', 'api-graphql']}
        />
        <InputField
          label="User agent"
          value={String(value.cfg_crawler?.user_agent || '')}
          onChange={(user_agent) =>
            onChange({
              ...value,
              cfg_crawler: { ...(value.cfg_crawler || {}), user_agent },
            })
          }
        />
        <InputField
          label="Interval min"
          type="number"
          value={String(value.cfg_crawler?.interval_time?.min ?? '')}
          onChange={(min) =>
            onChange({
              ...value,
              cfg_crawler: {
                ...(value.cfg_crawler || {}),
                interval_time: {
                  ...(value.cfg_crawler?.interval_time || {}),
                  min: numberOrUndefined(min),
                },
              },
            })
          }
        />
        <InputField
          label="Interval max"
          type="number"
          value={String(value.cfg_crawler?.interval_time?.max ?? '')}
          onChange={(max) =>
            onChange({
              ...value,
              cfg_crawler: {
                ...(value.cfg_crawler || {}),
                interval_time: {
                  ...(value.cfg_crawler?.interval_time || {}),
                  max: numberOrUndefined(max),
                },
              },
            })
          }
        />
      </div>
      <TextAreaField label="Paths" value={linesToText(value.paths)} onChange={(paths) => onChange({ ...value, paths: linesFromText(paths) })} rows={4} />
      <TextAreaField label="Websites" value={linesToText(value.websites)} onChange={(websites) => onChange({ ...value, websites: linesFromText(websites) })} rows={4} />
      <TextAreaField
        label="Sub task types"
        value={linesToText(value.cfg_crawler?.sub_task_type)}
        onChange={(subTaskType) =>
          onChange({
            ...value,
            cfg_crawler: {
              ...(value.cfg_crawler || {}),
              sub_task_type: linesFromText(subTaskType),
            },
          })
        }
        rows={3}
      />
      <CheckboxField
        label="Immediate notify"
        checked={Boolean(value.cfg_crawler?.immediate_notify)}
        onChange={(immediate_notify) =>
          onChange({
            ...value,
            cfg_crawler: { ...(value.cfg_crawler || {}), immediate_notify },
          })
        }
      />
    </div>
  );
}

function FormatterEditor({
  value,
  onChange,
}: {
  value: Formatter;
  onChange: (value: Formatter) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <InputField label="ID" value={String(value.id || '')} onChange={(id) => onChange({ ...value, id })} />
        <InputField label="Name" value={String(value.name || '')} onChange={(name) => onChange({ ...value, name })} />
        <InputField label="Group" value={String(value.group || '')} onChange={(group) => onChange({ ...value, group })} />
        <SelectField label="Render type" value={String(value.render_type || 'text')} onChange={(render_type) => onChange({ ...value, render_type })} options={RENDER_TYPE_OPTIONS} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <CheckboxField label="Aggregation" checked={Boolean(value.aggregation)} onChange={(aggregation) => onChange({ ...value, aggregation })} />
        <CheckboxField label="Deduplication" checked={Boolean(value.deduplication)} onChange={(deduplication) => onChange({ ...value, deduplication })} />
      </div>
    </div>
  );
}

function TargetEditor({
  value,
  onChange,
}: {
  value: ForwardTarget;
  onChange: (value: ForwardTarget) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField
          label="Platform"
          value={String(value.platform || 'telegram')}
          onChange={(platform) => onChange({ ...value, platform })}
          options={TARGET_PLATFORM_OPTIONS}
        />
        <InputField
          label="Target ID"
          value={String(value.id || '')}
          onChange={(id) => onChange({ ...value, id })}
        />
        <InputField
          label="Group"
          value={String(value.group || '')}
          onChange={(group) => onChange({ ...value, group })}
        />
        <InputField
          label="Block until"
          value={String(value.cfg_platform?.block_until || '')}
          onChange={(block_until) =>
            onChange({
              ...value,
              cfg_platform: { ...(value.cfg_platform || {}), block_until },
            })
          }
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <TextAreaField
          label="Accept keywords"
          value={linesToText(value.cfg_platform?.accept_keywords as string[] | undefined)}
          onChange={(acceptKeywords) =>
            onChange({
              ...value,
              cfg_platform: {
                ...(value.cfg_platform || {}),
                accept_keywords: linesFromText(acceptKeywords),
              },
            })
          }
          rows={4}
        />
        <TextAreaField
          label="Filter keywords"
          value={linesToText(value.cfg_platform?.filter_keywords as string[] | undefined)}
          onChange={(filterKeywords) =>
            onChange({
              ...value,
              cfg_platform: {
                ...(value.cfg_platform || {}),
                filter_keywords: linesFromText(filterKeywords),
              },
            })
          }
          rows={4}
        />
      </div>

      <TextAreaField
        label="Replace regex"
        value={stringifyStructuredField(value.cfg_platform?.replace_regex)}
        onChange={(replace_regex) =>
          onChange({
            ...value,
            cfg_platform: { ...(value.cfg_platform || {}), replace_regex },
          })
        }
        rows={4}
      />

      <TextAreaField
        label="Block rules (JSON)"
        value={stringifyStructuredField(value.cfg_platform?.block_rules)}
        onChange={(block_rules) =>
          onChange({
            ...value,
            cfg_platform: { ...(value.cfg_platform || {}), block_rules },
          })
        }
        rows={6}
      />

      {value.platform === 'telegram' && (
        <div className="grid gap-4 md:grid-cols-2">
          <InputField
            label="Bot token"
            type="password"
            value={String(value.cfg_platform?.token || '')}
            onChange={(token) =>
              onChange({
                ...value,
                cfg_platform: { ...(value.cfg_platform || {}), token },
              })
            }
          />
          <InputField
            label="Chat ID"
            value={String(value.cfg_platform?.chat_id || '')}
            onChange={(chat_id) =>
              onChange({
                ...value,
                cfg_platform: { ...(value.cfg_platform || {}), chat_id },
              })
            }
          />
        </div>
      )}

      {value.platform === 'qq' && (
        <div className="grid gap-4 md:grid-cols-2">
          <InputField
            label="Endpoint URL"
            value={String(value.cfg_platform?.url || '')}
            onChange={(url) =>
              onChange({
                ...value,
                cfg_platform: { ...(value.cfg_platform || {}), url },
              })
            }
          />
          <InputField
            label="Group ID"
            value={String(value.cfg_platform?.group_id || '')}
            onChange={(group_id) =>
              onChange({
                ...value,
                cfg_platform: { ...(value.cfg_platform || {}), group_id },
              })
            }
          />
          <InputField
            label="Token"
            type="password"
            value={String(value.cfg_platform?.token || '')}
            onChange={(token) =>
              onChange({
                ...value,
                cfg_platform: { ...(value.cfg_platform || {}), token },
              })
            }
          />
        </div>
      )}

      {value.platform === 'bilibili' && (
        <div className="grid gap-4 md:grid-cols-2">
          <InputField
            label="SESSDATA"
            type="password"
            value={String(value.cfg_platform?.sessdata || '')}
            onChange={(sessdata) =>
              onChange({
                ...value,
                cfg_platform: { ...(value.cfg_platform || {}), sessdata },
              })
            }
          />
          <InputField
            label="bili_jct"
            type="password"
            value={String(value.cfg_platform?.bili_jct || '')}
            onChange={(bili_jct) =>
              onChange({
                ...value,
                cfg_platform: { ...(value.cfg_platform || {}), bili_jct },
              })
            }
          />
          <SelectField
            label="Media check"
            value={String(value.cfg_platform?.media_check_level || 'loose')}
            onChange={(media_check_level) =>
              onChange({
                ...value,
                cfg_platform: {
                  ...(value.cfg_platform || {}),
                  media_check_level,
                },
              })
            }
            options={['strict', 'loose', 'none']}
          />
        </div>
      )}
    </div>
  );
}

function ForwarderEditor({
  value,
  onChange,
}: {
  value: Forwarder;
  onChange: (value: Forwarder) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <InputField label="ID" value={String(value.id || '')} onChange={(id) => onChange({ ...value, id })} />
        <InputField label="Name" value={String(value.name || '')} onChange={(name) => onChange({ ...value, name })} />
        <InputField label="Group" value={String(value.group || '')} onChange={(group) => onChange({ ...value, group })} />
        <SelectField label="Task type" value={String(value.task_type || 'article')} onChange={(task_type) => onChange({ ...value, task_type })} options={['article', 'follows']} />
        <InputField label="Origin" value={String(value.origin || '')} onChange={(origin) => onChange({ ...value, origin })} />
        <InputField label="Task title" value={String(value.task_title || '')} onChange={(task_title) => onChange({ ...value, task_title })} />
        <InputField
          label="Cron"
          value={String(value.cfg_forwarder?.cron || '')}
          onChange={(cron) =>
            onChange({
              ...value,
              cfg_forwarder: { ...(value.cfg_forwarder || {}), cron },
            })
          }
        />
        <SelectField
          label="Render type"
          value={String(value.cfg_forwarder?.render_type || 'text')}
          onChange={(render_type) =>
            onChange({
              ...value,
              cfg_forwarder: { ...(value.cfg_forwarder || {}), render_type },
            })
          }
          options={RENDER_TYPE_OPTIONS}
        />
      </div>
      <TextAreaField label="Paths" value={linesToText(value.paths)} onChange={(paths) => onChange({ ...value, paths: linesFromText(paths) })} rows={4} />
      <TextAreaField label="Websites" value={linesToText(value.websites)} onChange={(websites) => onChange({ ...value, websites: linesFromText(websites) })} rows={4} />
      <TextAreaField
        label="Keywords"
        value={linesToText(value.cfg_forwarder?.keywords as string[] | undefined)}
        onChange={(keywords) =>
          onChange({
            ...value,
            cfg_forwarder: {
              ...(value.cfg_forwarder || {}),
              keywords: linesFromText(keywords),
            },
          })
        }
        rows={4}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <TextAreaField
          label="Accept keywords"
          value={linesToText(value.cfg_forward_target?.accept_keywords)}
          onChange={(accept_keywords) =>
            onChange({
              ...value,
              cfg_forward_target: {
                ...(value.cfg_forward_target || {}),
                accept_keywords: linesFromText(accept_keywords),
              },
            })
          }
          rows={4}
        />
        <TextAreaField
          label="Filter keywords"
          value={linesToText(value.cfg_forward_target?.filter_keywords)}
          onChange={(filter_keywords) =>
            onChange({
              ...value,
              cfg_forward_target: {
                ...(value.cfg_forward_target || {}),
                filter_keywords: linesFromText(filter_keywords),
              },
            })
          }
          rows={4}
        />
      </div>
      <TextAreaField
        label="Block rules (JSON)"
        value={stringifyStructuredField(value.cfg_forward_target?.block_rules)}
        onChange={(block_rules) =>
          onChange({
            ...value,
            cfg_forward_target: {
              ...(value.cfg_forward_target || {}),
              block_rules,
            },
          })
        }
        rows={6}
      />
      <div className="grid gap-4 md:grid-cols-3">
        <CheckboxField
          label="Aggregation"
          checked={Boolean(value.cfg_forwarder?.aggregation)}
          onChange={(aggregation) =>
            onChange({
              ...value,
              cfg_forwarder: { ...(value.cfg_forwarder || {}), aggregation },
            })
          }
        />
        <CheckboxField
          label="Deduplication"
          checked={Boolean(value.cfg_forwarder?.deduplication)}
          onChange={(deduplication) =>
            onChange({
              ...value,
              cfg_forwarder: { ...(value.cfg_forwarder || {}), deduplication },
            })
          }
        />
        <CheckboxField
          label="Batch mode"
          checked={Boolean(value.cfg_forwarder?.batch_mode)}
          onChange={(batch_mode) =>
            onChange({
              ...value,
              cfg_forwarder: { ...(value.cfg_forwarder || {}), batch_mode },
            })
          }
        />
      </div>
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-200">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/50"
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  rows,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-200">
        {label}
      </span>
      <textarea
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/50"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-200">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/50"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option || '(empty)'}
          </option>
        ))}
      </select>
    </label>
  );
}

function CheckboxField({
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

function ModalFrame({
  title,
  children,
  footer,
  onClose,
}: {
  title: string;
  children: ReactNode;
  footer: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-3xl border border-white/10 bg-slate-950 shadow-2xl shadow-black/50">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <h3 className="text-xl font-semibold text-white">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-200 transition hover:bg-white/10"
          >
            Close
          </button>
        </div>
        <div className="max-h-[calc(90vh-144px)] overflow-y-auto px-6 py-6">
          {children}
        </div>
        <div className="flex justify-end gap-3 border-t border-white/10 px-6 py-4">
          {footer}
        </div>
      </div>
    </div>
  );
}

function createEntityDraft(kind: EntityKind) {
  if (kind === 'crawler') {
    return {
      name: `Crawler ${Date.now()}`,
      task_type: 'article',
      paths: [],
      websites: [],
      cfg_crawler: {
        engine: 'browser',
      },
    } satisfies Crawler;
  }

  if (kind === 'formatter') {
    return {
      id: `formatter-${Date.now()}`,
      name: 'New Formatter',
      render_type: 'text',
    } satisfies Formatter;
  }

  if (kind === 'target') {
    return {
      id: `target-${Date.now()}`,
      platform: 'telegram',
      cfg_platform: {},
    } satisfies ForwardTarget;
  }

  return {
    id: `forwarder-${Date.now()}`,
    name: 'New Template',
    task_type: 'article',
    paths: [],
    websites: [],
    cfg_forwarder: {
      render_type: 'text',
    },
    cfg_forward_target: {},
  } satisfies Forwarder;
}

function getExistingEntity(config: AppConfig, kind: EntityKind, index: number) {
  if (kind === 'crawler') {
    return config.crawlers?.[index] || createEntityDraft('crawler');
  }
  if (kind === 'formatter') {
    return config.formatters?.[index] || createEntityDraft('formatter');
  }
  if (kind === 'target') {
    return config.forward_targets?.[index] || createEntityDraft('target');
  }
  return config.forwarders?.[index] || createEntityDraft('forwarder');
}

function normalizeCrawlerDraft(draft: Crawler) {
  if (!draft.name?.trim()) {
    throw new Error('Crawler name is required.');
  }

  return {
    ...draft,
    name: draft.name.trim(),
    group: emptyToUndefined(draft.group),
    origin: emptyToUndefined(draft.origin),
    paths: linesOrExisting(draft.paths),
    websites: linesOrExisting(draft.websites),
    cfg_crawler: {
      ...(draft.cfg_crawler || {}),
      cron: emptyToUndefined(draft.cfg_crawler?.cron),
      cookie_file: emptyToUndefined(draft.cfg_crawler?.cookie_file),
      engine: emptyToUndefined(draft.cfg_crawler?.engine),
      user_agent: emptyToUndefined(draft.cfg_crawler?.user_agent),
      interval_time:
        draft.cfg_crawler?.interval_time?.min ||
        draft.cfg_crawler?.interval_time?.max
          ? {
              min: draft.cfg_crawler?.interval_time?.min,
              max: draft.cfg_crawler?.interval_time?.max,
            }
          : undefined,
      sub_task_type: linesOrExisting(draft.cfg_crawler?.sub_task_type),
    },
  } satisfies Crawler;
}

function normalizeFormatterDraft(draft: Formatter) {
  if (!draft.id?.trim()) {
    throw new Error('Formatter ID is required.');
  }

  return {
    ...draft,
    id: draft.id.trim(),
    name: emptyToUndefined(draft.name),
    group: emptyToUndefined(draft.group),
    render_type: draft.render_type || 'text',
  } satisfies Formatter;
}

function normalizeTargetDraft(draft: ForwardTarget) {
  if (!draft.id?.trim()) {
    throw new Error('Target ID is required.');
  }

  const replaceRegex = parseStructuredField(
    stringifyStructuredField(draft.cfg_platform?.replace_regex)
  );
  const blockRules = parseJsonField(
    stringifyStructuredField(draft.cfg_platform?.block_rules)
  );

  const nextCommon = {
    replace_regex: replaceRegex,
    block_until: emptyToUndefined(String(draft.cfg_platform?.block_until || '')),
    accept_keywords: linesOrExisting(
      draft.cfg_platform?.accept_keywords as string[] | undefined
    ),
    filter_keywords: linesOrExisting(
      draft.cfg_platform?.filter_keywords as string[] | undefined
    ),
    block_rules: blockRules,
  };

  let nextPlatform: Record<string, unknown> = {};
  if (draft.platform === 'telegram') {
    nextPlatform = {
      token: emptyToUndefined(String(draft.cfg_platform?.token || '')),
      chat_id: emptyToUndefined(String(draft.cfg_platform?.chat_id || '')),
    };
  } else if (draft.platform === 'qq') {
    nextPlatform = {
      url: emptyToUndefined(String(draft.cfg_platform?.url || '')),
      group_id: emptyToUndefined(String(draft.cfg_platform?.group_id || '')),
      token: emptyToUndefined(String(draft.cfg_platform?.token || '')),
    };
  } else if (draft.platform === 'bilibili') {
    nextPlatform = {
      sessdata: emptyToUndefined(String(draft.cfg_platform?.sessdata || '')),
      bili_jct: emptyToUndefined(String(draft.cfg_platform?.bili_jct || '')),
      media_check_level: emptyToUndefined(
        String(draft.cfg_platform?.media_check_level || '')
      ),
    };
  }

  return {
    ...draft,
    id: draft.id.trim(),
    group: emptyToUndefined(draft.group),
    cfg_platform: {
      ...nextCommon,
      ...nextPlatform,
    },
  } satisfies ForwardTarget;
}

function normalizeForwarderDraft(draft: Forwarder) {
  if (!draft.id?.trim()) {
    throw new Error('Template ID is required.');
  }

  const blockRules = parseJsonField(
    stringifyStructuredField(draft.cfg_forward_target?.block_rules)
  );

  return {
    ...draft,
    id: draft.id.trim(),
    name: emptyToUndefined(draft.name),
    group: emptyToUndefined(draft.group),
    origin: emptyToUndefined(draft.origin),
    task_title: emptyToUndefined(draft.task_title),
    paths: linesOrExisting(draft.paths),
    websites: linesOrExisting(draft.websites),
    cfg_forwarder: {
      ...(draft.cfg_forwarder || {}),
      cron: emptyToUndefined(draft.cfg_forwarder?.cron),
      render_type: emptyToUndefined(draft.cfg_forwarder?.render_type),
      keywords: linesOrExisting(draft.cfg_forwarder?.keywords),
    },
    cfg_forward_target: {
      ...(draft.cfg_forward_target || {}),
      accept_keywords: linesOrExisting(draft.cfg_forward_target?.accept_keywords),
      filter_keywords: linesOrExisting(draft.cfg_forward_target?.filter_keywords),
      block_rules: blockRules,
    },
  } satisfies Forwarder;
}

function stringifyStructuredField(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function parseStructuredField(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith('[') || trimmed.startsWith('"')) {
    return JSON.parse(trimmed) as string | [string, string] | Array<[string, string]>;
  }

  return trimmed;
}

function parseJsonField(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return JSON.parse(trimmed) as Array<Record<string, unknown>>;
}

function linesToText(lines?: string[]) {
  return (lines || []).join('\n');
}

function linesFromText(value: string) {
  const lines = value
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : undefined;
}

function linesOrExisting(value?: string[]) {
  return value && value.length > 0 ? sortUnique(value) : undefined;
}

function emptyToUndefined(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function numberOrUndefined(value: string) {
  if (!value.trim()) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
