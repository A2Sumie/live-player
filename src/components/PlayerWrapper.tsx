'use client';

import dynamic from 'next/dynamic';
import React from 'react';
// Import the props type if possible, or define interface
import type { Player } from '@/lib/db';

interface PlayerProps {
    player: Player;
    debug?: boolean;
}

const PlayerComponent = dynamic(() => import('@/components/Player'), {
    ssr: false,
    loading: () => <div className="min-h-screen bg-black text-white flex items-center justify-center">正在加载播放器...</div>
});

export default function PlayerWrapper(props: PlayerProps) {
    return <PlayerComponent {...props} />;
}
