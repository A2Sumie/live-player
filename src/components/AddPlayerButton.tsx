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
        className="bg-white border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-all duration-300 cursor-pointer group"
        style={{ aspectRatio: '16/9' }}
      >
        <div className="flex flex-col items-center justify-center h-full text-gray-400 group-hover:text-blue-500 transition-colors">
          <div className="w-12 h-12 rounded-full bg-gray-100 group-hover:bg-blue-100 flex items-center justify-center mb-3 transition-colors">
            <svg 
              className="w-6 h-6" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <span className="text-sm font-medium">Add Player</span>
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
      Add Player
    </button>
  );
}