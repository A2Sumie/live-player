import Link from 'next/link';
import { requireCICAccess } from '@/lib/cic-auth';

const DASHBOARD_CARDS = [
  {
    href: '/cic/config',
    title: '配置',
    body: '管理 crawler、formatter、target 与 template / forwarder 路由，并在保存前查看语义审阅。',
  },
  {
    href: '/cic/ops',
    title: '运维',
    body: '查询文章与任务、热运行 crawler、执行 processor，并查看数据库内的处理结果。',
  },
  {
    href: '/cic/cookies',
    title: 'Cookie',
    body: '管理抓取器使用的 Cookie 文件，并在需要时重启内部服务。',
  },
  {
    href: '/cic/logs',
    title: '日志',
    body: '在控制台内直接查看最新的 D1 系统日志。',
  },
  {
    href: '/cic/schedules',
    title: '日程',
    body: '创建并查看提醒、转播和工作流任务的调度状态。',
  },
];

export default async function CICDashboardPage() {
  await requireCICAccess('/cic');

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-slate-950/30">
        <div className="max-w-3xl">
          <div className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-300/80">
            统一运维入口
          </div>
          <h2 className="mt-2 text-3xl font-semibold text-white">
            CIC 操作统一收口
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            现在 Config、Cookie、日志和日程已经统一收进同一套鉴权控制台。
            旧入口仍然通过兼容跳转保留，但后续运维操作应以这里为主。
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
