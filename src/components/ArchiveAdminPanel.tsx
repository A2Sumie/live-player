'use client';

import { FormEvent, MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ArchiveDetail,
  ArchiveFramesResponse,
  ArchiveListResponse,
  ArchiveSilenceResponse,
  ArchiveSummary,
  ArchiveUploadDefaults,
  ArchiveUploadResult,
} from '@/lib/archive-admin';

type UploadFormState = {
  title: string;
  description: string;
  sourceUrl: string;
  tags: string;
  cookieSourcePath: string;
  tid: string;
  threads: string;
  submitApi: string;
  line: string;
  copyright: string;
};

const EMPTY_FORM: UploadFormState = {
  title: '',
  description: '',
  sourceUrl: '',
  tags: '',
  cookieSourcePath: '',
  tid: '172',
  threads: '3',
  submitApi: 'web',
  line: 'AUTO',
  copyright: '2',
};

const EMPTY_FRAME_BATCH: ArchiveFramesResponse = {
  frames: [],
  frameRate: null,
  anchorTimeSeconds: null,
  keyFrameTimes: [],
  keyframeOnly: false,
  previousKeyframeTimeSeconds: null,
  nextKeyframeTimeSeconds: null,
};

const DEFAULT_UPLOAD_TITLE = 'N2NJ 直播存档';
const DEFAULT_UPLOAD_SOURCE = '自抓';
const DEFAULT_UPLOAD_TAGS = ['N2NJ', '秋元康', '偶像', 'LIVE', '日语现场', '音乐现场'];
const WAVEFORM_ZOOM_FACTORS = [0.01, 0.02, 0.05, 0.1, 0.125, 0.25, 0.5, 0.75, 1, 2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 160, 192, 256];
const WAVEFORM_AMPLITUDE_LEVELS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5];
const PREVIEW_ZOOM_LEVELS = [1, 1.5, 2, 3];
const KEYFRAME_LOOKAROUND_SECONDS = 8;
const KEYFRAME_TIMELINE_DETAIL_ZOOM_FACTOR = 24;
const WAVEFORM_BASE_PX_PER_SECOND = 1;
const WAVEFORM_MIN_RENDER_WIDTH = 120;
const WAVEFORM_MAX_RENDER_WIDTH = 262144;
const WAVEFORM_MAX_DISPLAY_WIDTH = 1200000;
const DEFAULT_WAVEFORM_ABSOLUTE_ZOOM = 0.25;
const DEFAULT_WAVEFORM_ZOOM_FACTOR_INDEX = Math.max(0, WAVEFORM_ZOOM_FACTORS.findIndex((value) => value === 1));
const DEFAULT_WAVEFORM_AMPLITUDE_INDEX = Math.max(0, WAVEFORM_AMPLITUDE_LEVELS.findIndex((value) => value === 1));
const SILENCE_ZOOM_PADDING_SECONDS = 60;
const SILENCE_FIT_BASELINE_RATIO = 0.9;
const TIMELINE_MAJOR_TICK_TARGET_PX = 120;
const TIMELINE_MINOR_TICK_TARGET_PX = 24;
type WaveformFocusWindow = {
  startSeconds: number;
  endSeconds: number;
  windowSeconds: number;
};
type FilePickerLike = {
  createWritable: () => Promise<{
    write: (data: Blob | BufferSource) => Promise<void>;
    close: () => Promise<void>;
  }>;
};

type WindowWithFilePicker = Window & typeof globalThis & {
  showSaveFilePicker?: (options?: { suggestedName?: string }) => Promise<FilePickerLike>;
};

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return '未知';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatDuration(value?: number | null) {
  if (!Number.isFinite(value || NaN) || !value || value <= 0) {
    return '未知';
  }
  const total = Math.max(0, Math.floor(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatFrameRate(value?: number | null) {
  if (!value || !Number.isFinite(value) || value <= 0) {
    return '未知';
  }
  return `${value.toFixed(value >= 50 ? 0 : 2)} fps`;
}

function formatCategoryPath(rootLabel?: string | null, category?: string | null) {
  const normalizedRoot = String(rootLabel || '').trim();
  const normalizedCategory = String(category || '').trim();
  if (normalizedRoot && normalizedCategory) {
    return normalizedRoot === normalizedCategory
      ? normalizedRoot
      : `${normalizedRoot} / ${normalizedCategory}`;
  }
  return normalizedRoot || normalizedCategory || '未知';
}

function formatTimelineTick(timeSeconds: number) {
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
    return '0:00';
  }
  const normalized = Math.max(0, timeSeconds);
  const totalWholeSeconds = Math.floor(normalized);
  const hours = Math.floor(totalWholeSeconds / 3600);
  const minutes = Math.floor((totalWholeSeconds % 3600) / 60);
  const secondsWhole = totalWholeSeconds % 60;
  const fractional = normalized - totalWholeSeconds;
  const secondsLabel = fractional > 0.0001
    ? (secondsWhole + fractional).toFixed(normalized < 60 ? 2 : 1).padStart(normalized < 60 ? 5 : 4, '0')
    : String(secondsWhole).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${secondsLabel}`;
  }
  return `${minutes}:${secondsLabel}`;
}

function formatSecondsDensity(secondsPerPixel: number) {
  if (!Number.isFinite(secondsPerPixel) || secondsPerPixel <= 0) {
    return '未知';
  }
  if (secondsPerPixel >= 60) {
    return `${(secondsPerPixel / 60).toFixed(secondsPerPixel >= 600 ? 0 : 1)} 分/px`;
  }
  if (secondsPerPixel >= 1) {
    return `${secondsPerPixel.toFixed(secondsPerPixel >= 10 ? 1 : 2)} 秒/px`;
  }
  return `${(secondsPerPixel * 1000).toFixed(secondsPerPixel >= 0.1 ? 0 : 1)} ms/px`;
}

function resolveWaveformWidth(
  durationSeconds?: number | null,
  zoom = 1,
  maxWidth = WAVEFORM_MAX_RENDER_WIDTH,
) {
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return WAVEFORM_MIN_RENDER_WIDTH;
  }
  const normalizedZoom = Math.max(0.01, zoom);
  const rawWidth = Math.round(durationSeconds * WAVEFORM_BASE_PX_PER_SECOND * normalizedZoom);
  return Math.max(WAVEFORM_MIN_RENDER_WIDTH, Math.min(maxWidth, rawWidth));
}

function pickTimelineTickStep(durationSeconds: number, widthPx: number, targetPx: number) {
  const rawStep = durationSeconds / Math.max(1, widthPx / Math.max(1, targetPx));
  const candidates = [
    0.25, 0.5,
    1, 2, 5, 10, 15, 20, 30,
    60, 90, 120, 180, 300, 600, 900, 1200, 1800, 2400, 3600, 5400, 7200, 10800, 14400, 21600,
  ];
  return candidates.find((candidate) => candidate >= rawStep) || 3600;
}

function buildTimelineTicks(durationSeconds: number, step: number) {
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return [0];
  }
  const ticks: number[] = [];
  for (let current = 0; current < durationSeconds; current += step) {
    ticks.push(Number(current.toFixed(6)));
  }
  if (ticks[ticks.length - 1] !== durationSeconds) {
    ticks.push(durationSeconds);
  }
  return ticks;
}

function buildTimelineScale(durationSeconds?: number | null, widthPx = WAVEFORM_MIN_RENDER_WIDTH) {
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return {
      majorTicks: [0],
      minorTicks: [] as number[],
      majorStep: 0,
      minorStep: 0,
    };
  }
  const majorStep = pickTimelineTickStep(durationSeconds, widthPx, TIMELINE_MAJOR_TICK_TARGET_PX);
  const minorStep = pickTimelineTickStep(durationSeconds, widthPx, TIMELINE_MINOR_TICK_TARGET_PX);
  const majorTicks = buildTimelineTicks(durationSeconds, majorStep);
  const majorSet = new Set(majorTicks.map((value) => Number(value.toFixed(6))));
  const minorTicks = minorStep >= majorStep
    ? []
    : buildTimelineTicks(durationSeconds, minorStep).filter(
      (value) => !majorSet.has(Number(value.toFixed(6)))
    );
  return {
    majorTicks,
    minorTicks,
    majorStep,
    minorStep,
  };
}

function parseErrorMessage(payload: unknown, fallback: string) {
  if (typeof payload === 'string' && payload.trim()) {
    return payload;
  }
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === 'string' && error.trim()) {
      return error;
    }
  }
  return fallback;
}

async function readErrorPayload(response: Response) {
  const rawText = await response.text().catch(() => '');
  if (!rawText) {
    return null;
  }

  try {
    return JSON.parse(rawText);
  } catch {
    return rawText;
  }
}

async function fetchArchiveSilenceAnalysis(archiveId: string) {
  const response = await fetch(
    `/api/admin/archives/${encodeURIComponent(archiveId)}/silence`,
    { cache: 'no-store' }
  );
  if (!response.ok) {
    const errorPayload = await readErrorPayload(response);
    throw new Error(parseErrorMessage(errorPayload, '静音分析失败'));
  }
  return (await response.json()) as ArchiveSilenceResponse;
}

function sanitizePositiveNumber(value: string) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function parseContentDispositionFileName(value: string | null, fallback: string) {
  if (!value) {
    return fallback;
  }

  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const plainMatch = value.match(/filename="?([^"]+)"?/i);
  return plainMatch?.[1] || fallback;
}

function parseTotalBytesFromResponse(response: Response, fallback: number) {
  const contentRange = response.headers.get('content-range');
  if (contentRange) {
    const totalMatch = contentRange.match(/\/(\d+)$/);
    if (totalMatch?.[1]) {
      const parsed = Number(totalMatch[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const parsed = Number(contentLength);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return fallback;
}

function clampTimeSeconds(value: number, durationSeconds?: number | null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return Math.max(0, numeric);
  }
  return Math.max(0, Math.min(durationSeconds, numeric));
}

function resolveClipEndTimeSeconds(durationSeconds?: number | null, trimEndSeconds?: number | null) {
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return null;
  }
  return clampTimeSeconds(durationSeconds - Math.max(0, Number(trimEndSeconds) || 0), durationSeconds);
}

function resolveRetainedTailSilenceSeconds(
  durationSeconds?: number | null,
  trimEndSeconds?: number | null,
  tailSilenceStartSeconds?: number | null,
) {
  if (
    tailSilenceStartSeconds === null
    || tailSilenceStartSeconds === undefined
    || !Number.isFinite(tailSilenceStartSeconds)
  ) {
    return null;
  }
  const clipEndSeconds = resolveClipEndTimeSeconds(durationSeconds, trimEndSeconds);
  if (clipEndSeconds === null) {
    return null;
  }
  return Math.max(0, clipEndSeconds - clampTimeSeconds(tailSilenceStartSeconds, durationSeconds));
}

function toFieldNumberString(value: number) {
  return Number(value.toFixed(3)).toString();
}

function describeTrimStrategy(uploadResult: ArchiveUploadResult) {
  if (uploadResult.trimStrategy === 'passthrough') {
    return '未裁切，直接上传原片';
  }
  if (uploadResult.trimStrategy === 'reencode_fallback') {
    return '关键帧吸附后流拷贝异常，已退回重编码';
  }
  return '已按关键帧吸附后流拷贝';
}

function timeToDisplayPx(
  timeSeconds: number | null,
  durationSeconds: number | null | undefined,
  displayWidth: number,
) {
  if (
    timeSeconds === null
    || !durationSeconds
    || !Number.isFinite(durationSeconds)
    || durationSeconds <= 0
  ) {
    return 0;
  }
  return Math.max(0, Math.min(displayWidth, (timeSeconds / durationSeconds) * displayWidth));
}

function clampScrollLeft(scrollLeft: number, displayWidth: number, viewportWidth: number) {
  if (!Number.isFinite(scrollLeft)) {
    return 0;
  }
  const maxScrollLeft = Math.max(0, displayWidth - Math.max(0, viewportWidth));
  return Math.max(0, Math.min(maxScrollLeft, scrollLeft));
}

function pickClosestFrameTime(
  frames: ArchiveFramesResponse['frames'],
  targetTimeSeconds: number | null,
) {
  if (frames.length === 0) {
    return null;
  }
  if (targetTimeSeconds === null || !Number.isFinite(targetTimeSeconds)) {
    return frames[Math.floor(frames.length / 2)]?.timeSeconds ?? null;
  }

  let best = frames[0];
  let bestDistance = Math.abs(frames[0].timeSeconds - targetTimeSeconds);
  for (const frame of frames.slice(1)) {
    const distance = Math.abs(frame.timeSeconds - targetTimeSeconds);
    if (distance < bestDistance) {
      best = frame;
      bestDistance = distance;
    }
  }
  return best.timeSeconds;
}

function pickAdjacentWaveformZoom(currentZoom: number, direction: -1 | 1) {
  if (!Number.isFinite(currentZoom) || currentZoom <= 0) {
    return WAVEFORM_ZOOM_FACTORS[DEFAULT_WAVEFORM_ZOOM_FACTOR_INDEX];
  }
  if (direction < 0) {
    for (let index = WAVEFORM_ZOOM_FACTORS.length - 1; index >= 0; index -= 1) {
      if (WAVEFORM_ZOOM_FACTORS[index] < currentZoom - 1e-9) {
        return WAVEFORM_ZOOM_FACTORS[index];
      }
    }
    return WAVEFORM_ZOOM_FACTORS[0];
  }
  for (const candidate of WAVEFORM_ZOOM_FACTORS) {
    if (candidate > currentZoom + 1e-9) {
      return candidate;
    }
  }
  return WAVEFORM_ZOOM_FACTORS[WAVEFORM_ZOOM_FACTORS.length - 1];
}

function buildSilenceFocusWindow(
  durationSeconds?: number | null,
  silenceAnalysis?: ArchiveSilenceResponse | null,
): WaveformFocusWindow | null {
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return null;
  }
  const minimumWindowSeconds = Math.min(durationSeconds, 60);
  const headAnchorSeconds = silenceAnalysis?.headSilenceEndSeconds ?? 0;
  const tailAnchorSeconds = silenceAnalysis?.tailSilenceStartSeconds ?? durationSeconds;
  const startSeconds = clampTimeSeconds(
    headAnchorSeconds - SILENCE_ZOOM_PADDING_SECONDS,
    durationSeconds,
  );
  const endSeconds = clampTimeSeconds(
    tailAnchorSeconds + SILENCE_ZOOM_PADDING_SECONDS,
    durationSeconds,
  );
  return {
    startSeconds,
    endSeconds,
    windowSeconds: Math.max(minimumWindowSeconds, endSeconds - startSeconds),
  };
}

function buildUploadForm(detail: ArchiveDetail, defaults: ArchiveUploadDefaults | null): UploadFormState {
  const suggested = detail.suggestedUpload;
  const fallbackTags = defaults?.tags?.length ? defaults.tags : DEFAULT_UPLOAD_TAGS;
  return {
    title: suggested.title || DEFAULT_UPLOAD_TITLE,
    description: suggested.description || '',
    sourceUrl: suggested.sourceUrl || DEFAULT_UPLOAD_SOURCE,
    tags: (suggested.tags?.length ? suggested.tags : fallbackTags).join(', '),
    cookieSourcePath: suggested.cookieSourcePath || defaults?.cookieSourcePath || '',
    tid: String(suggested.tid || defaults?.tid || 172),
    threads: String(suggested.threads || defaults?.threads || 3),
    submitApi: suggested.submitApi || defaults?.submitApi || 'web',
    line: suggested.line || defaults?.line || 'AUTO',
    copyright: String(suggested.copyright || defaults?.copyright || 2),
  };
}

function markerClassName(tone: 'sky' | 'emerald' | 'amber' | 'rose' | 'cyan' | 'orange' | 'lime') {
  switch (tone) {
    case 'emerald':
      return 'bg-emerald-500';
    case 'amber':
      return 'bg-amber-500';
    case 'rose':
      return 'bg-rose-500';
    case 'cyan':
      return 'bg-cyan-400';
    case 'orange':
      return 'bg-orange-400';
    case 'lime':
      return 'bg-lime-400';
    default:
      return 'bg-sky-500';
  }
}

function SectionToggle({
  expanded,
  title,
  subtitle,
  onToggle,
}: {
  expanded: boolean;
  title: string;
  subtitle?: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white/88 px-4 py-3 text-left transition hover:bg-white"
    >
      <div>
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        {subtitle && <div className="mt-1 text-xs text-slate-500">{subtitle}</div>}
      </div>
      <span className="text-xs font-medium text-slate-500">{expanded ? '收起' : '展开'}</span>
    </button>
  );
}

export default function ArchiveAdminPanel() {
  const waveformScrollRef = useRef<HTMLDivElement | null>(null);
  const pendingWaveformScrollLeft = useRef<number | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [archives, setArchives] = useState<ArchiveSummary[]>([]);
  const [defaults, setDefaults] = useState<ArchiveUploadDefaults | null>(null);
  const [selectedArchiveId, setSelectedArchiveId] = useState('');
  const [detail, setDetail] = useState<ArchiveDetail | null>(null);
  const [frameBatch, setFrameBatch] = useState<ArchiveFramesResponse>(EMPTY_FRAME_BATCH);
  const [silenceAnalysis, setSilenceAnalysis] = useState<ArchiveSilenceResponse | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingFrames, setLoadingFrames] = useState(false);
  const [loadingSilence, setLoadingSilence] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloadingOriginal, setDownloadingOriginal] = useState(false);
  const [downloadingTrimmed, setDownloadingTrimmed] = useState(false);
  const [listError, setListError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [frameError, setFrameError] = useState('');
  const [silenceError, setSilenceError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploadResult, setUploadResult] = useState<ArchiveUploadResult | null>(null);
  const [uploadForm, setUploadForm] = useState<UploadFormState>(EMPTY_FORM);
  const [trimStartSeconds, setTrimStartSeconds] = useState('0');
  const [trimEndSeconds, setTrimEndSeconds] = useState('0');
  const [coverTimeSeconds, setCoverTimeSeconds] = useState('');
  const [waveformVersion, setWaveformVersion] = useState(0);
  const [cursorTimeSeconds, setCursorTimeSeconds] = useState<number | null>(null);
  const [selectedFrameTimeSeconds, setSelectedFrameTimeSeconds] = useState<number | null>(null);
  const [waveformZoomFactorIndex, setWaveformZoomFactorIndex] = useState(DEFAULT_WAVEFORM_ZOOM_FACTOR_INDEX);
  const [waveformAmplitudeIndex, setWaveformAmplitudeIndex] = useState(DEFAULT_WAVEFORM_AMPLITUDE_INDEX);
  const [waveformViewSnapshot, setWaveformViewSnapshot] = useState<{ zoomFactorIndex: number; scrollLeft: number } | null>(null);
  const [waveformDefaultFitKey, setWaveformDefaultFitKey] = useState('');
  const [waveformViewportWidth, setWaveformViewportWidth] = useState(0);
  const [waveformScrollRequestId, setWaveformScrollRequestId] = useState(0);
  const [waveformLoading, setWaveformLoading] = useState(false);
  const [previewZoomIndex, setPreviewZoomIndex] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [editorExpanded, setEditorExpanded] = useState(false);
  const [detailMetaExpanded, setDetailMetaExpanded] = useState(false);
  const [advancedUploadExpanded, setAdvancedUploadExpanded] = useState(false);
  const [copiedField, setCopiedField] = useState('');
  const [downloadProgress, setDownloadProgress] = useState<{ loaded: number; total: number } | null>(null);

  const selectedArchive = useMemo(
    () => archives.find((entry) => entry.id === selectedArchiveId) || null,
    [archives, selectedArchiveId]
  );

  const waveformZoom = WAVEFORM_ZOOM_FACTORS[waveformZoomFactorIndex] || 1;
  const waveformAmplitudeScale = WAVEFORM_AMPLITUDE_LEVELS[waveformAmplitudeIndex] || 1;
  const previewZoom = PREVIEW_ZOOM_LEVELS[previewZoomIndex] || 1;
  const silenceFocusWindow = useMemo(
    () => buildSilenceFocusWindow(detail?.durationSeconds ?? null, silenceAnalysis),
    [detail?.durationSeconds, silenceAnalysis]
  );
  const waveformBaseZoom = useMemo(() => {
    if (!detail?.durationSeconds) {
      return DEFAULT_WAVEFORM_ABSOLUTE_ZOOM;
    }
    if (!silenceFocusWindow) {
      return DEFAULT_WAVEFORM_ABSOLUTE_ZOOM;
    }
    if (!Number.isFinite(waveformViewportWidth) || waveformViewportWidth <= 0) {
      return DEFAULT_WAVEFORM_ABSOLUTE_ZOOM;
    }
    const baselineWindowSeconds = silenceFocusWindow.windowSeconds;
    return Math.max(
      0.0001,
      (waveformViewportWidth * SILENCE_FIT_BASELINE_RATIO) / Math.max(1, baselineWindowSeconds * WAVEFORM_BASE_PX_PER_SECOND),
    );
  }, [detail?.durationSeconds, silenceFocusWindow, waveformViewportWidth]);
  const effectiveWaveformZoom = waveformBaseZoom * waveformZoom;
  const waveformBaseDisplayWidth = useMemo(
    () => resolveWaveformWidth(detail?.durationSeconds ?? null, waveformBaseZoom, WAVEFORM_MAX_DISPLAY_WIDTH),
    [detail?.durationSeconds, waveformBaseZoom]
  );
  const waveformRenderWidth = useMemo(
    () => resolveWaveformWidth(detail?.durationSeconds ?? null, effectiveWaveformZoom, WAVEFORM_MAX_RENDER_WIDTH),
    [detail?.durationSeconds, effectiveWaveformZoom]
  );
  const waveformDisplayWidth = useMemo(
    () => resolveWaveformWidth(detail?.durationSeconds ?? null, effectiveWaveformZoom, WAVEFORM_MAX_DISPLAY_WIDTH),
    [detail?.durationSeconds, effectiveWaveformZoom]
  );

  const waveformUrl = selectedArchiveId
    ? `/api/admin/archives/${encodeURIComponent(selectedArchiveId)}/waveform?v=${waveformVersion}&zoom=${effectiveWaveformZoom}&width=${waveformRenderWidth}&amplitudeScale=${waveformAmplitudeScale}`
    : '';

  const currentFrameRate = detail?.frameRate || frameBatch.frameRate || null;
  const showTimelineKeyframeDetail = waveformZoom >= KEYFRAME_TIMELINE_DETAIL_ZOOM_FACTOR;
  const selectedFrame = useMemo(() => {
    if (frameBatch.frames.length === 0) {
      return null;
    }
    const selectedTime = pickClosestFrameTime(frameBatch.frames, selectedFrameTimeSeconds);
    return frameBatch.frames.find((frame) => frame.timeSeconds === selectedTime) || frameBatch.frames[0] || null;
  }, [frameBatch.frames, selectedFrameTimeSeconds]);

  const trimStartValue = sanitizePositiveNumber(trimStartSeconds);
  const trimEndValue = sanitizePositiveNumber(trimEndSeconds);
  const coverTimeValue = coverTimeSeconds === '' ? null : sanitizePositiveNumber(coverTimeSeconds);
  const hasActiveTrim = trimStartValue > 0 || trimEndValue > 0;
  const trimEndMarkerTime = resolveClipEndTimeSeconds(detail?.durationSeconds, trimEndValue);
  const retainedTailSilenceValue = resolveRetainedTailSilenceSeconds(
    detail?.durationSeconds,
    trimEndValue,
    silenceAnalysis?.tailSilenceStartSeconds ?? null,
  );
  const hasSilenceTrimSuggestion = Boolean(
    detail?.durationSeconds
    && (
      typeof silenceAnalysis?.headSilenceEndSeconds === 'number'
      || typeof silenceAnalysis?.tailSilenceStartSeconds === 'number'
    )
  );
  const hasSilenceOffsetTrimSuggestion = Boolean(
    detail?.durationSeconds
    && (
      typeof silenceAnalysis?.headJumpTimeSeconds === 'number'
      || typeof silenceAnalysis?.tailJumpTimeSeconds === 'number'
    )
  );
  const effectiveCursorTime = cursorTimeSeconds
    ?? coverTimeValue
    ?? (detail?.durationSeconds ? detail.durationSeconds / 2 : null);
  const appliedRetainedTailSilenceValue = uploadResult
    ? resolveRetainedTailSilenceSeconds(
      detail?.durationSeconds,
      uploadResult.appliedTrimEndSeconds,
      silenceAnalysis?.tailSilenceStartSeconds ?? null,
    )
    : null;
  const previousKeyframeAtCursor = frameBatch.previousKeyframeTimeSeconds;
  const nextKeyframeAtCursor = frameBatch.nextKeyframeTimeSeconds;
  const keyframeCandidates = useMemo(() => {
    const lookup = new Map(frameBatch.frames.map((frame) => [frame.timeSeconds, frame]));
    const candidates: Array<ArchiveFramesResponse['frames'][number] & { label: string }> = [];
    const pushCandidate = (timeSeconds: number | null, label: string) => {
      if (timeSeconds === null) {
        return;
      }
      const frame = lookup.get(timeSeconds);
      if (!frame) {
        return;
      }
      if (candidates.some((candidate) => candidate.timeSeconds === frame.timeSeconds)) {
        return;
      }
      candidates.push({ ...frame, label });
    };

    if (
      previousKeyframeAtCursor !== null
      && nextKeyframeAtCursor !== null
      && previousKeyframeAtCursor === nextKeyframeAtCursor
    ) {
      pushCandidate(previousKeyframeAtCursor, '命中关键帧');
      return candidates;
    }

    pushCandidate(previousKeyframeAtCursor, '前关键帧');
    pushCandidate(nextKeyframeAtCursor, '后关键帧');

    if (candidates.length === 0) {
      return frameBatch.frames.map((frame, index) => ({
        ...frame,
        label: index === 0 ? '关键帧候选' : `关键帧候选 ${index + 1}`,
      }));
    }
    return candidates;
  }, [frameBatch.frames, nextKeyframeAtCursor, previousKeyframeAtCursor]);
  const timelineScale = useMemo(
    () => buildTimelineScale(detail?.durationSeconds ?? null, waveformDisplayWidth),
    [detail?.durationSeconds, waveformDisplayWidth]
  );
  const secondsPerDisplayPixel = useMemo(() => {
    if (!detail?.durationSeconds || waveformDisplayWidth <= 0) {
      return null;
    }
    return detail.durationSeconds / waveformDisplayWidth;
  }, [detail?.durationSeconds, waveformDisplayWidth]);
  const downloadLabel = useMemo(() => {
    if (!downloadingOriginal) {
      return '下载到本地';
    }
    if (downloadProgress && downloadProgress.total > 0) {
      const percent = Math.min(100, Math.round((downloadProgress.loaded / downloadProgress.total) * 100));
      return `下载中 ${percent}%`;
    }
    return '下载中...';
  }, [downloadProgress, downloadingOriginal]);
  const trimmedDownloadLabel = useMemo(() => {
    if (!downloadingTrimmed) {
      return '下载裁切后视频';
    }
    if (downloadProgress && downloadProgress.total > 0) {
      const percent = Math.min(100, Math.round((downloadProgress.loaded / downloadProgress.total) * 100));
      return `下载中 ${percent}%`;
    }
    return '下载中...';
  }, [downloadProgress, downloadingTrimmed]);

  const fetchArchives = async (query = searchInput) => {
    setLoadingList(true);
    setListError('');
    try {
      const params = new URLSearchParams();
      if (query.trim()) {
        params.set('q', query.trim());
      }
      params.set('limit', '120');
      const response = await fetch(`/api/admin/archives?${params.toString()}`);
      if (!response.ok) {
        const errorPayload = await readErrorPayload(response);
        throw new Error(parseErrorMessage(errorPayload, '加载存档失败'));
      }

      const payload = (await response.json()) as ArchiveListResponse;
      setArchives(payload.items);
      setDefaults(payload.defaults);
      setSelectedArchiveId((current) => {
        if (payload.items.some((item) => item.id === current)) {
          return current;
        }
        return payload.items[0]?.id || '';
      });
    } catch (error) {
      setListError(error instanceof Error ? error.message : '加载存档失败');
      setArchives([]);
      setSelectedArchiveId('');
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    fetchArchives('');
  }, []);

  useEffect(() => {
    if (!selectedArchiveId) {
      setDetail(null);
      setFrameBatch(EMPTY_FRAME_BATCH);
      setSilenceAnalysis(null);
      setLoadingSilence(false);
      setUploadForm(EMPTY_FORM);
      setCursorTimeSeconds(null);
      setSelectedFrameTimeSeconds(null);
      setEditorExpanded(false);
      setDetailMetaExpanded(false);
      setAdvancedUploadExpanded(false);
      setWaveformZoomFactorIndex(DEFAULT_WAVEFORM_ZOOM_FACTOR_INDEX);
      setWaveformAmplitudeIndex(DEFAULT_WAVEFORM_AMPLITUDE_INDEX);
      setWaveformViewSnapshot(null);
      setWaveformDefaultFitKey('');
      setWaveformViewportWidth(0);
      pendingWaveformScrollLeft.current = null;
      if (waveformScrollRef.current) {
        waveformScrollRef.current.scrollLeft = 0;
      }
      setSilenceError('');
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const loadDetail = async () => {
      setLoadingDetail(true);
      setDetailError('');
      setFrameError('');
      setSilenceError('');
      setUploadError('');
      setUploadResult(null);
      try {
        const response = await fetch(`/api/admin/archives/${encodeURIComponent(selectedArchiveId)}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) {
          const errorPayload = await readErrorPayload(response);
          throw new Error(parseErrorMessage(errorPayload, '读取存档详情失败'));
        }

        const payload = (await response.json()) as ArchiveDetail;
        if (cancelled) {
          return;
        }

        setDetail(payload);
        setTrimStartSeconds('0');
        setTrimEndSeconds('0');
        setCoverTimeSeconds('');
        setWaveformVersion((value) => value + 1);
        setUploadForm(buildUploadForm(payload, defaults));
        setWaveformZoomFactorIndex(DEFAULT_WAVEFORM_ZOOM_FACTOR_INDEX);
        setWaveformAmplitudeIndex(DEFAULT_WAVEFORM_AMPLITUDE_INDEX);
        setWaveformViewSnapshot(null);
        setWaveformDefaultFitKey('');
        setWaveformViewportWidth(0);
        pendingWaveformScrollLeft.current = 0;
        setPreviewZoomIndex(0);
        setCursorTimeSeconds(payload.durationSeconds ? payload.durationSeconds / 2 : 0);
        setSelectedFrameTimeSeconds(null);
        setFrameBatch({
          ...EMPTY_FRAME_BATCH,
          frameRate: payload.frameRate || null,
        });
        setSilenceAnalysis(null);
        setLoadingSilence(false);
        setEditorExpanded(false);
        setDetailMetaExpanded(false);
        setAdvancedUploadExpanded(false);
        setCopiedField('');
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        if (!cancelled) {
          setDetail(null);
          setFrameBatch(EMPTY_FRAME_BATCH);
          setSilenceAnalysis(null);
          setLoadingSilence(false);
          setDetailError(error instanceof Error ? error.message : '读取存档详情失败');
        }
      } finally {
        if (!cancelled) {
          setLoadingDetail(false);
        }
      }
    };

    loadDetail();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedArchiveId, defaults]);

  useEffect(() => {
    if (pendingWaveformScrollLeft.current === null || !waveformScrollRef.current) {
      return;
    }
    const desiredScrollLeft = pendingWaveformScrollLeft.current;
    const applyScroll = () => {
      if (!waveformScrollRef.current) {
        return;
      }
      waveformScrollRef.current.scrollLeft = desiredScrollLeft;
    };
    applyScroll();
    if (typeof window === 'undefined') {
      pendingWaveformScrollLeft.current = null;
      return;
    }
    const rafId = window.requestAnimationFrame(() => {
      applyScroll();
      pendingWaveformScrollLeft.current = null;
    });
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [waveformDisplayWidth, selectedArchiveId, waveformScrollRequestId]);

  useEffect(() => {
    setWaveformLoading(Boolean(waveformUrl));
  }, [waveformUrl]);

  useEffect(() => {
    if (!editorExpanded || !waveformScrollRef.current) {
      setWaveformViewportWidth(0);
      return;
    }
    const target = waveformScrollRef.current;
    const updateViewportWidth = () => {
      setWaveformViewportWidth(target.clientWidth || 0);
    };
    updateViewportWidth();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      updateViewportWidth();
    });
    observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, [editorExpanded, selectedArchiveId]);

  const loadFrames = async ({
    params,
    desiredSelectionTime,
    desiredCursorTime,
    preserveSelection = false,
  }: {
    params: URLSearchParams;
    desiredSelectionTime?: number | null;
    desiredCursorTime?: number | null;
    preserveSelection?: boolean;
  }) => {
    if (!selectedArchiveId) {
      return;
    }

    setLoadingFrames(true);
    setFrameError('');
    try {
      const response = await fetch(
        `/api/admin/archives/${encodeURIComponent(selectedArchiveId)}/frames?${params.toString()}`
      );
      if (!response.ok) {
        const errorPayload = await readErrorPayload(response);
        throw new Error(parseErrorMessage(errorPayload, '生成预览帧失败'));
      }

      const payload = (await response.json()) as ArchiveFramesResponse;
      setFrameBatch(payload);
      const nextCursor = desiredCursorTime ?? payload.anchorTimeSeconds ?? cursorTimeSeconds ?? null;
      setCursorTimeSeconds(nextCursor);

      const candidateSelection = preserveSelection
        ? selectedFrameTimeSeconds
        : desiredSelectionTime ?? nextCursor ?? payload.anchorTimeSeconds ?? null;
      setSelectedFrameTimeSeconds(pickClosestFrameTime(payload.frames, candidateSelection));
    } catch (error) {
      setFrameError(error instanceof Error ? error.message : '生成预览帧失败');
    } finally {
      setLoadingFrames(false);
    }
  };

  const loadKeyframeCandidates = async (anchorTimeSeconds: number) => {
    if (!detail) {
      return;
    }
    const clampedAnchor = clampTimeSeconds(anchorTimeSeconds, detail.durationSeconds);
    const params = new URLSearchParams({
      anchorTimeSeconds: String(clampedAnchor),
      keyframeOnly: '1',
      includeKeyframes: '1',
      keyframeRangeStartSeconds: String(Math.max(0, clampedAnchor - KEYFRAME_LOOKAROUND_SECONDS)),
      keyframeRangeEndSeconds: String(
        Math.min(detail.durationSeconds || clampedAnchor, clampedAnchor + KEYFRAME_LOOKAROUND_SECONDS)
      ),
    });

    setCursorTimeSeconds(clampedAnchor);
    await loadFrames({
      params,
      desiredSelectionTime: clampedAnchor,
      desiredCursorTime: clampedAnchor,
    });
  };

  const loadSilenceAnalysis = async () => {
    if (!selectedArchiveId) {
      return;
    }
    setLoadingSilence(true);
    setSilenceError('');
    try {
      setSilenceAnalysis(await fetchArchiveSilenceAnalysis(selectedArchiveId));
    } catch (error) {
      setSilenceError(error instanceof Error ? error.message : '静音分析失败');
    } finally {
      setLoadingSilence(false);
    }
  };

  useEffect(() => {
    if (!editorExpanded || !selectedArchiveId || silenceAnalysis) {
      return;
    }
    let cancelled = false;
    const run = async () => {
      setLoadingSilence(true);
      setSilenceError('');
      try {
        const payload = await fetchArchiveSilenceAnalysis(selectedArchiveId);
        if (!cancelled) {
          setSilenceAnalysis(payload);
        }
      } catch (error) {
        if (!cancelled) {
          setSilenceError(error instanceof Error ? error.message : '静音分析失败');
        }
      } finally {
        if (!cancelled) {
          setLoadingSilence(false);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [editorExpanded, selectedArchiveId, silenceAnalysis]);

  const handleSearch = async (event: FormEvent) => {
    event.preventDefault();
    await fetchArchives(searchInput);
  };

  const handleRefresh = async () => {
    await fetchArchives(searchInput);
  };

  const handleArchiveDownload = async (
    target: ArchiveDetail,
    options: { trimmed?: boolean } = {}
  ) => {
    const { trimmed = false } = options;
    setDetailError('');
    if (trimmed) {
      setDownloadingTrimmed(true);
    } else {
      setDownloadingOriginal(true);
    }
    setDownloadProgress({ loaded: 0, total: Math.max(0, target.sizeBytes || 0) });

    try {
      const params = new URLSearchParams();
      if (trimmed) {
        params.set('trimStartSeconds', String(trimStartValue));
        params.set('trimEndSeconds', String(trimEndValue));
      }
      const directUrl = `/api/admin/archives/${encodeURIComponent(target.id)}/download${params.toString() ? `?${params.toString()}` : ''}`;
      const anchor = document.createElement('a');
      anchor.href = directUrl;
      anchor.rel = 'noopener noreferrer';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setDownloadProgress({
        loaded: Math.max(0, target.sizeBytes || 0),
        total: Math.max(0, target.sizeBytes || 0),
      });
    } finally {
      if (trimmed) {
        setDownloadingTrimmed(false);
      } else {
        setDownloadingOriginal(false);
      }
      setDownloadProgress(null);
    }
  };

  const buildSilenceFitWaveformView = () => {
    if (!detail?.durationSeconds || !silenceFocusWindow || !waveformScrollRef.current) {
      return null;
    }
    if (!Number.isFinite(waveformViewportWidth) || waveformViewportWidth <= 0) {
      return null;
    }
    const silenceCenterSeconds = (() => {
      const headEdgeSeconds = silenceAnalysis?.headSilenceEndSeconds;
      const tailEdgeSeconds = silenceAnalysis?.tailSilenceStartSeconds;
      if (typeof headEdgeSeconds === 'number' && typeof tailEdgeSeconds === 'number') {
        return (headEdgeSeconds + tailEdgeSeconds) / 2;
      }
      if (typeof headEdgeSeconds === 'number') {
        return headEdgeSeconds;
      }
      if (typeof tailEdgeSeconds === 'number') {
        return tailEdgeSeconds;
      }
      return (silenceFocusWindow.startSeconds + silenceFocusWindow.endSeconds) / 2;
    })();
    const focusCenterPx = timeToDisplayPx(
      silenceCenterSeconds,
      detail.durationSeconds,
      waveformBaseDisplayWidth,
    );
    return {
      zoomFactorIndex: DEFAULT_WAVEFORM_ZOOM_FACTOR_INDEX,
      scrollLeft: clampScrollLeft(
        focusCenterPx - waveformViewportWidth / 2,
        waveformBaseDisplayWidth,
        waveformViewportWidth,
      ),
    };
  };

  const queueWaveformScroll = (scrollLeft: number) => {
    pendingWaveformScrollLeft.current = scrollLeft;
    setWaveformScrollRequestId((value) => value + 1);
  };

  const applySilenceFitWaveformView = (rememberCurrentView: boolean) => {
    const nextView = buildSilenceFitWaveformView();
    if (!nextView || !waveformScrollRef.current) {
      return false;
    }
    if (rememberCurrentView) {
      setWaveformViewSnapshot({
        zoomFactorIndex: waveformZoomFactorIndex,
        scrollLeft: waveformScrollRef.current.scrollLeft,
      });
    }
    queueWaveformScroll(nextView.scrollLeft);
    setWaveformZoomFactorIndex(nextView.zoomFactorIndex);
    return true;
  };

  const handleFitWaveformToSilenceWindow = () => {
    applySilenceFitWaveformView(true);
  };

  const handleRestoreWaveformView = () => {
    if (!waveformViewSnapshot) {
      return;
    }
    queueWaveformScroll(waveformViewSnapshot.scrollLeft);
    setWaveformZoomFactorIndex(waveformViewSnapshot.zoomFactorIndex);
    setWaveformViewSnapshot(null);
  };

  const applySilenceTrimSuggestion = (useJumpOffset: boolean) => {
    if (!detail?.durationSeconds || !silenceAnalysis) {
      return;
    }
    const headTargetSeconds = useJumpOffset
      ? silenceAnalysis.headJumpTimeSeconds
      : silenceAnalysis.headSilenceEndSeconds;
    const tailTargetSeconds = useJumpOffset
      ? silenceAnalysis.tailJumpTimeSeconds
      : silenceAnalysis.tailSilenceStartSeconds;
    if (typeof headTargetSeconds === 'number') {
      setTrimStartSeconds(toFieldNumberString(clampTimeSeconds(headTargetSeconds, detail.durationSeconds)));
    }
    if (typeof tailTargetSeconds === 'number') {
      const tailTrimSeconds = Math.max(0, detail.durationSeconds - clampTimeSeconds(tailTargetSeconds, detail.durationSeconds));
      setTrimEndSeconds(toFieldNumberString(tailTrimSeconds));
    }
  };

  const handleApplySilenceTrimSuggestion = () => {
    applySilenceTrimSuggestion(false);
  };

  const handleApplySilenceOffsetTrimSuggestion = () => {
    applySilenceTrimSuggestion(true);
  };

  useEffect(() => {
    if (!editorExpanded || !selectedArchiveId || !silenceAnalysis || waveformViewportWidth <= 0) {
      return;
    }
    const fitKey = [
      selectedArchiveId,
      silenceAnalysis.headSilenceEndSeconds ?? 'none',
      silenceAnalysis.tailSilenceStartSeconds ?? 'none',
      Math.round(waveformViewportWidth),
    ].join(':');
    if (waveformDefaultFitKey === fitKey) {
      return;
    }
    if (applySilenceFitWaveformView(false)) {
      setWaveformDefaultFitKey(fitKey);
    }
  }, [editorExpanded, selectedArchiveId, silenceAnalysis, waveformDefaultFitKey, waveformViewportWidth, waveformBaseDisplayWidth]);

  const handleUpload = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedArchiveId) {
      return;
    }

    setUploading(true);
    setUploadError('');
    setUploadResult(null);

    try {
      const response = await fetch(
        `/api/admin/archives/${encodeURIComponent(selectedArchiveId)}/upload`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...uploadForm,
            tags: uploadForm.tags,
            tid: Number(uploadForm.tid || 0),
            threads: Number(uploadForm.threads || 0),
            copyright: Number(uploadForm.copyright || 2),
            trimStartSeconds: trimStartValue,
            trimEndSeconds: trimEndValue,
            coverTimeSeconds: coverTimeSeconds === '' ? null : coverTimeValue,
          }),
        }
      );
      if (!response.ok) {
        const errorPayload = await readErrorPayload(response);
        throw new Error(parseErrorMessage(errorPayload, '上传失败'));
      }

      const payload = (await response.json()) as ArchiveUploadResult;
      setUploadResult(payload);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const handleWaveformClick = async (event: MouseEvent<HTMLDivElement>) => {
    if (!detail?.durationSeconds) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    setEditorExpanded(true);
    await loadKeyframeCandidates(detail.durationSeconds * ratio);
  };

  const importSelectedFrame = (target: 'trimStart' | 'trimEnd' | 'cover') => {
    if (!detail) {
      return;
    }
    if (target === 'trimStart') {
      if (previousKeyframeAtCursor === null) {
        return;
      }
      setTrimStartSeconds(toFieldNumberString(previousKeyframeAtCursor));
      return;
    }
    if (target === 'trimEnd') {
      if (nextKeyframeAtCursor === null) {
        return;
      }
      const tailTrim = Math.max(0, (detail.durationSeconds || 0) - nextKeyframeAtCursor);
      setTrimEndSeconds(toFieldNumberString(tailTrim));
      return;
    }
    if (!selectedFrame) {
      return;
    }
    setCoverTimeSeconds(toFieldNumberString(selectedFrame.timeSeconds));
  };

  const jumpToTime = async (timeSeconds: number | null) => {
    if (timeSeconds === null) {
      return;
    }
    setEditorExpanded(true);
    await loadKeyframeCandidates(timeSeconds);
  };

  const handleCopyField = async (field: string, value?: string | null) => {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return;
    }
    try {
      await navigator.clipboard.writeText(normalized);
      setCopiedField(field);
      window.setTimeout(() => {
        setCopiedField((current) => (current === field ? '' : current));
      }, 1600);
    } catch (error) {
      console.error('Failed to copy archive field:', error);
      setCopiedField(`${field}-failed`);
      window.setTimeout(() => {
        setCopiedField((current) => (current === `${field}-failed` ? '' : current));
      }, 1600);
    }
  };

  return (
    <section className="rounded-3xl border border-white/45 bg-white/18 p-5 shadow-lg shadow-slate-900/10 backdrop-blur-xl sm:p-6">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-sky-700/80">
              Archive Admin
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">
              存档查看、下载与 B 站上传
            </h2>
          </div>

          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="rounded-2xl border border-slate-300 bg-white/85 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-white"
          >
            {collapsed ? '展开存档管理' : '折叠存档管理'}
          </button>
        </div>

        {!collapsed && listError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {listError}
          </div>
        )}

        {collapsed ? (
          <div className="rounded-2xl border border-dashed border-white/50 bg-white/20 px-4 py-6 text-sm text-slate-700">
            存档管理已折叠。需要时再展开查看索引、下载、上传和高级编辑。
          </div>
        ) : (
          <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
            <div className="rounded-3xl border border-white/55 bg-white/72 p-4 xl:sticky xl:top-6 xl:self-start">
              <div className="mb-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-600">
                    存档列表
                  </h3>
                  <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500">
                    {archives.length} 项
                  </span>
                </div>

                <form onSubmit={handleSearch} className="space-y-2">
                  <input
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    placeholder="按标题、文件名或来源搜索"
                    className="w-full rounded-2xl border border-white/60 bg-white/80 px-4 py-2.5 text-sm text-slate-900 outline-none ring-0 placeholder:text-slate-500"
                  />

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="submit"
                      disabled={loadingList}
                      className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {loadingList ? '搜索中...' : '搜索'}
                    </button>
                    <button
                      type="button"
                      onClick={handleRefresh}
                      disabled={loadingList}
                      className="rounded-2xl border border-slate-300 bg-white/85 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      刷新
                    </button>
                  </div>
                </form>
              </div>

              <div className="max-h-[34rem] space-y-3 overflow-y-auto pr-1">
                {archives.length === 0 && !loadingList && (
                  <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                    当前没有可见的索引存档。试录和缓存文件默认不会出现在这里。
                  </div>
                )}

                {archives.map((archive) => {
                  const selected = archive.id === selectedArchiveId;
                  return (
                    <button
                      key={archive.id}
                      type="button"
                      onClick={() => setSelectedArchiveId(archive.id)}
                      className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                        selected
                          ? 'border-sky-400 bg-sky-50 shadow-sm shadow-sky-900/10'
                          : 'border-white/60 bg-white/80 hover:border-slate-300 hover:bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-900">
                            {archive.title}
                          </div>
                          <div className="mt-1 truncate text-xs text-slate-500">
                            {archive.fileName}
                          </div>
                        </div>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium uppercase text-slate-600">
                          {archive.kind}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                        <span>{formatBytes(archive.sizeBytes)}</span>
                        <span>{formatDateTime(archive.modifiedAt)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-5">
              <div className="rounded-3xl border border-white/55 bg-white/72 p-5">
                {loadingDetail && (
                  <div className="py-12 text-center text-sm text-slate-500">读取存档详情中...</div>
                )}

                {!loadingDetail && !selectedArchive && (
                  <div className="py-12 text-center text-sm text-slate-500">请选择一个存档。</div>
                )}

                {!loadingDetail && selectedArchive && detail && (
                  <div className="space-y-5">
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
                      <div className="min-w-0 rounded-3xl border border-slate-200 bg-slate-50/82 p-5">
                        <h3 className="text-2xl font-semibold text-slate-900">{detail.title}</h3>
                        <p className="mt-2 break-all text-sm text-slate-600">{detail.localPath}</p>
                      </div>

                      <div className="rounded-3xl border border-slate-200 bg-white/92 p-4">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await handleArchiveDownload(detail);
                              } catch (error) {
                                setDetailError(error instanceof Error ? error.message : '下载失败');
                              }
                            }}
                            disabled={downloadingOriginal || downloadingTrimmed}
                            className="inline-flex flex-1 items-center justify-center rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500"
                          >
                            {downloadLabel}
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await handleArchiveDownload(detail, { trimmed: true });
                              } catch (error) {
                                setDetailError(error instanceof Error ? error.message : '下载失败');
                              }
                            }}
                            disabled={!hasActiveTrim || downloadingOriginal || downloadingTrimmed}
                            className="inline-flex flex-1 items-center justify-center rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {trimmedDownloadLabel}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditorExpanded((value) => !value)}
                            className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                          >
                            {editorExpanded ? '收起快速剪辑' : '展开快速剪辑'}
                          </button>
                        </div>
                          <div className="mt-4 grid gap-3 sm:grid-cols-3">
                            <div className="rounded-2xl bg-slate-50 px-3 py-2">
                              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">头切</div>
                              <div className="mt-1 text-sm font-medium text-slate-900">{trimStartValue.toFixed(3)}s</div>
                            </div>
                            <div className="rounded-2xl bg-slate-50 px-3 py-2">
                              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">尾部</div>
                              <div className="mt-1 text-sm font-medium text-slate-900">
                                {retainedTailSilenceValue === null ? `${trimEndValue.toFixed(3)}s` : `静音 ${retainedTailSilenceValue.toFixed(3)}s`}
                              </div>
                              {retainedTailSilenceValue !== null && (
                                <div className="mt-1 text-[11px] text-slate-500">尾切 {trimEndValue.toFixed(3)}s</div>
                              )}
                            </div>
                            <div className="rounded-2xl bg-slate-50 px-3 py-2">
                              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">封面</div>
                              <div className="mt-1 text-sm font-medium text-slate-900">
                                {coverTimeValue === null ? '未设置' : `${coverTimeValue.toFixed(3)}s`}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {detailError && (
                      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                        {detailError}
                      </div>
                    )}

                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                      <div className="rounded-2xl bg-slate-50 px-4 py-3">
                        <div className="text-xs uppercase tracking-[0.2em] text-slate-500">时长</div>
                        <div className="mt-1 text-sm font-medium text-slate-900">
                          {formatDuration(detail.durationSeconds)}
                        </div>
                      </div>
                      <div className="rounded-2xl bg-slate-50 px-4 py-3">
                        <div className="text-xs uppercase tracking-[0.2em] text-slate-500">帧率</div>
                        <div className="mt-1 text-sm font-medium text-slate-900">
                          {formatFrameRate(currentFrameRate)}
                        </div>
                      </div>
                      <div className="rounded-2xl bg-slate-50 px-4 py-3">
                        <div className="text-xs uppercase tracking-[0.2em] text-slate-500">大小</div>
                        <div className="mt-1 text-sm font-medium text-slate-900">
                          {formatBytes(detail.sizeBytes)}
                        </div>
                      </div>
                      <div className="rounded-2xl bg-slate-50 px-4 py-3">
                        <div className="text-xs uppercase tracking-[0.2em] text-slate-500">更新时间</div>
                        <div className="mt-1 text-sm font-medium text-slate-900">
                          {formatDateTime(detail.modifiedAt)}
                        </div>
                      </div>
                      <div className="rounded-2xl bg-slate-50 px-4 py-3">
                        <div className="text-xs uppercase tracking-[0.2em] text-slate-500">分类</div>
                        <div className="mt-1 text-sm font-medium text-slate-900">
                          {formatCategoryPath(detail.rootLabel, detail.category)}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-slate-50/82 p-4">
                      <SectionToggle
                        expanded={detailMetaExpanded}
                        title="来源信息与关键文件"
                        subtitle={`页面、流地址、归档时间、PID 与 ${detail.relatedFileCount} 项关联文件`}
                        onToggle={() => setDetailMetaExpanded((value) => !value)}
                      />

                      {detailMetaExpanded && (
                        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.94fr)_minmax(0,1.06fr)]">
                          <div className="grid gap-4 lg:grid-cols-2">
                            <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 lg:col-span-2">
                              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">页面</div>
                              <div className="mt-2 break-all">
                                {detail.pageUrl ? (
                                  <a
                                    className="text-sky-700 underline decoration-sky-400 underline-offset-4"
                                    href={detail.pageUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {detail.pageUrl}
                                  </a>
                                ) : '无'}
                              </div>
                            </div>

                            <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700">
                              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">归档时间</div>
                              <div className="mt-2">{formatDateTime(detail.session?.archived_at || detail.modifiedAt)}</div>
                            </div>

                            <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700">
                              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">PID</div>
                              <div className="mt-2">{detail.session?.pid || '无'}</div>
                            </div>

                            <div className="relative rounded-2xl bg-slate-950 px-4 py-3 text-sm text-slate-100 lg:col-span-2">
                              <div className="pr-20 text-[11px] uppercase tracking-[0.2em] text-slate-400">流地址</div>
                              <button
                                type="button"
                                onClick={() => void handleCopyField('source-url', detail.sourceUrl)}
                                className="absolute right-3 top-3 rounded-xl border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-100 transition hover:border-slate-500 hover:bg-slate-800"
                              >
                                {copiedField === 'source-url'
                                  ? '已复制'
                                  : copiedField === 'source-url-failed'
                                    ? '失败'
                                    : '复制'}
                              </button>
                              <div className="mt-3 h-36 overflow-auto rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3 font-mono text-xs leading-6 text-slate-100">
                                {detail.sourceUrl || '无'}
                              </div>
                            </div>
                          </div>

                          <div className="rounded-2xl bg-white px-4 py-4 text-sm text-slate-700">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <h4 className="text-sm font-semibold text-slate-800">关联文件</h4>
                                <div className="mt-1 text-xs text-slate-500">
                                  显示 {detail.relatedFiles.length} 项
                                  {detail.relatedFilesTruncated ? ` / 共 ${detail.relatedFileCount} 项` : ''}
                                </div>
                              </div>
                            </div>

                            <div className="mt-3 max-h-[24rem] space-y-2 overflow-y-auto pr-1 text-xs text-slate-600">
                              {detail.relatedFiles.map((file) => (
                                <div key={file.path} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                                  <div className="truncate font-medium text-slate-800">{file.name}</div>
                                  <div className="mt-1">{formatBytes(file.sizeBytes)} / {formatDateTime(file.modifiedAt)}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="space-y-5">
                      <form onSubmit={handleUpload} className="rounded-3xl border border-slate-200 bg-slate-50/88 p-4">
                        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <h4 className="text-lg font-semibold text-slate-900">上传到 Bilibili</h4>
                            <p className="mt-1 text-sm text-slate-500">
                              默认沿用当前链路建议值，保存裁切和封面设置后可直接上传。
                            </p>
                          </div>
                          <div className="rounded-2xl bg-white px-3 py-2 text-xs text-slate-500">
                            当前裁切: 头 {trimStartValue.toFixed(3)}s
                            {retainedTailSilenceValue === null
                              ? ` / 尾 ${trimEndValue.toFixed(3)}s`
                              : ` / 尾静音 ${retainedTailSilenceValue.toFixed(3)}s（尾切 ${trimEndValue.toFixed(3)}s）`}
                            {coverTimeValue !== null ? ` / 封面 ${coverTimeValue.toFixed(3)}s` : ''}
                          </div>
                        </div>

                        <div className="grid gap-4 lg:grid-cols-2">
                          <label className="space-y-2 text-sm text-slate-700 lg:col-span-2">
                            <span>标题</span>
                            <input
                              value={uploadForm.title}
                              onChange={(event) => setUploadForm((prev) => ({ ...prev, title: event.target.value }))}
                              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2"
                            />
                          </label>

                          <label className="space-y-2 text-sm text-slate-700 lg:col-span-2">
                            <span>简介</span>
                            <textarea
                              rows={3}
                              value={uploadForm.description}
                              onChange={(event) => setUploadForm((prev) => ({ ...prev, description: event.target.value }))}
                              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2"
                            />
                          </label>

                          <label className="space-y-2 text-sm text-slate-700 lg:col-span-2">
                            <span>来源</span>
                            <input
                              value={uploadForm.sourceUrl}
                              onChange={(event) => setUploadForm((prev) => ({ ...prev, sourceUrl: event.target.value }))}
                              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2"
                            />
                          </label>

                          <label className="space-y-2 text-sm text-slate-700 lg:col-span-2">
                            <span>标签</span>
                            <input
                              value={uploadForm.tags}
                              onChange={(event) => setUploadForm((prev) => ({ ...prev, tags: event.target.value }))}
                              placeholder="用英文逗号分隔"
                              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2"
                            />
                          </label>
                        </div>

                        <div className="mt-4">
                          <SectionToggle
                            expanded={advancedUploadExpanded}
                            title="高级上传参数"
                            subtitle="Cookie 路径、分区、线程和提交线路在这里调整"
                            onToggle={() => setAdvancedUploadExpanded((value) => !value)}
                          />

                          {advancedUploadExpanded && (
                            <div className="mt-3 grid gap-4 rounded-3xl border border-slate-200 bg-white/88 p-4 lg:grid-cols-2">
                              <label className="space-y-2 text-sm text-slate-700 lg:col-span-2">
                                <span>Cookie 来源文件</span>
                                <input
                                  value={uploadForm.cookieSourcePath}
                                  onChange={(event) => setUploadForm((prev) => ({ ...prev, cookieSourcePath: event.target.value }))}
                                  className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2"
                                />
                              </label>

                              <label className="space-y-2 text-sm text-slate-700">
                                <span>分区 tid</span>
                                <input
                                  type="number"
                                  min="1"
                                  value={uploadForm.tid}
                                  onChange={(event) => setUploadForm((prev) => ({ ...prev, tid: event.target.value }))}
                                  className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2"
                                />
                              </label>

                              <label className="space-y-2 text-sm text-slate-700">
                                <span>上传线程数</span>
                                <input
                                  type="number"
                                  min="1"
                                  value={uploadForm.threads}
                                  onChange={(event) => setUploadForm((prev) => ({ ...prev, threads: event.target.value }))}
                                  className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2"
                                />
                              </label>

                              <label className="space-y-2 text-sm text-slate-700">
                                <span>提交接口</span>
                                <input
                                  value={uploadForm.submitApi}
                                  onChange={(event) => setUploadForm((prev) => ({ ...prev, submitApi: event.target.value }))}
                                  className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2"
                                />
                              </label>

                              <label className="space-y-2 text-sm text-slate-700">
                                <span>线路</span>
                                <input
                                  value={uploadForm.line}
                                  onChange={(event) => setUploadForm((prev) => ({ ...prev, line: event.target.value }))}
                                  className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2"
                                />
                              </label>

                              <label className="space-y-2 text-sm text-slate-700">
                                <span>版权类型</span>
                                <select
                                  value={uploadForm.copyright}
                                  onChange={(event) => setUploadForm((prev) => ({ ...prev, copyright: event.target.value }))}
                                  className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2"
                                >
                                  <option value="2">转载</option>
                                  <option value="1">自制</option>
                                </select>
                              </label>
                            </div>
                          )}
                        </div>

                        {uploadError && (
                          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                            {uploadError}
                          </div>
                        )}

                        {uploadResult && (
                          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                            <div className="font-medium">上传完成：{uploadResult.title}</div>
                            <div className="mt-1">Cookie 来源：{uploadResult.cookieSourcePath}</div>
                            <div className="mt-1">裁切方式：{describeTrimStrategy(uploadResult)}</div>
                            {(uploadResult.trimStrategy !== 'passthrough' || uploadResult.trimmedPath) && (
                              <div className="mt-1">
                                实际裁切：头 {uploadResult.appliedTrimStartSeconds.toFixed(3)}s
                                {appliedRetainedTailSilenceValue === null
                                  ? ` / 尾 ${uploadResult.appliedTrimEndSeconds.toFixed(3)}s`
                                  : ` / 尾静音 ${appliedRetainedTailSilenceValue.toFixed(3)}s（尾切 ${uploadResult.appliedTrimEndSeconds.toFixed(3)}s）`}
                              </div>
                            )}
                            {uploadResult.bvid && (
                              <div className="mt-1">
                                成功稿件：
                                <a
                                  href={uploadResult.videoUrl || `https://www.bilibili.com/video/${uploadResult.bvid}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-emerald-700 underline"
                                >
                                  {uploadResult.bvid}
                                </a>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="text-xs text-slate-500">
                            默认可直接上传；高级编辑只在需要时展开。
                          </div>

                          <button
                            type="submit"
                            disabled={uploading}
                            className="rounded-2xl bg-sky-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {uploading ? '上传中...' : '上传到 Bilibili'}
                          </button>
                        </div>
                      </form>

                      <div className="space-y-5">
                        {!editorExpanded && (
                          <div className="rounded-3xl border border-dashed border-slate-300 bg-white/72 p-5">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                              <div>
                                <h4 className="text-lg font-semibold text-slate-900">快速剪辑待展开</h4>
                                <p className="mt-2 text-sm text-slate-600">
                                  需要裁头尾、点波形定位、逐帧选封面时再进入编辑工作台，避免默认把重操作全部拉起来。
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setEditorExpanded(true)}
                                className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
                              >
                                打开快速剪辑
                              </button>
                            </div>
                          </div>
                        )}

                        {editorExpanded && (
                          <div className="space-y-5">
                            <div className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white/88 p-4 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <h4 className="text-lg font-semibold text-slate-900">快速剪辑</h4>
                                <p className="mt-1 text-sm text-slate-600">
                                  波形只负责落游标，真正可导入的点只限游标前后的关键帧；静音头尾也会给你快捷跳转点。
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setEditorExpanded(false)}
                                className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                              >
                                收起快速剪辑
                              </button>
                            </div>

                            <div className="rounded-3xl border border-slate-200 bg-slate-50/90 p-4">
                              <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                <div>
                                <h4 className="text-sm font-semibold text-slate-800">波形时间线</h4>
                                <p className="mt-1 text-xs text-slate-500">
                                  点击波形只移动游标并预览两侧关键帧；1x 默认对齐“静音前后各扩 1 分钟”的基准视图。
                                </p>
                              </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => effectiveCursorTime !== null && void loadKeyframeCandidates(effectiveCursorTime)}
                                    disabled={effectiveCursorTime === null || loadingFrames}
                                    className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    刷新关键帧候选
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void jumpToTime(silenceAnalysis?.headJumpTimeSeconds ?? null)}
                                    disabled={!silenceAnalysis || silenceAnalysis.headJumpTimeSeconds === null || loadingFrames}
                                    className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    头部静音前 30s
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void jumpToTime(silenceAnalysis?.tailJumpTimeSeconds ?? null)}
                                    disabled={!silenceAnalysis || silenceAnalysis.tailJumpTimeSeconds === null || loadingFrames}
                                    className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    尾部静音后 +30s
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void loadSilenceAnalysis()}
                                    disabled={!selectedArchiveId || loadingSilence}
                                    className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {loadingSilence ? '静音分析中...' : '重算静音点'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={handleFitWaveformToSilenceWindow}
                                    disabled={!silenceAnalysis || loadingSilence}
                                    className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    适配静音范围
                                  </button>
                                  <button
                                    type="button"
                                    onClick={handleRestoreWaveformView}
                                    disabled={!waveformViewSnapshot}
                                    className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    恢复前倍率
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setWaveformZoomFactorIndex((index) => Math.max(0, index - 1))}
                                    disabled={waveformZoomFactorIndex === 0}
                                    className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    缩小时轴
                                  </button>
                                  <span className="text-xs text-slate-500">
                                    时轴 {waveformZoom}x / 基准 {formatDuration(silenceFocusWindow?.windowSeconds ?? detail?.durationSeconds ?? null)} / 显示 {Math.round(waveformDisplayWidth)}px / 生成 {Math.round(waveformRenderWidth)}px
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setWaveformZoomFactorIndex((index) => Math.min(WAVEFORM_ZOOM_FACTORS.length - 1, index + 1))}
                                    disabled={waveformZoomFactorIndex >= WAVEFORM_ZOOM_FACTORS.length - 1}
                                    className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    放大时轴
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setWaveformAmplitudeIndex((index) => Math.max(0, index - 1))}
                                    disabled={waveformAmplitudeIndex === 0}
                                    className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    降低幅度
                                  </button>
                                  <span className="text-xs text-slate-500">
                                    幅度 {waveformAmplitudeScale}x
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setWaveformAmplitudeIndex((index) => Math.min(WAVEFORM_AMPLITUDE_LEVELS.length - 1, index + 1))}
                                    disabled={waveformAmplitudeIndex >= WAVEFORM_AMPLITUDE_LEVELS.length - 1}
                                    className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    提高幅度
                                  </button>
                                </div>
                              </div>

                              {waveformUrl && (
                                <div ref={waveformScrollRef} className="overflow-x-auto rounded-2xl border border-slate-200 bg-slate-950 p-2">
                                  <div style={{ width: `${waveformDisplayWidth}px`, minWidth: `${waveformDisplayWidth}px` }}>
                                    <div
                                      className="relative cursor-crosshair"
                                      onClick={handleWaveformClick}
                                    >
                                      <img
                                        src={waveformUrl}
                                        alt="Archive waveform"
                                        onLoad={() => setWaveformLoading(false)}
                                        onError={() => setWaveformLoading(false)}
                                        className={`block max-w-none rounded-xl bg-slate-950 select-none transition duration-200 ${
                                          waveformLoading ? 'opacity-60 blur-[1px] saturate-50' : ''
                                        }`}
                                        style={{ width: `${waveformDisplayWidth}px`, height: '220px' }}
                                        draggable={false}
                                      />
                                      {waveformLoading && (
                                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-slate-950/28">
                                          <div className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-1.5 text-[11px] font-medium text-slate-100 shadow-lg backdrop-blur-sm">
                                            波形加载中...
                                          </div>
                                        </div>
                                      )}

                                      {[
                                        { time: trimStartValue, tone: 'amber' as const, label: '头切' },
                                        { time: trimEndMarkerTime, tone: 'rose' as const, label: '尾切' },
                                        { time: coverTimeValue, tone: 'emerald' as const, label: '封面' },
                                        { time: cursorTimeSeconds, tone: 'sky' as const, label: '当前' },
                                        ...(showTimelineKeyframeDetail ? [
                                          {
                                            time: previousKeyframeAtCursor,
                                            tone: 'cyan' as const,
                                            label: previousKeyframeAtCursor !== null
                                              && nextKeyframeAtCursor !== null
                                              && previousKeyframeAtCursor === nextKeyframeAtCursor
                                              ? '命中关键'
                                              : '前关键',
                                          },
                                          {
                                            time: previousKeyframeAtCursor === nextKeyframeAtCursor
                                              ? null
                                              : nextKeyframeAtCursor,
                                            tone: 'cyan' as const,
                                            label: '后关键',
                                          },
                                        ] : []),
                                        { time: silenceAnalysis?.headSilenceEndSeconds ?? null, tone: 'orange' as const, label: '静音结束' },
                                        { time: silenceAnalysis?.tailSilenceStartSeconds ?? null, tone: 'lime' as const, label: '静音开始' },
                                      ]
                                        .filter((entry) => entry.time !== null)
                                        .map((entry) => (
                                          <div
                                            key={`${entry.label}-${entry.time}`}
                                            className="absolute inset-y-0"
                                            style={{ left: `${timeToDisplayPx(entry.time, detail.durationSeconds, waveformDisplayWidth)}px` }}
                                          >
                                            <div className={`h-full w-[2px] ${markerClassName(entry.tone)} shadow-[0_0_12px_rgba(255,255,255,0.4)]`} />
                                            <div className={`absolute left-1 top-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-white ${markerClassName(entry.tone)}`}>
                                              {entry.label}
                                            </div>
                                          </div>
                                        ))}

                                      {showTimelineKeyframeDetail && frameBatch.keyFrameTimes.map((timeSeconds) => (
                                        <div
                                          key={`key-${timeSeconds}`}
                                          className="absolute inset-y-0 opacity-80"
                                          style={{ left: `${timeToDisplayPx(timeSeconds, detail.durationSeconds, waveformDisplayWidth)}px` }}
                                        >
                                          <div className={`h-full w-px ${markerClassName('cyan')}`} />
                                        </div>
                                      ))}
                                    </div>

                                    <div className="relative mt-3 h-11 border-t border-slate-800/90">
                                      {timelineScale.minorTicks.map((timeSeconds) => (
                                        <div
                                          key={`minor-tick-${timeSeconds}`}
                                          className="absolute top-0 -translate-x-1/2"
                                          style={{ left: `${timeToDisplayPx(timeSeconds, detail.durationSeconds, waveformDisplayWidth)}px` }}
                                        >
                                          <div className="h-2 w-px bg-slate-700" />
                                        </div>
                                      ))}
                                      {timelineScale.majorTicks.map((timeSeconds) => (
                                        <div
                                          key={`tick-${timeSeconds}`}
                                          className="absolute top-0 -translate-x-1/2 text-[10px] text-slate-400"
                                          style={{ left: `${timeToDisplayPx(timeSeconds, detail.durationSeconds, waveformDisplayWidth)}px` }}
                                        >
                                          <div className="h-3 w-px bg-slate-500" />
                                          <div className="mt-1 whitespace-nowrap">{formatTimelineTick(timeSeconds)}</div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              )}

                              <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-600">
                                <span>当前游标: {cursorTimeSeconds === null ? '未选择' : `${cursorTimeSeconds.toFixed(3)}s`}</span>
                                <span>已选关键帧: {selectedFrame ? `${selectedFrame.timeSeconds.toFixed(3)}s` : '未选择'}</span>
                                <span>主刻度: {timelineScale.majorStep > 0 ? formatTimelineTick(timelineScale.majorStep) : '未生成'}</span>
                                <span>时间密度: {secondsPerDisplayPixel === null ? '未知' : formatSecondsDensity(secondsPerDisplayPixel)}</span>
                                <span>{loadingFrames ? '关键帧候选生成中...' : `已载入 ${frameBatch.frames.length} 个关键帧候选`}</span>
                                {showTimelineKeyframeDetail && frameBatch.keyFrameTimes.length > 0 && (
                                  <span>关键帧标记: {frameBatch.keyFrameTimes.length} 个</span>
                                )}
                                {(previousKeyframeAtCursor !== null || nextKeyframeAtCursor !== null) && (
                                  <span>
                                    光标两侧:
                                    前 {previousKeyframeAtCursor === null ? '未命中' : `${previousKeyframeAtCursor.toFixed(3)}s`}
                                    {' / '}
                                    后 {nextKeyframeAtCursor === null ? '未命中' : `${nextKeyframeAtCursor.toFixed(3)}s`}
                                  </span>
                                )}
                                {silenceAnalysis && (
                                  <span>
                                    静音范围:
                                    开头结束 {silenceAnalysis.headSilenceEndSeconds === null ? '未检测' : `${silenceAnalysis.headSilenceEndSeconds.toFixed(3)}s`}
                                    {' / '}
                                    尾部开始 {silenceAnalysis.tailSilenceStartSeconds === null ? '未检测' : `${silenceAnalysis.tailSilenceStartSeconds.toFixed(3)}s`}
                                  </span>
                                )}
                                {loadingSilence && <span>静音头尾分析中...</span>}
                              </div>

                              {frameError && (
                                <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                                  {frameError}
                                </div>
                              )}

                              {silenceError && (
                                <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                                  {silenceError}
                                </div>
                              )}
                            </div>

                            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.14fr)_minmax(340px,0.86fr)]">
                              <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
                                <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                  <div>
                                    <h4 className="text-sm font-semibold text-slate-800">关键帧预览</h4>
                                    <p className="mt-1 text-xs text-slate-500">
                                      光标只负责定位；下面只展示并允许选择前后关键帧，避免误选非关键帧。
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => setPreviewZoomIndex((index) => Math.max(0, index - 1))}
                                      disabled={previewZoomIndex === 0}
                                      className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      预览缩小
                                    </button>
                                    <span className="text-xs text-slate-500">{previewZoom}x</span>
                                    <button
                                      type="button"
                                      onClick={() => setPreviewZoomIndex((index) => Math.min(PREVIEW_ZOOM_LEVELS.length - 1, index + 1))}
                                      disabled={previewZoomIndex >= PREVIEW_ZOOM_LEVELS.length - 1}
                                      className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      预览放大
                                    </button>
                                  </div>
                                </div>

                                <div className="overflow-auto rounded-2xl border border-slate-200 bg-slate-900 p-3">
                                  {selectedFrame ? (
                                    <img
                                      src={selectedFrame.dataUrl}
                                      alt={`Frame at ${selectedFrame.timeSeconds}s`}
                                      className="max-w-none rounded-xl object-contain"
                                      style={{ width: `${previewZoom * 100}%`, minWidth: '100%' }}
                                    />
                                  ) : (
                                    <div className="flex aspect-video items-center justify-center rounded-xl border border-dashed border-slate-700 text-sm text-slate-400">
                                      打开快速剪辑后，点波形图即可按游标抓取前后关键帧
                                    </div>
                                  )}
                                </div>

                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => previousKeyframeAtCursor !== null && setSelectedFrameTimeSeconds(previousKeyframeAtCursor)}
                                    disabled={previousKeyframeAtCursor === null || loadingFrames}
                                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    预览前关键帧
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => nextKeyframeAtCursor !== null && setSelectedFrameTimeSeconds(nextKeyframeAtCursor)}
                                    disabled={nextKeyframeAtCursor === null || loadingFrames}
                                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    预览后关键帧
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => effectiveCursorTime !== null && void loadKeyframeCandidates(effectiveCursorTime)}
                                    disabled={effectiveCursorTime === null || loadingFrames}
                                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    重新取当前游标
                                  </button>
                                  {selectedFrame && (
                                    <span className="text-xs text-slate-500">
                                      选中关键帧: {selectedFrame.timeSeconds.toFixed(3)}s
                                    </span>
                                  )}
                                </div>

                                {keyframeCandidates.length > 0 && (
                                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                    {keyframeCandidates.map((frame) => {
                                      const isSelected = selectedFrame?.timeSeconds === frame.timeSeconds;
                                      return (
                                        <button
                                          key={`${detail.id}-${frame.timeSeconds}`}
                                          type="button"
                                          onClick={() => setSelectedFrameTimeSeconds(frame.timeSeconds)}
                                          className={`overflow-hidden rounded-2xl border text-left transition ${
                                            isSelected
                                              ? 'border-sky-500 ring-2 ring-sky-200'
                                              : 'border-slate-200 hover:border-slate-400'
                                          }`}
                                        >
                                          <img
                                            src={frame.dataUrl}
                                            alt={`Frame at ${frame.timeSeconds}s`}
                                            className="aspect-video w-full object-cover"
                                          />
                                          <div className="bg-white px-3 py-2 text-xs text-slate-600">
                                            <div className="font-medium text-slate-800">{frame.label}</div>
                                            <div className="mt-1">{frame.timeSeconds.toFixed(3)}s</div>
                                          </div>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>

                              <div className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
                                <div>
                                  <h4 className="text-sm font-semibold text-slate-800">裁切与封面设置</h4>
                                  <p className="mt-1 text-xs text-slate-500">
                                    快速编辑只允许关键帧被选中。头切固定取游标前关键帧、尾切固定取游标后关键帧；静音快捷跳转按“头前尾后”留出缓冲，手动输入秒数在上传时也会再按关键帧规则修正。
                                  </p>
                                </div>

                                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="font-medium text-slate-800">静音快捷跳转</div>
                                    <div className="flex flex-wrap justify-end gap-2">
                                      <button
                                        type="button"
                                        onClick={handleApplySilenceOffsetTrimSuggestion}
                                        disabled={!hasSilenceOffsetTrimSuggestion}
                                        className="rounded-xl border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        按偏移套用
                                      </button>
                                      <button
                                        type="button"
                                        onClick={handleApplySilenceTrimSuggestion}
                                        disabled={!hasSilenceTrimSuggestion}
                                        className="rounded-xl border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        按原值套用
                                      </button>
                                    </div>
                                  </div>
                                  <div className="mt-2">
                                    头部静音结束: {silenceAnalysis?.headSilenceEndSeconds === null || !silenceAnalysis ? '未检测' : `${silenceAnalysis.headSilenceEndSeconds.toFixed(3)}s`}
                                  </div>
                                  <div className="mt-1">
                                    尾部静音起始: {silenceAnalysis?.tailSilenceStartSeconds === null || !silenceAnalysis ? '未检测' : `${silenceAnalysis.tailSilenceStartSeconds.toFixed(3)}s`}
                                  </div>
                                  <div className="mt-1">
                                    快捷偏移: {silenceAnalysis ? `${silenceAnalysis.jumpOffsetSeconds.toFixed(0)}s` : '30s'}
                                  </div>
                                  <div className="mt-2 text-[11px] text-slate-500">
                                    “按偏移套用”会把头前尾后的缓冲点直接写进裁切参数；尾部主显示按保留静音秒数理解，“按原值套用”则保留静音边界原值。
                                  </div>
                                </div>

                                <div className="grid gap-3">
                                  <label className="space-y-2 text-sm text-slate-700">
                                    <div className="flex items-center justify-between gap-3">
                                      <span>开头裁切秒数</span>
                                      <div className="flex gap-2">
                                        <button
                                          type="button"
                                          onClick={() => void jumpToTime(trimStartValue)}
                                          className="rounded-xl border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700"
                                        >
                                          查看
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => importSelectedFrame('trimStart')}
                                          disabled={previousKeyframeAtCursor === null}
                                          className="rounded-xl border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          用前关键帧
                                        </button>
                                      </div>
                                    </div>
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={trimStartSeconds}
                                      onChange={(event) => setTrimStartSeconds(event.target.value)}
                                      className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2"
                                    />
                                  </label>

                                  <label className="space-y-2 text-sm text-slate-700">
                                    <div className="flex items-center justify-between gap-3">
                                      <span>结尾裁切秒数（从尾部回削）</span>
                                      <div className="flex gap-2">
                                        <button
                                          type="button"
                                          onClick={() => void jumpToTime(trimEndMarkerTime)}
                                          className="rounded-xl border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700"
                                        >
                                          查看
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => importSelectedFrame('trimEnd')}
                                          disabled={nextKeyframeAtCursor === null}
                                          className="rounded-xl border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          用后关键帧
                                        </button>
                                      </div>
                                    </div>
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={trimEndSeconds}
                                      onChange={(event) => setTrimEndSeconds(event.target.value)}
                                      className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2"
                                    />
                                    {retainedTailSilenceValue !== null && (
                                      <div className="text-xs text-slate-500">
                                        按当前静音点，尾部将保留 {retainedTailSilenceValue.toFixed(3)}s 静音；上传时仍会按后方关键帧吸附。
                                      </div>
                                    )}
                                  </label>

                                  <label className="space-y-2 text-sm text-slate-700">
                                    <div className="flex items-center justify-between gap-3">
                                      <span>封面时间点</span>
                                      <div className="flex gap-2">
                                        <button
                                          type="button"
                                          onClick={() => void jumpToTime(coverTimeValue)}
                                          className="rounded-xl border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700"
                                        >
                                          查看
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => importSelectedFrame('cover')}
                                          disabled={!selectedFrame}
                                          className="rounded-xl border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          用所选关键帧
                                        </button>
                                      </div>
                                    </div>
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={coverTimeSeconds}
                                      onChange={(event) => setCoverTimeSeconds(event.target.value)}
                                      className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2"
                                    />
                                  </label>
                                </div>

                                <div className="rounded-2xl bg-white px-4 py-3 text-xs text-slate-600">
                                  <div>头切: {trimStartValue.toFixed(3)}s</div>
                                  <div>
                                    {retainedTailSilenceValue === null
                                      ? `尾切: ${trimEndValue.toFixed(3)}s`
                                      : `尾静音: ${retainedTailSilenceValue.toFixed(3)}s（尾切 ${trimEndValue.toFixed(3)}s）`}
                                  </div>
                                  <div>封面: {coverTimeValue === null ? '未设置' : `${coverTimeValue.toFixed(3)}s`}</div>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
