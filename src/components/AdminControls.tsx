'use client';

import { useAuth } from '@/middleware/WithAuth';

export default function AdminControls() {
  const { user, logout } = useAuth();

  if (user?.role !== 'admin') {
    return null;
  }

  return (
    <div className="flex items-center gap-4 mb-8">
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
          管理员
        </span>
        <span>当前用户：{user.username}</span>
      </div>
      <button
        onClick={logout}
        className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 transition-colors"
      >
        退出登录
      </button>
    </div>
  );
}
