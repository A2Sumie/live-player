import { desc, eq, sql } from 'drizzle-orm';
import { getDb, realtimeTextSegments, type RealtimeTextSegmentRow } from '@/lib/db';
import type { RealtimeTextClientConfig, RealtimeTextSegment, RealtimeTextSnapshot } from '@/lib/realtime-text';

type DbClient = ReturnType<typeof getDb>;

type RealtimeEventEnvelope = {
  event_type?: string;
  source?: string;
  stream_id?: string;
  sequence?: number;
  created_at?: string;
  payload?: Record<string, unknown>;
};

export type RealtimeTextTermRule = {
  from: string;
  to: string;
};

function nowIso() {
  return new Date().toISOString();
}

function toText(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toMs(value: unknown) {
  const numberValue = toNumber(value);
  return numberValue === null ? null : Math.max(0, Math.round(numberValue * 1000));
}

function toLatencyMs(payload: Record<string, unknown>) {
  return toMs(payload.asr_latency_seconds)
    ?? toMs(payload.latency_seconds)
    ?? toMs(payload.translation_latency_seconds);
}

function toJsonText(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function parseJsonText(value?: string | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function applyTermRules(text: string, terms: RealtimeTextTermRule[] = []) {
  let next = text;
  for (const term of terms) {
    if (!term.from) {
      continue;
    }
    next = next.split(term.from).join(term.to);
  }
  return next;
}

function rowToSegment(row: RealtimeTextSegmentRow): RealtimeTextSegment {
  return {
    id: row.segmentId,
    streamId: row.streamId,
    startMs: row.startMs,
    endMs: row.endMs,
    sourceText: row.sourceText,
    translatedText: row.translatedText,
    language: row.language,
    isFinal: row.isFinal,
    eventCreatedAt: row.eventCreatedAt,
    receivedAt: row.receivedAt,
    asrLatencyMs: row.asrLatencyMs,
    eventSequence: row.eventSequence,
    timelineMeta: parseJsonText(row.timelineMeta),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getRealtimeTextSnapshotFromStore(
  pId: string,
  config: RealtimeTextClientConfig,
  db: DbClient = getDb(),
): Promise<RealtimeTextSnapshot> {
  const rows = await db
    .select()
    .from(realtimeTextSegments)
    .where(eq(realtimeTextSegments.pId, pId))
    .orderBy(desc(realtimeTextSegments.updatedAt), desc(realtimeTextSegments.id))
    .limit(160);

  const newest = rows[0] ?? null;
  const activeStreamId = newest?.streamId || null;
  const activeRows = activeStreamId
    ? rows.filter((row) => row.streamId === activeStreamId)
    : rows;
  const chronological = [...activeRows].reverse();
  const partialRow = chronological.find((row) => !row.isFinal) ?? null;
  const finalRows = chronological.filter((row) => row.isFinal).slice(-40);

  return {
    pId,
    enabled: config.enabled,
    revision: newest ? `${newest.updatedAt}:${newest.id}` : null,
    generatedAt: nowIso(),
    config,
    partial: partialRow ? rowToSegment(partialRow) : null,
    segments: finalRows.map(rowToSegment),
  };
}

export async function ingestRealtimeTextEvent(
  pId: string,
  envelope: RealtimeEventEnvelope,
  options: { terms?: RealtimeTextTermRule[] } = {},
  db: DbClient = getDb(),
) {
  const eventType = String(envelope.event_type || '');
  const payload = envelope.payload && typeof envelope.payload === 'object' ? envelope.payload : {};
  const streamId = String(envelope.stream_id || payload.stream_id || pId);
  const createdAt = String(envelope.created_at || nowIso());
  const updatedAt = nowIso();
  const eventSequence = typeof envelope.sequence === 'number' && Number.isFinite(envelope.sequence)
    ? envelope.sequence
    : null;
  const timelineMeta = {
    eventCreatedAt: createdAt,
    receivedAt: updatedAt,
    asrLatencyMs: toLatencyMs(payload),
    eventSequence,
    timelineMeta: toJsonText(payload.timeline),
  };

  if (eventType === 'stream.started') {
    await db
      .delete(realtimeTextSegments)
      .where(eq(realtimeTextSegments.pId, pId));
    return { accepted: true, action: 'reset', streamId };
  }

  if (eventType === 'transcript.delta') {
    const delta = toText(payload.delta);
    if (!delta) {
      return { accepted: false, reason: 'empty delta' };
    }

    const segmentId = `${streamId}:partial`;
    const [existing] = await db
      .select()
      .from(realtimeTextSegments)
      .where(eq(realtimeTextSegments.segmentId, segmentId))
      .limit(1);
    const sourceText = applyTermRules(`${existing?.sourceText || ''}${delta}`, options.terms);
    const startMs = existing?.startMs ?? toMs(payload.audio_sent_seconds) ?? 0;
    const endMs = toMs(payload.audio_sent_seconds);

    if (existing) {
      await db
        .update(realtimeTextSegments)
        .set({ sourceText, endMs, updatedAt, ...timelineMeta })
        .where(eq(realtimeTextSegments.segmentId, segmentId));
    } else {
      await db.insert(realtimeTextSegments).values({
        pId,
        streamId,
        segmentId,
        startMs,
        endMs,
        sourceText,
        language: 'ja-JP',
        isFinal: false,
        ...timelineMeta,
        createdAt,
        updatedAt,
      });
    }

    return { accepted: true, action: 'partial', streamId, segmentId };
  }

  if (eventType === 'transcript.final') {
    const rawText = toText(payload.text);
    const text = rawText ? applyTermRules(rawText, options.terms) : null;
    if (!text) {
      return { accepted: false, reason: 'empty final text' };
    }

    const partialId = `${streamId}:partial`;
    const finalId = `${streamId}:final:${envelope.sequence || Date.now()}`;
    const [partial] = await db
      .select()
      .from(realtimeTextSegments)
      .where(eq(realtimeTextSegments.segmentId, partialId))
      .limit(1);

    if (partial) {
      await db
        .update(realtimeTextSegments)
        .set({
          segmentId: finalId,
          sourceText: text,
          endMs: toMs(payload.audio_sent_seconds) ?? partial.endMs,
          isFinal: true,
          ...timelineMeta,
          updatedAt,
        })
        .where(eq(realtimeTextSegments.id, partial.id));
    } else {
      await db.insert(realtimeTextSegments).values({
        pId,
        streamId,
        segmentId: finalId,
        startMs: 0,
        endMs: toMs(payload.audio_sent_seconds),
        sourceText: text,
        language: 'ja-JP',
        isFinal: true,
        ...timelineMeta,
        createdAt,
        updatedAt,
      });
    }

    return { accepted: true, action: 'final', streamId, segmentId: finalId };
  }

  if (eventType === 'transcript.segment') {
    const rawText = toText(payload.text);
    const text = rawText ? applyTermRules(rawText, options.terms) : null;
    if (!text) {
      return { accepted: false, reason: 'empty segment text' };
    }
    const translatedText = toText(payload.translated_text) ?? toText(payload.translatedText);
    const language = toText(payload.language) ?? 'ja-JP';
    const explicitSegmentId = toText(payload.segment_id) ?? toText(payload.segmentId);
    const segmentId = explicitSegmentId || `${streamId}:segment:${payload.start ?? envelope.sequence ?? Date.now()}`;
    await db.insert(realtimeTextSegments).values({
      pId,
      streamId,
      segmentId,
      startMs: toMs(payload.start) ?? 0,
      endMs: toMs(payload.end),
      sourceText: text,
      translatedText,
      language,
      isFinal: payload.final !== false,
      ...timelineMeta,
      createdAt,
      updatedAt,
    }).onConflictDoUpdate({
      target: realtimeTextSegments.segmentId,
      set: {
        sourceText: text,
        translatedText,
        endMs: toMs(payload.end),
        language,
        isFinal: payload.final !== false,
        ...timelineMeta,
        updatedAt,
      },
    });
    return { accepted: true, action: 'segment', streamId, segmentId };
  }

  if (eventType === 'translation.segment') {
    const translatedText = toText(payload.translated_text) ?? toText(payload.translatedText) ?? toText(payload.text);
    if (!translatedText) {
      return { accepted: false, reason: 'empty translation text' };
    }

    const explicitSegmentId = toText(payload.segment_id) ?? toText(payload.segmentId);
    const segmentId = explicitSegmentId || `${streamId}:segment:${payload.start ?? envelope.sequence ?? Date.now()}`;
    const [existing] = await db
      .select()
      .from(realtimeTextSegments)
      .where(eq(realtimeTextSegments.segmentId, segmentId))
      .limit(1);

    if (existing) {
      await db
        .update(realtimeTextSegments)
        .set({
          translatedText,
          updatedAt,
          receivedAt: timelineMeta.receivedAt,
          eventCreatedAt: timelineMeta.eventCreatedAt,
          eventSequence: timelineMeta.eventSequence,
          timelineMeta: timelineMeta.timelineMeta,
        })
        .where(eq(realtimeTextSegments.segmentId, segmentId));
    } else {
      await db.insert(realtimeTextSegments).values({
        pId,
        streamId,
        segmentId,
        startMs: toMs(payload.start) ?? 0,
        endMs: toMs(payload.end),
        sourceText: toText(payload.source_text) ?? toText(payload.sourceText),
        translatedText,
        language: toText(payload.language) ?? 'ja-JP',
        isFinal: true,
        ...timelineMeta,
        createdAt,
        updatedAt,
      });
    }

    return { accepted: true, action: 'translation', streamId, segmentId };
  }

  return { accepted: false, reason: `ignored event_type ${eventType || '(missing)'}` };
}

export async function pruneRealtimeTextSegments(pId: string, db: DbClient = getDb()) {
  await db.run(sql`
    delete from realtime_text_segments
    where p_id = ${pId}
      and id not in (
        select id from realtime_text_segments
        where p_id = ${pId}
        order by updated_at desc, id desc
        limit 120
      )
  `);
}
