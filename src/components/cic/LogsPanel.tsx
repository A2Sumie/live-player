'use client';

import { useEffect, useState } from 'react';

type LogEntry = {
  id: number;
  level: string;
  message: string;
  details: string | null;
  source: string | null;
  createdAt: string;
};

export default function LogsPanel() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const fetchLogs = async (background = false) => {
    if (!background) {
      setLoading(true);
    }

    try {
      const res = await fetch('/api/logs?limit=100');
      if (res.ok) {
        const data = (await res.json()) as LogEntry[];
        setLogs(data);
      }
    } catch (error) {
      console.error('Failed to fetch logs:', error);
    } finally {
      if (!background) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  useEffect(() => {
    if (!autoRefresh) {
      return;
    }

    const timer = setInterval(() => {
      fetchLogs(true);
    }, 5000);

    return () => clearInterval(timer);
  }, [autoRefresh]);

  const toggleRow = (id: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'error':
        return 'text-rose-300 bg-rose-500/10 border-rose-500/20';
      case 'warn':
        return 'text-amber-200 bg-amber-500/10 border-amber-500/20';
      default:
        return 'text-cyan-200 bg-cyan-500/10 border-cyan-500/20';
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300/80">
              System Logs
            </div>
            <h2 className="mt-2 text-3xl font-semibold text-white">
              Recent control-plane activity
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              The latest 100 D1-backed log records exposed by the existing
              `GET /api/logs` endpoint.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-4 py-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(event) => setAutoRefresh(event.target.checked)}
                className="accent-cyan-400"
              />
              Auto refresh
            </label>
            <button
              type="button"
              onClick={() => fetchLogs()}
              className="rounded-full bg-cyan-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-300"
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-white/10 bg-slate-950/80 shadow-2xl shadow-slate-950/30">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-white/5 text-xs uppercase tracking-[0.2em] text-slate-400">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Level</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Message</th>
                <th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-slate-200">
              {logs.map((log) => {
                const expanded = expandedRows.has(log.id);
                return (
                  <FragmentRow
                    key={log.id}
                    expanded={expanded}
                    header={
                      <tr
                        className="cursor-pointer transition hover:bg-white/5"
                        onClick={() => toggleRow(log.id)}
                      >
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-400">
                          {new Date(log.createdAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold uppercase ${getLevelColor(
                              log.level
                            )}`}
                          >
                            {log.level}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-300">
                          {log.source || '-'}
                        </td>
                        <td className="px-4 py-3">{log.message}</td>
                        <td className="px-4 py-3 text-slate-500">
                          {log.details ? (expanded ? 'Hide' : 'Show') : '-'}
                        </td>
                      </tr>
                    }
                    detail={
                      expanded && log.details ? (
                        <tr>
                          <td colSpan={5} className="bg-black/30 px-4 py-4">
                            <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-black/40 p-4 text-xs text-emerald-300">
                              {formatLogDetails(log.details)}
                            </pre>
                          </td>
                        </tr>
                      ) : null
                    }
                  />
                );
              })}

              {!loading && logs.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-10 text-center text-slate-500"
                  >
                    No logs found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function FragmentRow({
  header,
  detail,
}: {
  header: React.ReactNode;
  detail: React.ReactNode;
  expanded: boolean;
}) {
  return (
    <>
      {header}
      {detail}
    </>
  );
}

function formatLogDetails(details: string) {
  try {
    return JSON.stringify(JSON.parse(details), null, 2);
  } catch {
    return details;
  }
}
