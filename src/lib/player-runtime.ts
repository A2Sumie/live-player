import { desc, eq } from 'drizzle-orm';
import { cache, CACHE_KEYS } from '@/lib/cache';
import { getDb, playerRuntime, players, type Player, type PlayerRuntime } from '@/lib/db';

export type PlayerView = Player & {
  editorialName: string;
  editorialDescription: string | null;
  editorialUrl: string;
  editorialCoverUrl: string | null;
  runtimeName: string | null;
  runtimeDescription: string | null;
  runtimeUrl: string | null;
  runtimeCoverUrl: string | null;
  runtimeStatus: string | null;
  runtimeStreamConfig: string | null;
  runtimeLastError: string | null;
  runtimeLastSeenAt: string | null;
  runtimeUpdatedAt: string | null;
};

export type PlayerRuntimeRecord = {
  player: Player;
  runtime: PlayerRuntime | null;
};

export type PlayerRuntimePatch = {
  name?: string | null;
  description?: string | null;
  url?: string | null;
  coverUrl?: string | null;
  streamConfig?: string | null;
  status?: string | null;
  lastError?: string | null;
  lastSeenAt?: string | null;
};

type DbClient = ReturnType<typeof getDb>;

function toEpoch(value?: string | null) {
  if (!value) {
    return 0;
  }

  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function latestTimestamp(primary: string, secondary?: string | null) {
  if (!secondary) {
    return primary;
  }

  return toEpoch(secondary) > toEpoch(primary) ? secondary : primary;
}

function sortByUpdatedAtDesc(left: { updatedAt: string }, right: { updatedAt: string }) {
  return toEpoch(right.updatedAt) - toEpoch(left.updatedAt);
}

export function mergePlayerWithRuntime(player: Player, runtime: PlayerRuntime | null): PlayerView {
  return {
    ...player,
    name: runtime?.name ?? player.name,
    description: runtime?.description ?? player.description,
    url: runtime?.url ?? player.url,
    coverUrl: runtime?.coverUrl ?? player.coverUrl,
    updatedAt: latestTimestamp(player.updatedAt, runtime?.updatedAt),
    editorialName: player.name,
    editorialDescription: player.description,
    editorialUrl: player.url,
    editorialCoverUrl: player.coverUrl,
    runtimeName: runtime?.name ?? null,
    runtimeDescription: runtime?.description ?? null,
    runtimeUrl: runtime?.url ?? null,
    runtimeCoverUrl: runtime?.coverUrl ?? null,
    runtimeStatus: runtime?.status ?? null,
    runtimeStreamConfig: runtime?.streamConfig ?? null,
    runtimeLastError: runtime?.lastError ?? null,
    runtimeLastSeenAt: runtime?.lastSeenAt ?? null,
    runtimeUpdatedAt: runtime?.updatedAt ?? null,
  };
}

export function invalidatePlayerCaches(...pIds: Array<string | null | undefined>) {
  cache.delete(CACHE_KEYS.PLAYER_LIST);
  cache.delete(CACHE_KEYS.PLAYER_CONFIGS);

  const seen = new Set<string>();
  for (const pId of pIds) {
    if (!pId || seen.has(pId)) {
      continue;
    }
    seen.add(pId);
    cache.delete(CACHE_KEYS.PLAYER(pId));
  }
}

export async function listPlayerViews(db: DbClient = getDb()): Promise<PlayerView[]> {
  const records = await listPlayerRuntimeRecords(db);
  return records
    .map((record) => mergePlayerWithRuntime(record.player, record.runtime))
    .sort(sortByUpdatedAtDesc);
}

export async function listPlayerRuntimeRecords(
  db: DbClient = getDb(),
): Promise<PlayerRuntimeRecord[]> {
  const rows = await db
    .select()
    .from(players)
    .leftJoin(playerRuntime, eq(playerRuntime.playerId, players.id))
    .orderBy(desc(players.updatedAt));

  return rows.map((row) => ({
    player: row.players,
    runtime: row.player_runtime,
  }));
}

export async function getPlayerRuntimeRecordByPid(
  pId: string,
  db: DbClient = getDb(),
): Promise<PlayerRuntimeRecord | null> {
  const [row] = await db
    .select()
    .from(players)
    .leftJoin(playerRuntime, eq(playerRuntime.playerId, players.id))
    .where(eq(players.pId, pId))
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    player: row.players,
    runtime: row.player_runtime,
  };
}

export async function getPlayerRuntimeRecordById(
  id: number,
  db: DbClient = getDb(),
): Promise<PlayerRuntimeRecord | null> {
  const [row] = await db
    .select()
    .from(players)
    .leftJoin(playerRuntime, eq(playerRuntime.playerId, players.id))
    .where(eq(players.id, id))
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    player: row.players,
    runtime: row.player_runtime,
  };
}

export async function getPlayerViewByPid(
  pId: string,
  db: DbClient = getDb(),
): Promise<PlayerView | null> {
  const record = await getPlayerRuntimeRecordByPid(pId, db);
  if (!record) {
    return null;
  }

  return mergePlayerWithRuntime(record.player, record.runtime);
}

export async function upsertPlayerRuntimeByPid(
  pId: string,
  patch: PlayerRuntimePatch,
  db: DbClient = getDb(),
): Promise<PlayerView | null> {
  const record = await getPlayerRuntimeRecordByPid(pId, db);
  if (!record) {
    return null;
  }

  const now = new Date().toISOString();
  const updateData: Record<string, string | null> = {
    updatedAt: now,
  };

  if ('name' in patch) updateData.name = patch.name ?? null;
  if ('description' in patch) updateData.description = patch.description ?? null;
  if ('url' in patch) updateData.url = patch.url ?? null;
  if ('coverUrl' in patch) updateData.coverUrl = patch.coverUrl ?? null;
  if ('streamConfig' in patch) updateData.streamConfig = patch.streamConfig ?? null;
  if ('status' in patch) updateData.status = patch.status ?? 'idle';
  if ('lastError' in patch) updateData.lastError = patch.lastError ?? null;
  if ('lastSeenAt' in patch) {
    updateData.lastSeenAt = patch.lastSeenAt ?? null;
  } else if (Object.keys(updateData).length > 1) {
    updateData.lastSeenAt = now;
  }

  if (record.runtime) {
    await db
      .update(playerRuntime)
      .set(updateData)
      .where(eq(playerRuntime.playerId, record.player.id));
  } else {
    await db.insert(playerRuntime).values({
      playerId: record.player.id,
      name: updateData.name ?? null,
      description: updateData.description ?? null,
      url: updateData.url ?? null,
      coverUrl: updateData.coverUrl ?? null,
      streamConfig: updateData.streamConfig ?? null,
      status: updateData.status ?? 'idle',
      lastError: updateData.lastError ?? null,
      lastSeenAt: updateData.lastSeenAt ?? now,
      createdAt: now,
      updatedAt: now,
    });
  }

  return getPlayerViewByPid(pId, db);
}
