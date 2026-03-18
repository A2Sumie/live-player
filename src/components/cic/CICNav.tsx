'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/middleware/WithAuth';

const NAV_ITEMS = [
  { href: '/cic', label: '总览' },
  { href: '/cic/config', label: '配置' },
  { href: '/cic/ops', label: '运维' },
  { href: '/cic/cookies', label: 'Cookie' },
  { href: '/cic/logs', label: '日志' },
  { href: '/cic/schedules', label: '日程' },
];

type CICNavProps = {
  fallbackUsername?: string | null;
  fallbackRole?: string | null;
};

export default function CICNav({
  fallbackUsername,
  fallbackRole,
}: CICNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  const username = user?.username || fallbackUsername || 'admin';
  const role = user?.role || fallbackRole || 'admin';
  const roleLabel = role === 'admin' ? '管理员' : role;

  const isActive = (href: string) => {
    if (href === '/cic') {
      return pathname === '/cic';
    }

    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      router.push('/auth/login?redirect=/cic');
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <header className="border-b border-white/10 bg-slate-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300/80">
              CIC 控制台
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-white">
              live-player 运维中心
            </h1>
            <p className="mt-1 text-sm text-slate-300">
              以路由为中心统一管理配置、Cookie、日志与日程。
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-right">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
                当前会话
              </div>
              <div className="text-sm font-medium text-white">
                {username}
              </div>
              <div className="text-xs text-slate-400">{roleLabel}</div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loggingOut ? '正在退出...' : '退出登录'}
            </button>
          </div>
        </div>

        <nav className="flex flex-wrap gap-2">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  active
                    ? 'bg-cyan-400 text-slate-950'
                    : 'bg-white/5 text-slate-200 hover:bg-white/10'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
