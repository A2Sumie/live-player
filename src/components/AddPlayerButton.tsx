'use client';

import { useAuth } from '@/middleware/WithAuth';

interface AddPlayerButtonProps {
  onClick: () => void;
  variant?: 'normal' | 'card';
}

export default function AddPlayerButton({ onClick, variant = 'normal' }: AddPlayerButtonProps) {
  const { user } = useAuth();

  if (user?.role !== 'admin') {
    return null;
  }

  if (variant === 'card') {
    return (
      <div
        onClick={onClick}
        className="group cursor-pointer rounded-2xl border-2 border-dashed border-white/50 bg-white/22 backdrop-blur-lg transition-all duration-300 hover:border-blue-300/90 hover:bg-blue-50/36"
        style={{ aspectRatio: '16/9' }}
      >
        <div className="flex h-full flex-col items-center justify-center text-gray-500 transition-colors group-hover:text-blue-500">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/32 transition-colors group-hover:bg-blue-100/52">
            <svg 
              className="w-6 h-6" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <span className="text-sm font-medium">新增频道</span>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={onClick}
      className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
    >
      <svg 
        className="w-4 h-4 mr-2" 
        fill="none" 
        stroke="currentColor" 
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
      </svg>
      新增频道
    </button>
  );
}
