'use client';

import Link from 'next/link';
import { useAuth } from '@/middleware/WithAuth';
import type { Player } from '@/lib/db';

interface PlayerCardProps {
  player: Player;
  onEdit?: (player: Player) => void;
  onDelete?: (player: Player) => void;
}

export default function PlayerCard({ player, onEdit, onDelete }: PlayerCardProps) {
  const { user } = useAuth();

  const handleEdit = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onEdit?.(player);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!confirm('Are you sure you want to delete this player?')) {
      return;
    }
    
    onDelete?.(player);
  };

  return (
    <div className="group relative">
      <Link href={`/player/${player.pId}`} className="block">
        <div className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow duration-300">
          {player.coverUrl && (
            <div className="aspect-w-16 aspect-h-9 relative">
              <img
                src={player.coverUrl}
                alt={player.name}
                className="w-full h-48 object-cover group-hover:scale-105 transition-transform duration-300"
              />
              {user?.role === 'admin' && (
                <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={handleEdit}
                    className="p-1.5 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors shadow-lg"
                    title="Edit"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    onClick={handleDelete}
                    className="p-1.5 bg-red-600 text-white rounded-full hover:bg-red-700 transition-colors shadow-lg"
                    title="Delete"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2 group-hover:text-blue-600">
              {player.name}
            </h3>
            {player.description && (
              <p className="text-gray-600 text-sm line-clamp-2 mb-3">
                {player.description}
              </p>
            )}
            {player.announcement && (
              <div className="p-2 bg-yellow-50 border-l-4 border-yellow-400 rounded">
                <p className="text-yellow-800 text-xs">
                  {player.announcement}
                </p>
              </div>
            )}
            {user?.role === 'admin' && !player.coverUrl && (
              <div className="flex gap-2 mt-3">
                <button
                  onClick={handleEdit}
                  className="flex-1 px-3 py-1 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={handleDelete}
                  className="flex-1 px-3 py-1 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded hover:bg-red-100 transition-colors"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </Link>
    </div>
  );
}