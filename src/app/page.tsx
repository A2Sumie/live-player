'use client';

import { useEffect, useMemo, useState } from 'react';
import AdminControls from '@/components/AdminControls';
import AddPlayerButton from '@/components/AddPlayerButton';
import ArchiveAdminPanel from '@/components/ArchiveAdminPanel';
import PlayerCard from '@/components/PlayerCard';
import PlayerModal from '@/components/PlayerModal';
import ProtectedOutboundLink from '@/components/ProtectedOutboundLink';
import { useAuth } from '@/middleware/WithAuth';
import type { Player } from '@/lib/db';
import type { PlayerView } from '@/lib/player-runtime';
import { isTwentyTwoSevenPlayer } from '@/lib/player-flags';

const LIVE_RUNTIME_STATUSES = new Set(['live', 'running', 'online']);

function isRelayPlayer(player: PlayerView) {
  return player.pId === 'relay' || /relay/i.test(`${player.pId} ${player.name} ${player.runtimeName || ''}`);
}

function isLiveRuntimePlayer(player: PlayerView) {
  return LIVE_RUNTIME_STATUSES.has(String(player.runtimeStatus || '').trim().toLowerCase());
}

export default function Home() {
  const [players, setPlayers] = useState<PlayerView[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { user } = useAuth();

  const fetchPlayers = async () => {
    try {
      const response = await fetch('/api/players');
      if (response.ok) {
        const data = await response.json() as PlayerView[];
        setPlayers(data);
      }
    } catch (error) {
      console.error('Error fetching players:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlayers();
  }, []);

  const relayPlayer = useMemo(
    () => players.find((player) => isRelayPlayer(player)) || null,
    [players]
  );

  const runningRelayPlayer = relayPlayer && isLiveRuntimePlayer(relayPlayer) ? relayPlayer : null;

  const activePlayers = useMemo(
    () => players.filter((player) => isLiveRuntimePlayer(player) && player.id !== relayPlayer?.id),
    [players, relayPlayer]
  );

  const twentyTwoSevenPlayer = useMemo(
    () => players.find((player) => isTwentyTwoSevenPlayer(player)) || null,
    [players]
  );

  const featuredPlayers = useMemo(() => {
    const entries = [
      ...(runningRelayPlayer ? [runningRelayPlayer] : []),
      ...activePlayers,
      ...(twentyTwoSevenPlayer ? [twentyTwoSevenPlayer] : []),
    ];
    const seen = new Set<number>();
    return entries.filter((player) => {
      if (seen.has(player.id)) {
        return false;
      }
      seen.add(player.id);
      return true;
    });
  }, [activePlayers, runningRelayPlayer, twentyTwoSevenPlayer]);

  const orderedPlayers = useMemo(() => {
    const seen = new Set<number>();
    const promoted = featuredPlayers.filter((player) => {
      if (seen.has(player.id)) {
        return false;
      }
      seen.add(player.id);
      return true;
    });
    return [
      ...promoted,
      ...players.filter((player) => !seen.has(player.id)),
    ];
  }, [featuredPlayers, players]);

  const handleAddPlayer = () => {
    setEditingPlayer(null);
    setModalOpen(true);
  };

  const handleEditPlayer = async (player: Pick<Player, 'id'>) => {
    try {
      const response = await fetch(`/api/players/${player.id}`);
      if (response.ok) {
        const fullPlayer = await response.json() as Player;
        setEditingPlayer(fullPlayer);
        setModalOpen(true);
      } else {
        alert('获取频道完整信息失败');
      }
    } catch (error) {
      console.error('Error fetching full player:', error);
      alert('获取频道完整信息失败');
    }
  };

  const handleDeletePlayer = async (player: Pick<Player, 'id'>) => {
    try {
      const response = await fetch(`/api/players/${player.id}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (response.ok) {
        setPlayers(prev => prev.filter(p => p.id !== player.id));
      } else {
        const error = await response.json();
        alert((error as { error: string }).error || '删除失败');
      }
    } catch (error) {
      console.error('Error deleting player:', error);
      alert('删除失败');
    }
  };

  const handleSubmitPlayer = async (playerData: Omit<Player, 'id' | 'createdAt' | 'updatedAt' | 'coverImage'>) => {
    setSubmitting(true);

    try {
      const isEditing = !!editingPlayer;
      const url = isEditing ? `/api/players/${editingPlayer.id}` : '/api/players';
      const method = isEditing ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(playerData)
      });

      if (response.ok) {
        await fetchPlayers();
        setModalOpen(false);
        setEditingPlayer(null);
      } else {
        const error = await response.json();
        alert((error as { error: string }).error || (isEditing ? '更新失败' : '创建失败'));
      }
    } catch (error) {
      console.error('Error submitting player:', error);
      alert(editingPlayer ? '更新失败' : '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-foreground">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-background text-foreground py-8 bg-cover bg-center bg-no-repeat bg-fixed relative transition-colors duration-300"
      style={{
        backgroundImage: 'url("/background.png")',
      }}
    >
      <div className="absolute inset-0 bg-white/6" />

      <div className="relative z-10 mx-auto max-w-[1560px] px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <div className="mb-6 rounded-2xl border border-white/40 bg-white/22 px-5 py-6 shadow-lg shadow-slate-900/10 backdrop-blur-lg sm:px-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 text-center sm:text-left">
                <h1 className="mb-2 text-3xl font-bold text-slate-900 sm:text-4xl">
                  TV.N2NJ.MOE 共星组呈上
                </h1>
                <h2 className="text-base font-medium text-slate-700 sm:text-xl">
                  <span>为22/7以及秋系同好的转播站 基于ChocoLZS/live-player </span>
                  <ProtectedOutboundLink
                    linkId="qq-group"
                    title="打开群组入口"
                    confirmMessage="加入百合鸥谢谢喵\n最好的22/7中文群组谢谢喵"
                    popoverPlacement="bottom"
                    dismissAfterMs={5000}
                    fadeAfterMs={3000}
                    newTab={false}
                    className="inline-flex items-center rounded-lg px-1 font-semibold text-cyan-700 underline decoration-cyan-500/80 underline-offset-4 transition hover:text-cyan-900"
                  >
                    群组@Q.161717573
                  </ProtectedOutboundLink>
                </h2>
              </div>

              <ProtectedOutboundLink
                linkId="qq-group"
                title="打开群组入口"
                newTab={false}
                className="self-center rounded-2xl p-2 transition hover:bg-white/30 hover:backdrop-blur-lg sm:self-start"
              >
                <img src="/logo.png" alt="N2NJ Logo" className="h-12 w-auto opacity-90 sm:h-14" />
              </ProtectedOutboundLink>
            </div>
          </div>
        </div>

        {user?.role === 'admin' ? (
          <div className="space-y-8">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_320px] xl:items-start">
              <section className="rounded-3xl border border-white/45 bg-white/18 p-5 shadow-lg shadow-slate-900/10 backdrop-blur-xl">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.32em] text-sky-700/80">
                      Control Deck
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold text-slate-900">
                      转播入口与进行中的 TV
                    </h2>
                    <p className="mt-2 text-sm text-slate-700">
                      `relay`、进行中的 TV 和 22/7 固定放在最上面，优先保证开始、停流和编辑入口都顺手。
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white/80 px-3 py-2 text-xs text-slate-500">
                    {featuredPlayers.length} 项
                  </div>
                </div>

                {featuredPlayers.length === 0 ? (
                  <div className="mt-4 rounded-2xl border border-dashed border-white/55 bg-white/22 px-4 py-6 text-sm text-slate-700">
                    当前没有运行中的 relay 或 TV 频道。
                  </div>
                ) : (
                  <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {featuredPlayers.map((player) => (
                      <PlayerCard
                        key={`featured-${player.id}`}
                        player={player}
                        onEdit={handleEditPlayer}
                        onDelete={handleDeletePlayer}
                      />
                    ))}
                  </div>
                )}
              </section>

              <aside className="xl:sticky xl:top-6">
                <section className="rounded-3xl border border-white/45 bg-white/18 p-5 shadow-lg shadow-slate-900/10 backdrop-blur-xl">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-700/80">
                      Admin Deck
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold text-slate-900">
                      管理操作
                    </h2>
                    <p className="mt-2 text-sm text-slate-700">
                      管理员身份、退出和常用后台动作集中在这里，不占主编辑区。
                    </p>
                  </div>

                  <div className="mt-4 rounded-2xl border border-white/50 bg-white/26 px-4 py-3 shadow-sm shadow-slate-900/5">
                    <AdminControls />
                  </div>
                </section>
              </aside>
            </div>

            <div className="space-y-8">
              <ArchiveAdminPanel />

              {players.length === 0 ? (
                <div className="rounded-2xl border border-white/44 bg-white/20 px-6 py-12 text-center shadow-lg shadow-slate-900/10 backdrop-blur-lg">
                  <p className="text-slate-700/80 text-lg mb-4">当前没有可用频道</p>
                  <AddPlayerButton onClick={handleAddPlayer} />
                </div>
              ) : (
                <section>
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-semibold text-slate-900">全部频道</h2>
                      <p className="mt-1 text-sm text-slate-700">
                        这里保留完整频道列表，置顶区只作为 relay、进行中 TV 和 22/7 的快捷入口。
                      </p>
                    </div>
                    <div className="text-xs text-slate-500">{players.length} 项</div>
                  </div>

                  {players.length === 0 ? (
                    <div className="rounded-2xl border border-white/44 bg-white/20 px-6 py-10 text-center shadow-lg shadow-slate-900/10 backdrop-blur-lg">
                      <p className="text-slate-700/80 text-base mb-4">当前还没有频道。</p>
                      <AddPlayerButton onClick={handleAddPlayer} />
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4">
                      {orderedPlayers.map((player) => (
                        <PlayerCard
                          key={player.id}
                          player={player}
                          onEdit={handleEditPlayer}
                          onDelete={handleDeletePlayer}
                        />
                      ))}
                      <AddPlayerButton onClick={handleAddPlayer} variant="card" />
                    </div>
                  )}
                </section>
              )}
            </div>
          </div>
        ) : players.length === 0 ? (
          <div className="rounded-2xl border border-white/44 bg-white/20 px-6 py-12 text-center shadow-lg shadow-slate-900/10 backdrop-blur-lg">
            <p className="text-slate-700/80 text-lg mb-4">当前没有可用频道</p>
          </div>
        ) : (
          <section>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {orderedPlayers.map((player) => (
                <PlayerCard
                  key={player.id}
                  player={player}
                  onEdit={handleEditPlayer}
                  onDelete={handleDeletePlayer}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      <PlayerModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingPlayer(null);
        }}
        onSubmit={handleSubmitPlayer}
        player={editingPlayer}
        loading={submitting}
      />
    </div>
  );
}
