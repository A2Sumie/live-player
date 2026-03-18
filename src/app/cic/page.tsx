import Link from 'next/link';
import { requireCICAccess } from '@/lib/cic-auth';

const DASHBOARD_CARDS = [
  {
    href: '/cic/config',
    title: 'Config',
    body: 'Edit crawlers, formatters, targets, and template routing with semantic review.',
  },
  {
    href: '/cic/cookies',
    title: 'Cookies',
    body: 'Manage crawler cookie files and restart the internal service when needed.',
  },
  {
    href: '/cic/logs',
    title: 'Logs',
    body: 'Inspect the latest D1-backed system logs without leaving the control center.',
  },
  {
    href: '/cic/schedules',
    title: 'Schedules',
    body: 'Create and monitor scheduled jobs for reminders, streams, and workflows.',
  },
];

export default async function CICDashboardPage() {
  await requireCICAccess('/cic');

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-slate-950/30">
        <div className="max-w-3xl">
          <div className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-300/80">
            Unified Operations
          </div>
          <h2 className="mt-2 text-3xl font-semibold text-white">
            One entry point for CIC operations
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            The control center now groups config, cookies, logs, and schedules
            behind a single authenticated surface. Legacy routes remain wired
            through compatibility redirects, but operational work should happen
            here.
          </p>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {DASHBOARD_CARDS.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 transition hover:-translate-y-0.5 hover:border-cyan-400/50 hover:bg-slate-900"
          >
            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">
              {card.title}
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-300">{card.body}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}
