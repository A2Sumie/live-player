export type RealtimeTextDisplayMode = 'subtitle' | 'transcript' | 'both';

export type RealtimeTextClientConfig = {
  enabled: boolean;
  mode: RealtimeTextDisplayMode;
  sourceLanguage: string;
  targetLanguage: string;
  subtitleOpacity: number;
  subtitleScale: number;
  transcriptPanel: boolean;
  showSource: boolean;
  showTranslation: boolean;
  showTiming: boolean;
  cursorMarkers: boolean;
  cursorIntervalSeconds: number;
  videoDelaySeconds: number;
};

export type RealtimeTextSegment = {
  id: string;
  streamId?: string | null;
  startMs: number;
  endMs?: number | null;
  sourceText?: string | null;
  translatedText?: string | null;
  language?: string | null;
  isFinal: boolean;
  eventCreatedAt?: string | null;
  receivedAt?: string | null;
  asrLatencyMs?: number | null;
  eventSequence?: number | null;
  timelineMeta?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type RealtimeTextSnapshot = {
  pId: string;
  enabled: boolean;
  revision: string | null;
  generatedAt: string;
  config: RealtimeTextClientConfig;
  partial: RealtimeTextSegment | null;
  segments: RealtimeTextSegment[];
};

type JsonObject = Record<string, unknown>;

const DEFAULT_CONFIG: RealtimeTextClientConfig = {
  enabled: false,
  mode: 'both',
  sourceLanguage: 'ja-JP',
  targetLanguage: 'zh-CN',
  subtitleOpacity: 0.78,
  subtitleScale: 1,
  transcriptPanel: false,
  showSource: true,
  showTranslation: true,
  showTiming: true,
  cursorMarkers: true,
  cursorIntervalSeconds: 10,
  videoDelaySeconds: 0,
};

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function stringOrFallback(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function parseJsonObject(value?: string | null): JsonObject | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseRealtimeTextConfig(config: unknown): RealtimeTextClientConfig {
  if (!isPlainObject(config)) {
    return DEFAULT_CONFIG;
  }

  const rawRealtime = config.realtimeText;
  const realtime = isPlainObject(rawRealtime) ? rawRealtime : null;
  if (!realtime) {
    return DEFAULT_CONFIG;
  }

  const mode = realtime.mode === 'subtitle' || realtime.mode === 'transcript' || realtime.mode === 'both'
    ? realtime.mode
    : DEFAULT_CONFIG.mode;

  return {
    enabled: realtime.enabled === true,
    mode,
    sourceLanguage: stringOrFallback(realtime.sourceLanguage, DEFAULT_CONFIG.sourceLanguage),
    targetLanguage: stringOrFallback(realtime.targetLanguage, DEFAULT_CONFIG.targetLanguage),
    subtitleOpacity: clampNumber(realtime.subtitleOpacity, DEFAULT_CONFIG.subtitleOpacity, 0.2, 1),
    subtitleScale: clampNumber(realtime.subtitleScale, DEFAULT_CONFIG.subtitleScale, 0.8, 1.5),
    transcriptPanel: realtime.transcriptPanel === true,
    showSource: realtime.showSource !== false,
    showTranslation: realtime.showTranslation !== false,
    showTiming: realtime.showTiming !== false,
    cursorMarkers: realtime.cursorMarkers !== false,
    cursorIntervalSeconds: Math.round(clampNumber(
      realtime.cursorIntervalSeconds,
      DEFAULT_CONFIG.cursorIntervalSeconds,
      5,
      60,
    )),
    videoDelaySeconds: Math.round(clampNumber(
      realtime.videoDelaySeconds ?? config.videoDelaySeconds,
      DEFAULT_CONFIG.videoDelaySeconds,
      0,
      30,
    )),
  };
}

export function getRealtimeTextConfigFromValues(
  editorialStreamConfig?: string | null,
  runtimeStreamConfig?: string | null,
): RealtimeTextClientConfig {
  const runtimeConfig = parseJsonObject(runtimeStreamConfig);
  const editorialConfig = parseJsonObject(editorialStreamConfig);
  const effectiveConfig = runtimeConfig ?? editorialConfig;
  return parseRealtimeTextConfig(effectiveConfig);
}

export function emptyRealtimeTextSnapshot(
  pId: string,
  config: RealtimeTextClientConfig,
): RealtimeTextSnapshot {
  return {
    pId,
    enabled: config.enabled,
    revision: null,
    generatedAt: new Date().toISOString(),
    config,
    partial: null,
    segments: [],
  };
}
