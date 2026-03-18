'use client';

import { FormEvent, useEffect, useState } from 'react';

type Schedule = {
  id: number;
  title: string;
  description: string | null;
  scheduleType: string;
  executionTime: string;
  status: string;
  createdBy: string | null;
};

export default function SchedulesPanel() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const loadSchedules = async () => {
    try {
      const res = await fetch('/api/schedules?upcoming=true');
      if (res.ok) {
        const data = (await res.json()) as Schedule[];
        setSchedules(data);
      }
    } catch (error) {
      console.error('加载日程失败:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSchedules();
    const timer = setInterval(loadSchedules, 30000);
    return () => clearInterval(timer);
  }, []);

  const createSchedule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    const payload: Record<string, unknown> = {
      title: formData.get('title'),
      description: formData.get('description'),
      scheduleType: formData.get('scheduleType'),
      executionTime: new Date(
        formData.get('executionTime') as string
      ).toISOString(),
    };

    if (
      payload.scheduleType === 'workflow' ||
      payload.scheduleType === 'stream'
    ) {
      payload.payload = {
        type: 'start_network_stream',
        playerId: formData.get('playerId'),
        source: formData.get('source'),
        name: formData.get('title'),
      };
    }

    try {
      const res = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setShowCreateForm(false);
        event.currentTarget.reset();
        loadSchedules();
      } else {
        alert('创建日程失败');
      }
    } catch (error) {
      console.error('创建日程失败:', error);
      alert('创建日程失败');
    }
  };

  const deleteSchedule = async (id: number) => {
    if (!confirm('确认删除这个日程吗？')) {
      return;
    }

    try {
      const res = await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
      if (res.ok) {
        loadSchedules();
      }
    } catch (error) {
      console.error('删除日程失败:', error);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300/80">
              日程
            </div>
            <h2 className="mt-2 text-3xl font-semibold text-white">
              即将执行的自动化任务
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              现有基于 D1 的日程逻辑没有变化，这一页只是把它们统一纳入 CIC 外壳。
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setShowCreateForm((prev) => !prev)}
              className="rounded-full bg-cyan-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-300"
            >
              {showCreateForm ? '收起表单' : '新建日程'}
            </button>
            <button
              type="button"
              onClick={loadSchedules}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/10"
            >
              刷新
            </button>
          </div>
        </div>
      </section>

      {showCreateForm && (
        <section className="rounded-3xl border border-white/10 bg-slate-950/80 p-6">
          <h3 className="text-xl font-semibold text-white">新建日程</h3>
          <form onSubmit={createSchedule} className="mt-6 grid gap-4 md:grid-cols-2">
            <TextField label="标题" name="title" required />
            <SelectField
              label="类型"
              name="scheduleType"
              options={[
                { label: '转播', value: 'stream' },
                { label: '工作流', value: 'workflow' },
                { label: '提醒', value: 'reminder' },
              ]}
            />
            <TextField
              label="执行时间"
              name="executionTime"
              type="datetime-local"
              required
            />
            <TextField label="播放器 ID" name="playerId" />
            <TextField label="流地址" name="source" type="url" />
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-200">
                描述
              </label>
              <textarea
                name="description"
                rows={4}
                className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/50"
              />
            </div>
            <div className="md:col-span-2">
              <button
                type="submit"
                className="rounded-full bg-emerald-400 px-5 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-300"
              >
                保存日程
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="space-y-4">
        {loading ? (
          <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-10 text-center text-slate-400">
            正在加载日程...
          </div>
        ) : schedules.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-10 text-center text-slate-500">
            暂无即将执行的日程。
          </div>
        ) : (
          schedules.map((schedule) => (
            <article
              key={schedule.id}
              className="rounded-3xl border border-white/10 bg-slate-950/75 p-5"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold text-white">
                      {schedule.title}
                    </h3>
                    <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-xs font-medium uppercase tracking-[0.2em] text-cyan-200">
                      {schedule.scheduleType}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs font-medium uppercase tracking-[0.2em] text-slate-300">
                      {schedule.status}
                    </span>
                  </div>
                  {schedule.description && (
                    <p className="mt-2 text-sm text-slate-300">
                      {schedule.description}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-400">
                    <span>{new Date(schedule.executionTime).toLocaleString()}</span>
                    <span>创建者：{schedule.createdBy || '系统'}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => deleteSchedule(schedule.id)}
                  className="rounded-full border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-500/20"
                >
                  删除
                </button>
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
}

function TextField({
  label,
  name,
  type = 'text',
  required = false,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-200">
        {label}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/50"
      />
    </label>
  );
}

function SelectField({
  label,
  name,
  options,
}: {
  label: string;
  name: string;
  options: Array<{ label: string; value: string }>;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-200">
        {label}
      </span>
      <select
        name={name}
        className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/50"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
