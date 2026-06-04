'use client';

import { useAuth } from '@/middleware/WithAuth';

export default function AdminControls() {
  const { user, logout } = useAuth();

  if (user?.role !== 'admin') {
    return null;
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
        <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800">
          管理员
        </span>
        <span>当前用户：{user.username}</span>
      </div>
      <button
        onClick={logout}
        className="inline-flex items-center justify-center rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-100"
      >
        退出登录
      </button>
    </div>
  );
}
