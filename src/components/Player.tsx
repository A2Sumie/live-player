'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Player } from '@/lib/db';
import type { RealtimeTextClientConfig, RealtimeTextSegment, RealtimeTextSnapshot } from '@/lib/realtime-text';
import Artplayer from "artplayer";
import type { Option } from "artplayer";
import Hls from "hls.js";
import artplayerPluginHlsControl from 'artplayer-plugin-hls-control';
import ObfuscatedText from './ObfuscatedText';
import ProtectedOutboundLink from './ProtectedOutboundLink';
import { useAuth } from '@/middleware/WithAuth';
import { isTwentyTwoSevenPid } from '@/lib/player-flags';

// Extend Artplayer type to include hls property
declare module 'artplayer' {
  interface Artplayer {
    hls?: Hls;
  }
}

function _Artplayer({
  option,
  getInstance,
  debug = false,
  player,
  ...rest
}: {
  option: Omit<Option, "container">;
  getInstance?: (art: Artplayer) => void;
  debug?: boolean;
  player?: Player;
} & React.HTMLAttributes<HTMLDivElement>) {
  const artRef = useRef<HTMLDivElement | null>(null);

  const playM3u8 = useCallback(
    (video: HTMLVideoElement, url: string, art: Artplayer) => {
      if (Hls.isSupported()) {
        if ((art as any).hls) (art as any).hls.destroy();
        const originUrlObj = new URL(url);
        const queryParms = originUrlObj.searchParams;
        const realtimeVideoMode = (window.localStorage.getItem('n2nj:realtime-video-mode') || 'aligned') as VideoLatencyMode;
        const hlsLatencyConfig = realtimeVideoMode === 'low' ? LOW_LATENCY_HLS_CONFIG : ALIGNED_HLS_CONFIG;
        const hls = new Hls({
          debug: debug, // Enable debug if requested
          ...hlsLatencyConfig,
          xhrSetup(xhr, tsUrl) {
            if (tsUrl.includes(".ts") || tsUrl.includes(".m4s") || tsUrl.includes(".mp4") || tsUrl.endsWith(".m3u8")) {
              const tsUrlObj = new URL(tsUrl);
              queryParms.forEach((value, key) => {
                tsUrlObj.searchParams.set(key, value);
              });
              xhr.open("GET", tsUrlObj.toString(), true);
            }
          },
        });
        hls.loadSource(url);
        hls.attachMedia(video);
        (art as any).hls = hls;

        // Error Handling
        hls.on(Hls.Events.ERROR, function (event, data) {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                console.log("⚠️ Network error, trying to recover...");
                art.notice.show = "信号中断，正在重连...";
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                console.log("⚠️ Media error, trying to recover...");
                hls.recoverMediaError();
                break;
              default:
                art.notice.show = "无法播放，请手动刷新";
                hls.destroy();
                break;
            }
          }
        });

        art.on("destroy", () => hls.destroy());
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
      } else {
        art.notice.show = '当前环境不支持 m3u8 播放';
      }
    },
    []
  );

  useEffect(() => {
    // Quality Persistence
    const saveQuality = (value: string | number) => {
      if (typeof window !== 'undefined') {
        localStorage.setItem('artplayer_quality', String(value));
      }
    };

    const getSavedQuality = () => {
      if (typeof window !== 'undefined') {
        return localStorage.getItem('artplayer_quality');
      }
      return null;
    };

    const art = new Artplayer({
      ...option,
      container: artRef.current || "",
      customType: {
        m3u8: (video: HTMLVideoElement, url: string, art: Artplayer) => {
          playM3u8(video, url, art);

          // Apply saved quality after HLS Init
          const hls = (art as any).hls as Hls;
          if (hls) {
            const saved = getSavedQuality();

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              // Trigger UI update for plugins that depend on parsed metadata
              if (art.plugins.artplayerPluginHlsControl) {
                (art.plugins.artplayerPluginHlsControl as any).update();
              }

              if (saved) {
                if (saved === 'auto') {
                  hls.currentLevel = -1;
                } else {
                  const levelIndex = hls.levels.findIndex(l => l.height === parseInt(saved));
                  if (levelIndex !== -1) {
                    hls.startLevel = levelIndex;
                    // Determine if we should lock it.
                    // If user saved a specific quality, they likely want it forced.
                    // But startLevel is safer for avoiding stalls if that level is bad initially?
                    // Let's set nextLevel to force the switch immediately.
                    hls.nextLevel = levelIndex;
                  }
                }
              }
            });

            // Listen for changes
            hls.on(Hls.Events.LEVEL_SWITCHING, (event, data) => {
              // Verify if it's manual or auto
              if (hls.autoLevelEnabled) {
                saveQuality('auto');

                // [FEATURE] Update Quality Control Text to show actual quality
                const level = hls.levels[data.level];
                if (level) {
                  const height = level.height || '';

                  // Robust codec detection
                  let codecLabel = '';
                  const attrs = level.attrs || {};
                  const vCodec = (level.videoCodec || attrs.CODECS || '').toLowerCase();

                  if (vCodec.includes('hvc') || vCodec.includes('hev')) codecLabel = 'HEVC';
                  else if (vCodec.includes('avc') || vCodec.includes('h264')) codecLabel = 'H264';

                  const label = `Auto (${height}P${codecLabel ? ' ' + codecLabel : ''})`;

                  // Update the quality control text
                  // We need to wait for the UI to update first, or force it
                  // Artplayer HLS plugin might reset it on level switch?
                  const updateLabel = () => {
                    const qualityCtrl = artRef.current?.querySelector('.art-control-quality');
                    if (qualityCtrl && qualityCtrl.innerHTML !== label) {
                      qualityCtrl.innerHTML = label;
                    }
                  };

                  // Execute multiple times to ensure we override the plugin
                  updateLabel();
                  setTimeout(updateLabel, 100);
                  setTimeout(updateLabel, 300);
                  setTimeout(updateLabel, 600);
                }

              } else {
                if (hls.levels[data.level]) {
                  saveQuality(hls.levels[data.level].height);
                }
              }
            });
          }
        },
      },
      controls: [


        ...(isTwentyTwoSevenPid(player?.pId) ? [{
          name: 'realtime-subtitle-toggle',
          index: 19,
          position: 'right' as const,
          html: '<span style="font-size:12px;font-weight:700;line-height:1;">字幕</span>',
          tooltip: '开关实时字幕',
          click: function (this: Artplayer) {
            window.dispatchEvent(new CustomEvent('n2nj:toggle-realtime-subtitles'));
          },
        }] : []),
        {
          name: 'pip',
          index: 20,
          position: 'right',
          html: '<svg xmlns="http://www.w3.org/2000/svg" height="22" width="22" viewBox="0 0 24 24"><path d="M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z" fill="currentColor"/></svg>',
          tooltip: '画中画',
          click: function (this: Artplayer) {
            if (document.pictureInPictureEnabled) {
              if (document.pictureInPictureElement) {
                document.exitPictureInPicture();
              } else {
                this.video.requestPictureInPicture();
              }
            } else if ((this.video as any).webkitSupportsPresentationMode && typeof (this.video as any).webkitSetPresentationMode === 'function') {
              // iOS Safari specific
              const mode = (this.video as any).webkitPresentationMode;
              (this.video as any).webkitSetPresentationMode(mode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
            } else {
              this.notice.show = '当前环境不支持画中画';
            }
          },
        }
      ],
      settings: [],
      plugins: [
        artplayerPluginHlsControl({
          quality: {
            control: true,
            setting: true,
            getName: (level: any) => {
              const height = level.height || 'Unknown';
              const bitrate = level.bitrate ? (level.bitrate / 1000000).toFixed(1) + 'M' : '';

              // Robust codec detection
              let codec = '';
              const attrs = level.attrs || {};
              const vCodec = (level.videoCodec || attrs.CODECS || '').toLowerCase();

              if (vCodec.includes('hvc') || vCodec.includes('hev')) codec = 'HEVC';
              else if (vCodec.includes('avc') || vCodec.includes('h264')) codec = 'H264';

              let label = `${height}P`;
              if (codec) label += ` ${codec}`;
              if (bitrate) label += ` (${bitrate})`;
              return label;
            },
            title: '画质',
            auto: '自动',
          },
          audio: {
            control: true,
            setting: true,
            getName: (track: any) => track.name,
            title: '音轨',
            auto: '自动',
          }
        }),
      ]
    });

    // Enforce "No Pause" policy for Live Player & Auto-Sync
    art.on('pause', () => {
      if (!art.option.isLive) return;
      art.notice.show = '直播模式无法暂停';
      art.play();
    });

    if (getInstance && typeof getInstance === "function") {
      getInstance(art);
    }

    return () => {
      console.log('destroy outside')
      if (art && art.destroy) {
        console.log('destroy inside')
        art.destroy(false);
      }
    };
  }, []);

  return <div ref={artRef} {...rest}></div>;
}

interface PlayerProps {
  player: Player;
  debug?: boolean;
}

const DEFAULT_REALTIME_TEXT_CONFIG: RealtimeTextClientConfig = {
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

const MARKER_COLORS = [
  '#38bdf8',
  '#f59e0b',
  '#22c55e',
  '#f43f5e',
  '#a78bfa',
  '#14b8a6',
];

const REALTIME_SUBTITLE_MAX_HOLD_MS = 60000;
const REALTIME_SUBTITLE_CUE_LEAD_MS = 250;
const DEFAULT_ALIGNED_VIDEO_DELAY_SECONDS = 10;
const DEFAULT_STABLE_VIDEO_DELAY_SECONDS = 15;
const SUBTITLE_CONTEXT_SEGMENTS = 5;
const MOBILE_PORTRAIT_BREAKPOINT = 700;
const REALTIME_SNAPSHOT_POLL_MS = 4000;
const LOW_LATENCY_HLS_CONFIG = {
  lowLatencyMode: true,
  liveSyncDurationCount: 1,
  liveMaxLatencyDurationCount: 4,
};
const ALIGNED_HLS_CONFIG = {
  lowLatencyMode: false,
  liveSyncDurationCount: 4,
  liveMaxLatencyDurationCount: 10,
};

type PlaybackTimecode = {
  wallTimeMs: number | null;
  latencyMs: number | null;
  liveSyncPosition: number | null;
  currentTime: number | null;
  source: 'hls-latency' | 'clock';
};

type VideoLatencyMode = 'aligned' | 'low';

const PLAYBACK_SEEK_THRESHOLD_SECONDS = 1.4;
const REALTIME_SETTINGS_VERSION = 1;

type StoredRealtimeSettings = {
  version?: number;
  transcriptOpen?: boolean;
  showSourceText?: boolean;
  showTranslationText?: boolean;
  showTiming?: boolean;
  subtitleOffsetSeconds?: number;
  subtitleDelaySeconds?: number; // Backward-compatible name from the first prototype.
  videoDelaySeconds?: number;
  subtitleOpacity?: number;
  subtitleScale?: number;
  videoLatencyMode?: VideoLatencyMode | 'normal';
};

type SegmentWithTimecode = {
  segment: RealtimeTextSegment;
  startAt: number;
  endAt: number;
};

type RealtimeTextWindow = {
  previous: RealtimeTextSegment | null;
  current: RealtimeTextSegment | null;
  targetWallTimeMs: number | null;
  usedTimeline: boolean;
};

type SubtitleTextPiece = {
  segment: RealtimeTextSegment;
  color: string;
  isCurrent: boolean;
};

function formatClockJst(value: Date | string | number) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--:--:--';
  }
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function formatDuration(ms?: number | null) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) {
    return '--:--';
  }
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatLag(now: Date, iso?: string | null) {
  if (!iso) {
    return '--s';
  }
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) {
    return '--s';
  }
  return `${Math.max(0, Math.round((now.getTime() - then) / 1000))}s`;
}

function formatIsoClockJst(value: unknown) {
  if (typeof value !== 'string' || !value) {
    return '--:--:--';
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return '--:--:--';
  }
  return formatClockJst(date);
}

function formatMillis(ms?: number | null) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) {
    return '--ms';
  }
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`;
  }
  return `${Math.round(ms)}ms`;
}

function numberFromMeta(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getSegmentTimecodeRange(segment: RealtimeTextSegment) {
  const captureEndedAt = typeof segment.timelineMeta?.capture_ended_at === 'string'
    ? new Date(segment.timelineMeta.capture_ended_at).getTime()
    : NaN;
  if (!Number.isFinite(captureEndedAt)) {
    return null;
  }
  const windowEnd = numberFromMeta(segment.timelineMeta?.window_end);
  const segmentStart = numberFromMeta(segment.timelineMeta?.segment_start) ?? (segment.startMs / 1000);
  const segmentEnd = numberFromMeta(segment.timelineMeta?.segment_end) ?? ((segment.endMs ?? segment.startMs) / 1000);
  if (windowEnd === null) {
    return null;
  }
  const startAt = captureEndedAt - Math.max(0, windowEnd - segmentStart) * 1000;
  const endAt = captureEndedAt - Math.max(0, windowEnd - segmentEnd) * 1000;
  return { startAt, endAt };
}

function segmentSortTime(segment: RealtimeTextSegment) {
  const timecode = getSegmentTimecodeRange(segment);
  if (timecode) {
    return timecode.startAt;
  }
  return segment.startMs;
}

function normalizeSegmentsByTimecode(segments: RealtimeTextSegment[]) {
  return [...segments].sort((left, right) => segmentSortTime(left) - segmentSortTime(right));
}

function findRealtimeTextWindow(
  segments: RealtimeTextSegment[],
  partial: RealtimeTextSegment | null | undefined,
  now: Date,
  subtitleOffsetMs = 0,
  playbackTimecode?: PlaybackTimecode | null,
): RealtimeTextWindow {
  const playbackWallTimeMs = playbackTimecode?.wallTimeMs;
  if (typeof playbackWallTimeMs === 'number' && Number.isFinite(playbackWallTimeMs)) {
    const targetWallTimeMs = playbackWallTimeMs - Math.max(0, subtitleOffsetMs);
    const timecodedSegments: SegmentWithTimecode[] = [];
    let sawTimeline = false;

    for (const segment of segments) {
      const range = getSegmentTimecodeRange(segment);
      if (!range) {
        continue;
      }
      sawTimeline = true;
      timecodedSegments.push({ segment, startAt: range.startAt, endAt: range.endAt });
    }
    timecodedSegments.sort((left, right) => left.startAt - right.startAt);

    if (sawTimeline) {
      let previous: RealtimeTextSegment | null = null;
      let current: RealtimeTextSegment | null = null;
      for (let index = 0; index < timecodedSegments.length; index += 1) {
        const item = timecodedSegments[index];
        const cueAt = Math.max(item.startAt, item.endAt - REALTIME_SUBTITLE_CUE_LEAD_MS);
        if (targetWallTimeMs < cueAt) {
          break;
        }
        previous = current;
        current = item.segment;
      }

      if (current) {
        const currentEndAt = getSegmentTimecodeRange(current)?.endAt || 0;
        if (targetWallTimeMs - currentEndAt > REALTIME_SUBTITLE_MAX_HOLD_MS) {
          current = null;
        }
      }

      return {
        previous: previous && current && previous.id !== current.id ? previous : null,
        current,
        targetWallTimeMs,
        usedTimeline: true,
      };
    }
  }

  const sorted = normalizeSegmentsByTimecode(segments);
  const current = sorted[sorted.length - 1] || partial || null;
  const previous = current && sorted.length > 1 ? sorted[sorted.length - 2] : null;
  if (!current && partial) {
    return {
      previous: null,
      current: partial,
      targetWallTimeMs: now.getTime() - Math.max(0, subtitleOffsetMs),
      usedTimeline: false,
    };
  }
  return {
    previous: previous && current && previous.id !== current.id ? previous : null,
    current,
    targetWallTimeMs: now.getTime() - Math.max(0, subtitleOffsetMs),
    usedTimeline: false,
  };
}

function buildSubtitleTextPieces(
  segments: RealtimeTextSegment[],
  current: RealtimeTextSegment | null,
  allowLatestFallback = true,
): SubtitleTextPiece[] {
  const sorted = normalizeSegmentsByTimecode(segments);
  if (!sorted.length || (!current && !allowLatestFallback)) {
    return [];
  }

  const currentIndex = current
    ? Math.max(0, sorted.findIndex((segment) => segment.id === current.id))
    : sorted.length - 1;
  const effectiveIndex = currentIndex >= 0 ? currentIndex : sorted.length - 1;
  const startIndex = Math.max(0, effectiveIndex - SUBTITLE_CONTEXT_SEGMENTS + 1);

  return sorted.slice(startIndex, effectiveIndex + 1).map((segment) => {
    const range = getSegmentTimecodeRange(segment);
    const bucketSource = range ? range.startAt : segment.startMs;
    const bucket = Math.floor(bucketSource / (10 * 1000));
    return {
      segment,
      color: markerColor(bucket),
      isCurrent: current ? segment.id === current.id : segment.id === sorted[effectiveIndex]?.id,
    };
  });
}

function markerColor(bucket: number) {
  return MARKER_COLORS[((bucket % MARKER_COLORS.length) + MARKER_COLORS.length) % MARKER_COLORS.length];
}

function makePreviewSegments(): RealtimeTextSegment[] {
  const createdAt = new Date().toISOString();
  return [
    {
      id: 'debug-preview-1',
      startMs: 0,
      endMs: 2400,
      sourceText: 'リアルタイム文字起こしのプレビューです。',
      translatedText: '这是实时转写/翻译预览。',
      language: 'ja-JP',
      isFinal: true,
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: 'debug-preview-2',
      startMs: 2500,
      endMs: 5200,
      sourceText: 'ASR backend is not connected yet.',
      translatedText: '后端转写链路尚未接入。',
      language: 'en',
      isFinal: true,
      createdAt,
      updatedAt: createdAt,
    },
  ];
}

function readPlaybackTimecode(art: Artplayer | null): PlaybackTimecode {
  const hls = (art as any)?.hls as Hls | undefined;
  const video = (art as any)?.video as HTMLVideoElement | undefined;
  const latencySeconds = hls && typeof hls.latency === 'number' && Number.isFinite(hls.latency)
    ? hls.latency
    : null;
  const currentTime = video && Number.isFinite(video.currentTime) ? video.currentTime : null;
  const liveSyncPosition = hls && typeof hls.liveSyncPosition === 'number' && Number.isFinite(hls.liveSyncPosition)
    ? hls.liveSyncPosition
    : null;

  if (latencySeconds !== null && latencySeconds >= 0) {
    const latencyMs = latencySeconds * 1000;
    return {
      wallTimeMs: Date.now() - latencyMs,
      latencyMs,
      liveSyncPosition,
      currentTime,
      source: 'hls-latency',
    };
  }

  return {
    wallTimeMs: Date.now(),
    latencyMs: null,
    liveSyncPosition,
    currentTime,
    source: 'clock',
  };
}

function tunePlaybackLatency(
  art: Artplayer | null,
  mode: VideoLatencyMode,
  timecode: PlaybackTimecode,
  targetDelaySeconds: number,
) {
  const video = (art as any)?.video as HTMLVideoElement | undefined;
  if (!video) {
    return;
  }

  if (video.playbackRate !== 1) {
    video.playbackRate = 1;
  }

  if (timecode.latencyMs === null) {
    return;
  }

  if (mode === 'low') {
    return;
  }

  const targetLatencySeconds = Math.max(0, targetDelaySeconds);
  const currentLatencySeconds = timecode.latencyMs / 1000;
  const driftSeconds = currentLatencySeconds - targetLatencySeconds;
  if (Math.abs(driftSeconds) < PLAYBACK_SEEK_THRESHOLD_SECONDS || timecode.currentTime === null) {
    return;
  }

  const seekable = video.seekable;
  if (!seekable.length) {
    return;
  }
  const seekableStart = seekable.start(0);
  const seekableEnd = seekable.end(seekable.length - 1);
  const wantedTime = Math.min(seekableEnd - 0.15, Math.max(seekableStart, timecode.currentTime + driftSeconds));
  if (Number.isFinite(wantedTime) && Math.abs(wantedTime - video.currentTime) >= 0.75) {
    video.currentTime = wantedTime;
  }
}

function clampUiNumber(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function reloadHlsForLatencyMode(art: Artplayer | null, mode: VideoLatencyMode) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem('n2nj:realtime-video-mode', mode);
  }
  const player = art as any;
  if (!player?.switchUrl || !player?.option?.url) {
    return;
  }
  const video = player.video as HTMLVideoElement | undefined;
  player.switchUrl(player.option.url);
  if (video && video.paused) {
    player.play?.();
  }
}

export default function PlayerComponent({ player, debug = false }: PlayerProps) {
  const artPlayerRef = useRef<any>(null);
  const router = useRouter();
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState(player.name);
  const [renameDraft, setRenameDraft] = useState(player.name);
  const [renameExpanded, setRenameExpanded] = useState(false);
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState('');
  const [debugRealtimeEnabled, setDebugRealtimeEnabled] = useState(false);
  const [realtimeSnapshot, setRealtimeSnapshot] = useState<RealtimeTextSnapshot | null>(null);
  const realtimeConfig = realtimeSnapshot?.config || DEFAULT_REALTIME_TEXT_CONFIG;
  const [subtitleOpacity, setSubtitleOpacity] = useState(DEFAULT_REALTIME_TEXT_CONFIG.subtitleOpacity);
  const [subtitleScale, setSubtitleScale] = useState(DEFAULT_REALTIME_TEXT_CONFIG.subtitleScale);
  const [realtimeControlsOpen, setRealtimeControlsOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(DEFAULT_REALTIME_TEXT_CONFIG.transcriptPanel);
  const [showSourceText, setShowSourceText] = useState(DEFAULT_REALTIME_TEXT_CONFIG.showSource);
  const [showTranslationText, setShowTranslationText] = useState(DEFAULT_REALTIME_TEXT_CONFIG.showTranslation);
  const [showTiming, setShowTiming] = useState(DEFAULT_REALTIME_TEXT_CONFIG.showTiming);
  const [subtitleOffsetSeconds, setSubtitleOffsetSeconds] = useState(0);
  const [videoDelaySeconds, setVideoDelaySeconds] = useState(
    DEFAULT_REALTIME_TEXT_CONFIG.videoDelaySeconds || DEFAULT_ALIGNED_VIDEO_DELAY_SECONDS,
  );
  const [videoLatencyMode, setVideoLatencyMode] = useState<VideoLatencyMode>('aligned');
  const [isPortraitViewport, setIsPortraitViewport] = useState(false);
  const [nowJst, setNowJst] = useState(() => new Date());
  const [playbackTimecode, setPlaybackTimecode] = useState<PlaybackTimecode>(() => readPlaybackTimecode(null));
  const realtimeSnapshotRef = useRef<RealtimeTextSnapshot | null>(null);
  const settingsLoadedRef = useRef(false);
  const portraitPresetAppliedRef = useRef(false);
  const sourceTranscriptRef = useRef<HTMLDivElement | null>(null);
  const translationTranscriptRef = useRef<HTMLDivElement | null>(null);
  const realtimeEnabled = realtimeSnapshot?.enabled === true;
  const showTranscriptPanel = realtimeEnabled
    && transcriptOpen
    && realtimeConfig.mode !== 'subtitle'
    && (showSourceText || showTranslationText);
  const showSubtitleOverlay = realtimeEnabled && realtimeConfig.mode !== 'transcript';
  const realtimeSegments = realtimeSnapshot?.segments?.length
    ? realtimeSnapshot.segments
    : (debug && realtimeEnabled ? makePreviewSegments() : []);
  const configuredSubtitleOffsetMs = Math.max(0, subtitleOffsetSeconds || 0) * 1000;
  const realtimeTextWindow = findRealtimeTextWindow(
    realtimeSegments,
    realtimeSnapshot?.partial,
    nowJst,
    configuredSubtitleOffsetMs,
    playbackTimecode,
  );
  const activeRealtimeSegment = realtimeTextWindow.current;
  const subtitleTextPieces = buildSubtitleTextPieces(
    realtimeSegments,
    activeRealtimeSegment,
    !realtimeTextWindow.usedTimeline,
  );
  const showSubtitleText = Boolean(
    subtitleTextPieces.some(({ segment }) => (
      (showSourceText && segment.sourceText?.trim())
      || (showTranslationText && segment.translatedText?.trim())
    )),
  );
  const activeReceiveLag = formatLag(nowJst, activeRealtimeSegment?.receivedAt || activeRealtimeSegment?.updatedAt);
  const activeTranslationLag = activeRealtimeSegment?.translatedText
    ? formatLag(nowJst, activeRealtimeSegment.updatedAt)
    : '--s';
  const activeCaptureClock = formatIsoClockJst(activeRealtimeSegment?.timelineMeta?.capture_ended_at);
  const playbackLatencyLabel = playbackTimecode.latencyMs !== null ? formatMillis(playbackTimecode.latencyMs) : '--s';
  const playbackClockLabel = playbackTimecode.wallTimeMs !== null ? formatClockJst(playbackTimecode.wallTimeMs) : '--:--:--';
  const videoLatencyLabel = videoLatencyMode === 'low' ? '低延迟' : `目标 ${videoDelaySeconds}s`;
  const subtitlesVisible = showSourceText || showTranslationText;
  const subtitlePresetActive = videoLatencyMode === 'aligned' && subtitlesVisible && !transcriptOpen;
  const lowLatencyPresetActive = videoLatencyMode === 'low' && !subtitlesVisible && !transcriptOpen;
  const realtimeSettingsKey = `n2nj:realtime-text:${player.pId}`;
  const transcriptRows = realtimeSegments.map((segment, index) => {
    const intervalMs = realtimeConfig.cursorIntervalSeconds * 1000;
    const bucket = Math.floor(segment.startMs / intervalMs);
    const previous = realtimeSegments[index - 1];
    const previousBucket = previous ? Math.floor(previous.startMs / intervalMs) : null;
    return {
      segment,
      bucket,
      showMarker: realtimeConfig.cursorMarkers && bucket !== previousBucket,
      color: markerColor(bucket),
    };
  });

  // Determine poster image source - convert binary data to base64 on client side
  const getPosterImageSrc = () => {
    if (player.coverImage) {
      // Handle both ArrayBuffer (from SSR) and Array (from API)
      const uint8Array = Array.isArray(player.coverImage)
        ? new Uint8Array(player.coverImage)
        : new Uint8Array(player.coverImage as ArrayBuffer);
      const base64 = btoa(String.fromCharCode(...uint8Array));
      return `data:image/jpeg;base64,${base64}`;
    }
    return player.coverUrl || '';
  };

  const playerOption: Omit<Option, "container"> = {
    url: player.url,
    poster: getPosterImageSrc(),
    volume: 0.7,
    isLive: true,
    muted: false,
    autoplay: true,
    pip: false,
    autoSize: true,
    autoMini: true,
    screenshot: true,
    setting: true,
    loop: true,
    flip: true,
    playbackRate: true,
    aspectRatio: true,
    fullscreen: true,
    fullscreenWeb: true,
    subtitleOffset: true,
    miniProgressBar: true,
    mutex: true,
    backdrop: true,
    playsInline: true,
    autoPlayback: true,
    airplay: true,
    theme: '#00d4ff',
    lang: 'zh-cn',
    // Enable Info panel for bitrate/stats inspection
    info: true,
    hotkey: false, // Disable keyboard seeking
    moreVideoAttr: {
      crossOrigin: 'anonymous',
      // @ts-ignore
      'webkit-playsinline': true,
      // @ts-ignore
      playsInline: true,
    },
    // Pass debug config to specific plugins if supported
  };

  // If debug mode is on, we might want to expose HLS config
  // Note: ArtPlayer HLS logic is inside the customType 'm3u8' callback
  // We can't easily pass it there via option unless we modify the callback
  // But we use a ref or closure.

  const applySubtitlePreset = useCallback((closeControls = true) => {
    setVideoLatencyMode('aligned');
    setTranscriptOpen(false);
    setShowTranslationText(true);
    setShowSourceText(true);
    setShowTiming(false);
    setSubtitleOffsetSeconds(0);
    setSubtitleOpacity((value) => Math.max(value, isPortraitViewport ? 0.86 : 0.78));
    setSubtitleScale((value) => isPortraitViewport ? Math.min(value, 0.95) : value);
    setVideoDelaySeconds(realtimeConfig.videoDelaySeconds || DEFAULT_ALIGNED_VIDEO_DELAY_SECONDS);
    reloadHlsForLatencyMode(artPlayerRef.current, 'aligned');
    if (closeControls) {
      setRealtimeControlsOpen(false);
    }
  }, [isPortraitViewport, realtimeConfig.videoDelaySeconds]);

  const applyLowLatencyPreset = useCallback((closeControls = true) => {
    setVideoLatencyMode('low');
    setShowTranslationText(false);
    setShowSourceText(false);
    setShowTiming(false);
    setTranscriptOpen(false);
    setSubtitleOffsetSeconds(0);
    setVideoDelaySeconds(0);
    reloadHlsForLatencyMode(artPlayerRef.current, 'low');
    if (closeControls) {
      setRealtimeControlsOpen(false);
    }
  }, []);

  const toggleRealtimeSubtitles = useCallback(() => {
    if (subtitlesVisible) {
      setShowTranslationText(false);
      setShowSourceText(false);
      setShowTiming(false);
      setTranscriptOpen(false);
      return;
    }
    applySubtitlePreset(false);
  }, [applySubtitlePreset, subtitlesVisible]);

  // React to URL changes (e.g. Offline -> Live)
  useEffect(() => {
    if (artPlayerRef.current && player.url && player.url !== artPlayerRef.current.option.url) {
      console.log("🔄 Switching URL to:", player.url);
      artPlayerRef.current.switchUrl(player.url);
      artPlayerRef.current.option.url = player.url;

      // Auto-play if not offline
      if (player.url !== 'http://offline' && player.url !== 'https://offline') {
        artPlayerRef.current.play();
      }
    }
  }, [player.url]);

  useEffect(() => {
    setDisplayName(player.name);
    setRenameDraft(player.name);
    setRenameError('');
  }, [player.name]);

  useEffect(() => {
    const updateOrientation = () => {
      setIsPortraitViewport(
        window.innerWidth <= MOBILE_PORTRAIT_BREAKPOINT
        && window.innerHeight > window.innerWidth,
      );
    };

    updateOrientation();
    window.addEventListener('resize', updateOrientation);
    window.addEventListener('orientationchange', updateOrientation);
    return () => {
      window.removeEventListener('resize', updateOrientation);
      window.removeEventListener('orientationchange', updateOrientation);
    };
  }, []);

  useEffect(() => {
    if (!settingsLoadedRef.current || !realtimeEnabled || videoLatencyMode !== 'aligned') {
      return;
    }

    if (!isPortraitViewport) {
      portraitPresetAppliedRef.current = false;
      return;
    }

    if (portraitPresetAppliedRef.current) {
      return;
    }

    portraitPresetAppliedRef.current = true;
    setTranscriptOpen(false);
    setShowSourceText(true);
    setShowTranslationText(true);
    setShowTiming(false);
    setSubtitleScale((value) => Math.min(value, 0.95));
    setSubtitleOpacity((value) => Math.max(value, 0.86));
  }, [isPortraitViewport, realtimeEnabled, videoLatencyMode]);

  useEffect(() => {
    window.addEventListener('n2nj:toggle-realtime-subtitles', toggleRealtimeSubtitles);
    return () => window.removeEventListener('n2nj:toggle-realtime-subtitles', toggleRealtimeSubtitles);
  }, [toggleRealtimeSubtitles]);

  useEffect(() => {
    if (settingsLoadedRef.current) {
      return;
    }
    setSubtitleOpacity(realtimeConfig.subtitleOpacity);
    setSubtitleScale(realtimeConfig.subtitleScale);
    setTranscriptOpen(realtimeConfig.transcriptPanel);
    setShowSourceText(realtimeConfig.showSource);
    setShowTranslationText(realtimeConfig.showTranslation);
    setShowTiming(realtimeConfig.showTiming);
    setVideoDelaySeconds(realtimeConfig.videoDelaySeconds || DEFAULT_ALIGNED_VIDEO_DELAY_SECONDS);
    setSubtitleOffsetSeconds(0);
  }, [
    realtimeConfig.subtitleOpacity,
    realtimeConfig.subtitleScale,
    realtimeConfig.transcriptPanel,
    realtimeConfig.showSource,
    realtimeConfig.showTranslation,
    realtimeConfig.showTiming,
    realtimeConfig.videoDelaySeconds,
  ]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const art = artPlayerRef.current;
      const nextPlaybackTimecode = readPlaybackTimecode(art);
      setNowJst(new Date());
      setPlaybackTimecode(nextPlaybackTimecode);
      if (videoLatencyMode === 'aligned') {
        tunePlaybackLatency(art, videoLatencyMode, nextPlaybackTimecode, videoDelaySeconds);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [videoDelaySeconds, videoLatencyMode]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(realtimeSettingsKey);
      const params = new URLSearchParams(window.location.search);
      const preset = params.get('preset') || params.get('view');
      const latency = params.get('latency');
      const subtitle = params.get('subtitle');

      if (raw) {
        const stored = JSON.parse(raw) as StoredRealtimeSettings;
        if (typeof stored.transcriptOpen === 'boolean') {
          setTranscriptOpen(stored.transcriptOpen);
        }
        if (typeof stored.showSourceText === 'boolean') {
          setShowSourceText(stored.showSourceText);
        }
        if (typeof stored.showTranslationText === 'boolean') {
          setShowTranslationText(stored.showTranslationText);
        }
        if (typeof stored.showTiming === 'boolean') {
          setShowTiming(stored.showTiming);
        }
        if (typeof stored.subtitleOffsetSeconds === 'number') {
          setSubtitleOffsetSeconds(clampUiNumber(stored.subtitleOffsetSeconds, 0, 0, 30));
        } else if (typeof stored.subtitleDelaySeconds === 'number') {
          setSubtitleOffsetSeconds(clampUiNumber(stored.subtitleDelaySeconds, 0, 0, 30));
        }
        if (typeof stored.videoDelaySeconds === 'number') {
          setVideoDelaySeconds(clampUiNumber(
            stored.videoDelaySeconds,
            realtimeConfig.videoDelaySeconds || DEFAULT_ALIGNED_VIDEO_DELAY_SECONDS,
            0,
            45,
          ));
        }
        if (typeof stored.subtitleOpacity === 'number') {
          setSubtitleOpacity(clampUiNumber(stored.subtitleOpacity, realtimeConfig.subtitleOpacity, 0.2, 1));
        }
        if (typeof stored.subtitleScale === 'number') {
          setSubtitleScale(clampUiNumber(stored.subtitleScale, realtimeConfig.subtitleScale, 0.8, 1.5));
        }
        if (stored.videoLatencyMode === 'low') {
          setVideoLatencyMode('low');
        } else if (stored.videoLatencyMode === 'aligned' || stored.videoLatencyMode === 'normal') {
          setVideoLatencyMode('aligned');
        }
      } else if (preset !== 'aligned' && preset !== 'low' && latency !== 'low' && subtitle !== 'off' && subtitle !== 'on') {
        setVideoLatencyMode('aligned');
        setTranscriptOpen(false);
        setShowSourceText(true);
        setShowTranslationText(true);
        setShowTiming(false);
        setSubtitleOffsetSeconds(0);
        setVideoDelaySeconds(realtimeConfig.videoDelaySeconds || DEFAULT_ALIGNED_VIDEO_DELAY_SECONDS);
      }
      if (preset === 'low' || latency === 'low' || subtitle === 'off') {
        setVideoLatencyMode('low');
        setShowTranslationText(false);
        setShowSourceText(false);
        setShowTiming(false);
        setTranscriptOpen(false);
        setSubtitleOffsetSeconds(0);
        setVideoDelaySeconds(0);
      } else if (preset === 'aligned' || subtitle === 'on') {
        setVideoLatencyMode('aligned');
        setShowTranslationText(true);
        setShowSourceText(true);
        setShowTiming(true);
        setTranscriptOpen(false);
        setSubtitleOffsetSeconds(0);
        setVideoDelaySeconds(realtimeConfig.videoDelaySeconds || DEFAULT_ALIGNED_VIDEO_DELAY_SECONDS);
      }
    } catch (error) {
      console.warn('Realtime text settings unavailable', error);
    } finally {
      settingsLoadedRef.current = true;
    }
  }, [realtimeConfig.transcriptPanel, realtimeConfig.videoDelaySeconds, realtimeSettingsKey]);

  useEffect(() => {
    if (!settingsLoadedRef.current) {
      return;
    }
    const stored: StoredRealtimeSettings = {
      version: REALTIME_SETTINGS_VERSION,
      transcriptOpen,
      showSourceText,
      showTranslationText,
      showTiming,
      subtitleOffsetSeconds,
      videoDelaySeconds,
      subtitleOpacity,
      subtitleScale,
      videoLatencyMode,
    };
    try {
      window.localStorage.setItem(realtimeSettingsKey, JSON.stringify(stored));
    } catch (error) {
      console.warn('Realtime text settings could not be saved', error);
    }
  }, [
    realtimeSettingsKey,
    transcriptOpen,
    showSourceText,
    showTranslationText,
    showTiming,
    subtitleOffsetSeconds,
    videoDelaySeconds,
    subtitleOpacity,
    subtitleScale,
    videoLatencyMode,
  ]);

  useEffect(() => {
    for (const element of [sourceTranscriptRef.current, translationTranscriptRef.current]) {
      if (!element) {
        continue;
      }
      element.scrollTop = element.scrollHeight;
      element.scrollLeft = 0;
    }
  }, [realtimeSnapshot?.revision, showSourceText, showTranslationText]);

  useEffect(() => {
    realtimeSnapshotRef.current = realtimeSnapshot;
  }, [realtimeSnapshot]);

  useEffect(() => {
    let disposed = false;
    let eventSource: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let pollTimer: number | null = null;
    let reconnectAttempt = 0;
    const params = debug && debugRealtimeEnabled ? '?force=1' : '';
    const snapshotUrl = `/api/players/by-pid/${encodeURIComponent(player.pId)}/realtime-text${params}`;
    const eventsUrl = `/api/players/by-pid/${encodeURIComponent(player.pId)}/realtime-text/events${params}`;
    const urlParams = new URLSearchParams(window.location.search);
    const useRealtimeEvents = urlParams.get('events') === '1' || urlParams.get('transport') === 'sse';

    const applySnapshot = (snapshot: RealtimeTextSnapshot) => {
      if (disposed) {
        return;
      }
      const currentRevision = realtimeSnapshotRef.current?.revision || '';
      const nextRevision = snapshot.revision || '';
      if (!realtimeSnapshotRef.current || nextRevision !== currentRevision || snapshot.generatedAt !== realtimeSnapshotRef.current.generatedAt) {
        realtimeSnapshotRef.current = snapshot;
        setRealtimeSnapshot(snapshot);
      }
    };

    const fetchSnapshot = async (signal?: AbortSignal) => {
      try {
        const response = await fetch(snapshotUrl, {
          cache: 'no-store',
          signal,
        });
        if (!response.ok) {
          return;
        }
        applySnapshot(await response.json() as RealtimeTextSnapshot);
      } catch (error) {
        if (!disposed && !(error instanceof DOMException && error.name === 'AbortError')) {
          console.warn('Realtime text snapshot unavailable', error);
        }
      }
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== null) {
        return;
      }
      const delayMs = Math.min(15000, 1000 * (2 ** Math.min(reconnectAttempt, 4)));
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connectEvents();
      }, delayMs);
    };

    const connectEvents = () => {
      if (disposed) {
        return;
      }
      eventSource?.close();
      eventSource = new EventSource(eventsUrl);

      eventSource.addEventListener('open', () => {
        reconnectAttempt = 0;
      });

      eventSource.addEventListener('snapshot', (event) => {
        try {
          applySnapshot(JSON.parse(event.data) as RealtimeTextSnapshot);
        } catch (error) {
          console.warn('Invalid realtime text event', error);
        }
      });

      eventSource.onerror = () => {
        eventSource?.close();
        eventSource = null;
        scheduleReconnect();
      };
    };

    const initialController = new AbortController();
    void fetchSnapshot(initialController.signal);

    if (useRealtimeEvents) {
      connectEvents();
      pollTimer = window.setInterval(() => {
        void fetchSnapshot();
      }, 15000);
    } else {
      pollTimer = window.setInterval(() => {
        void fetchSnapshot();
      }, REALTIME_SNAPSHOT_POLL_MS);
    }

    return () => {
      disposed = true;
      initialController.abort();
      eventSource?.close();
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
      }
    };
  }, [debug, debugRealtimeEnabled, player.pId]);

  const handleQuickRename = async () => {
    const nextName = renameDraft.trim();
    if (!nextName || nextName === displayName) {
      setRenameExpanded(false);
      setRenameError('');
      return;
    }

    setRenameSaving(true);
    setRenameError('');
    try {
      const response = await fetch(`/api/players/by-pid/${encodeURIComponent(player.pId)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: nextName,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Rename failed: ${response.status}`);
      }

      setDisplayName(nextName);
      setRenameExpanded(false);
      router.refresh();
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : '快速更名失败');
    } finally {
      setRenameSaving(false);
    }
  };


  return (
    <div className="flex flex-col h-screen">
      <header className="text-black p-2 z-10 flex items-start justify-between gap-2 sm:p-4" style={{ backgroundColor: '#d1e5fc' }}>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 sm:gap-x-4">
            <Link
              href="/"
              className="shrink-0 text-sm text-blue-600 transition-colors hover:text-blue-800 sm:text-base"
            >
              ← 返回首页
            </Link>
            <h1 className="min-w-0 text-base font-bold sm:text-xl">
              <ObfuscatedText
                text={displayName}
                playerId={player.pId}
                variant="pageTitle"
                className="block text-base leading-tight sm:text-xl"
              />
            </h1>
          </div>
          {player.description && (
            <p className="mt-1 hidden text-sm text-gray-700 sm:block">
              <ObfuscatedText
                text={player.description}
                variant="pageBody"
                className="block leading-6"
              />
            </p>
          )}
          {(realtimeEnabled || debug) && (
            <div className="mt-2 flex w-full max-w-[24rem] overflow-hidden rounded-lg border border-slate-400/50 bg-white/65 p-0.5 text-xs font-semibold shadow-sm sm:w-auto sm:max-w-none sm:text-sm">
              <button
                type="button"
                onClick={() => applyLowLatencyPreset()}
                className={`min-w-0 flex-1 rounded-md px-3 py-1.5 transition ${
                  lowLatencyPresetActive
                    ? 'bg-slate-950 text-white shadow-sm'
                    : 'text-slate-700 hover:bg-white/90'
                }`}
              >
                低延迟
              </button>
              <button
                type="button"
                onClick={() => applySubtitlePreset()}
                className={`min-w-0 flex-1 rounded-md px-3 py-1.5 transition ${
                  subtitlePresetActive
                    ? 'bg-cyan-600 text-white shadow-sm'
                    : 'text-slate-700 hover:bg-white/90'
                }`}
              >
                字幕
              </button>
            </div>
          )}
          {user?.role === 'admin' && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {!renameExpanded && (
                <button
                  type="button"
                  onClick={() => setRenameExpanded(true)}
                  className="rounded-xl border border-slate-300 bg-white/85 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-white"
                >
                  快速更名
                </button>
              )}
              {renameExpanded && (
                <>
                  <input
                    value={renameDraft}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    placeholder="输入新的显示名称"
                    className="min-w-[16rem] rounded-xl border border-slate-300 bg-white/92 px-3 py-1.5 text-sm text-slate-900 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void handleQuickRename()}
                    disabled={renameSaving}
                    className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {renameSaving ? '保存中...' : '保存'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRenameExpanded(false);
                      setRenameDraft(displayName);
                      setRenameError('');
                    }}
                    disabled={renameSaving}
                    className="rounded-xl border border-slate-300 bg-white/85 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    取消
                  </button>
                </>
              )}
              {renameError && (
                <span className="text-xs text-rose-600">{renameError}</span>
              )}
            </div>
          )}
        </div>
        <ProtectedOutboundLink
          linkId="qq-group"
          title="打开群组入口"
          newTab={false}
          className="hidden shrink-0 rounded-2xl p-1 transition hover:bg-white/50 sm:block"
        >
          <img
            src="/logo.png"
            alt="N2NJ Logo"
            className={`${player.description ? 'h-20' : 'h-12'} w-auto opacity-80 transition-all duration-300`}
          />
        </ProtectedOutboundLink>
      </header>

      <div className="flex-1 bg-black relative min-h-0">
        <div className="flex h-full min-h-0">
          <div className="group/realtime relative min-w-0 flex-1">
            <_Artplayer
              // [FIX] Force remount when player config is updated to reflect source changes
              key={player.updatedAt?.toString() || player.id}
              option={playerOption}
              getInstance={(art) => {
                artPlayerRef.current = art;
              }}
              debug={debug}
              player={player}
              className="w-full h-full flex"
              style={{ minHeight: '400px' }}
            />

            {realtimeEnabled && (
              <button
                type="button"
                onClick={toggleRealtimeSubtitles}
                className="pointer-events-auto absolute left-3 top-3 z-30 rounded border border-white/20 bg-black/54 px-2 py-1 text-[11px] font-semibold text-white shadow-lg backdrop-blur transition hover:bg-black/72 sm:hidden"
                title="开关实时字幕"
              >
                字幕{subtitlesVisible ? '开' : '关'}
              </button>
            )}

            {showSubtitleOverlay && showSubtitleText && (
              <div
                className="pointer-events-none absolute inset-x-2 bottom-14 z-20 flex justify-center sm:inset-x-6 sm:bottom-16"
                style={{ opacity: subtitleOpacity }}
              >
                <div
                  className="max-h-[34vh] w-full max-w-[min(96%,1080px)] overflow-hidden rounded border border-white/10 bg-black/68 px-3 py-2 font-normal leading-snug text-white shadow-lg backdrop-blur-sm [overflow-wrap:anywhere] [word-break:keep-all] sm:px-4"
                  style={{ fontSize: `${(isPortraitViewport ? 0.9 : 0.96) * subtitleScale}rem` }}
                >
                  {showSourceText && (
                    <div className="text-left text-[0.9em]">
                      {subtitleTextPieces.map(({ segment, color, isCurrent }) => (
                        <span
                          key={`overlay-source-${segment.id}`}
                          className={isCurrent ? 'font-bold text-white' : 'font-light'}
                          style={{ color: isCurrent ? undefined : color }}
                        >
                          {segment.sourceText || ''}
                          {segment.sourceText?.trim() ? <span className="text-white/20"> </span> : null}
                        </span>
                      ))}
                    </div>
                  )}
                  {showTranslationText && (
                    <div className={`${showSourceText ? 'mt-1 border-t border-white/10 pt-1' : ''} text-left text-[0.98em]`}>
                      {subtitleTextPieces.map(({ segment, color, isCurrent }) => (
                        <span
                          key={`overlay-translation-${segment.id}`}
                          className={segment.translatedText ? (isCurrent ? 'font-bold text-white' : 'font-light') : 'text-white/20'}
                          style={{ color: isCurrent || !segment.translatedText ? undefined : color }}
                        >
                          {segment.translatedText || ''}
                          {segment.translatedText?.trim() ? <span className="text-white/20"> </span> : null}
                        </span>
                      ))}
                    </div>
                  )}
                  {showTiming && realtimeConfig.showTiming && activeRealtimeSegment && (
                    <div className="mt-1 text-[0.66em] font-medium text-white/58">
                      JST {formatClockJst(nowJst)} · 播 {playbackClockLabel} · 画面 {videoLatencyLabel}/{playbackLatencyLabel} · 字幕 {realtimeTextWindow.usedTimeline ? '时间码' : '最新段'} +{subtitleOffsetSeconds}s · 采 {activeCaptureClock} · 收 {activeReceiveLag}
                    </div>
                  )}
                </div>
              </div>
            )}

            {(realtimeEnabled || debug) && (
              <div className="absolute right-3 top-3 z-30 max-w-[calc(100%-1.5rem)] text-xs text-white">
                {!realtimeControlsOpen && (
                  <button
                    type="button"
                    onClick={() => setRealtimeControlsOpen(true)}
                    className="rounded border border-white/20 bg-black/54 px-2 py-1 text-[11px] opacity-0 shadow-lg backdrop-blur transition hover:bg-black/72 hover:opacity-100 focus:opacity-100 group-hover/realtime:opacity-70"
                    title="显示实时字幕设置"
                  >
                    字幕
                  </button>
                )}
                {realtimeControlsOpen && (
                  <div className="flex flex-wrap items-center gap-2 rounded bg-black/62 px-3 py-2 shadow-lg backdrop-blur">
                {debug && !realtimeConfig.enabled && (
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={debugRealtimeEnabled}
                      onChange={(event) => setDebugRealtimeEnabled(event.target.checked)}
                    />
                    <span>实时文本预览</span>
                  </label>
                )}
                {realtimeEnabled && (
                  <>
                    <button
                      type="button"
                      onClick={() => applySubtitlePreset(false)}
                      className={`rounded border px-2 py-1 transition ${
                        subtitlePresetActive && videoDelaySeconds < DEFAULT_STABLE_VIDEO_DELAY_SECONDS
                          ? 'border-cyan-300 bg-cyan-300/24 text-cyan-50'
                          : 'border-white/24 bg-white/12 hover:bg-white/22'
                      }`}
                    >
                      对齐字幕
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setVideoLatencyMode('aligned');
                        setTranscriptOpen(true);
                        setShowSourceText(true);
                        setShowTranslationText(true);
                        setShowTiming(true);
                        setVideoDelaySeconds(Math.max(videoDelaySeconds, DEFAULT_ALIGNED_VIDEO_DELAY_SECONDS));
                        reloadHlsForLatencyMode(artPlayerRef.current, 'aligned');
                      }}
                      className={`rounded border px-2 py-1 transition ${
                        videoLatencyMode === 'aligned' && transcriptOpen
                          ? 'border-cyan-300 bg-cyan-300/24 text-cyan-50'
                          : 'border-white/24 bg-white/12 hover:bg-white/22'
                      }`}
                    >
                      侧窗
                    </button>
                    <button
                      type="button"
                      onClick={() => applyLowLatencyPreset()}
                      className={`rounded border px-2 py-1 transition ${
                        lowLatencyPresetActive
                          ? 'border-cyan-300 bg-cyan-300/24 text-cyan-50'
                          : 'border-white/24 bg-white/12 hover:bg-white/22'
                      }`}
                    >
                      画面最低延迟
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setVideoLatencyMode('aligned');
                        setShowTranslationText(true);
                        setShowSourceText(true);
                        setShowTiming(false);
                        setTranscriptOpen(false);
                        setSubtitleOffsetSeconds(0);
                        setVideoDelaySeconds(DEFAULT_STABLE_VIDEO_DELAY_SECONDS);
                        reloadHlsForLatencyMode(artPlayerRef.current, 'aligned');
                      }}
                      className={`rounded border px-2 py-1 transition ${
                        videoLatencyMode === 'aligned' && showTranslationText && showSourceText && !transcriptOpen && videoDelaySeconds >= DEFAULT_STABLE_VIDEO_DELAY_SECONDS
                          ? 'border-cyan-300 bg-cyan-300/24 text-cyan-50'
                          : 'border-white/24 bg-white/12 hover:bg-white/22'
                      }`}
                    >
                      稳定双语
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowTranslationText(false);
                        setShowSourceText(false);
                        setShowTiming(false);
                        setTranscriptOpen(false);
                      }}
                      className={`rounded border px-2 py-1 transition ${
                        !showSourceText && !showTranslationText
                          ? 'border-cyan-300 bg-cyan-300/24 text-cyan-50'
                          : 'border-white/24 bg-white/12 hover:bg-white/22'
                      }`}
                    >
                      关字幕
                    </button>
                    {[5, 10, 15].map((seconds) => (
                      <button
                        key={seconds}
                        type="button"
                        onClick={() => {
                          setVideoDelaySeconds(seconds);
                          setVideoLatencyMode('aligned');
                          setShowTranslationText(true);
                          setShowSourceText(true);
                          reloadHlsForLatencyMode(artPlayerRef.current, 'aligned');
                        }}
                        className={`rounded border px-2 py-1 transition ${
                          videoDelaySeconds === seconds && videoLatencyMode === 'aligned'
                            ? 'border-cyan-300 bg-cyan-300/24 text-cyan-50'
                            : 'border-white/24 bg-white/12 hover:bg-white/22'
                        }`}
                      >
                        {seconds}s
                      </button>
                    ))}
                    <label className="inline-flex items-center gap-2 border-l border-white/20 pl-2">
                      <span>画面</span>
                      <input
                        type="range"
                        min="3"
                        max="25"
                        step="1"
                        value={videoDelaySeconds}
                        onChange={(event) => {
                          setVideoDelaySeconds(Number(event.target.value));
                          setVideoLatencyMode('aligned');
                          setShowTranslationText(true);
                          setShowSourceText(true);
                        }}
                        className="w-20"
                      />
                      <span className="tabular-nums">{videoDelaySeconds}s</span>
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <span>字</span>
                      <input
                        type="range"
                        min="0.8"
                        max="1.5"
                        step="0.05"
                        value={subtitleScale}
                        onChange={(event) => setSubtitleScale(Number(event.target.value))}
                        className="w-16"
                      />
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <span>透明</span>
                      <input
                        type="range"
                        min="0.2"
                        max="1"
                        step="0.05"
                        value={subtitleOpacity}
                        onChange={(event) => setSubtitleOpacity(Number(event.target.value))}
                        className="w-16"
                      />
                    </label>
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={showTranslationText}
                        onChange={(event) => setShowTranslationText(event.target.checked)}
                      />
                      <span>译文</span>
                    </label>
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={showSourceText}
                        onChange={(event) => setShowSourceText(event.target.checked)}
                      />
                      <span>原文</span>
                    </label>
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={showTiming}
                        onChange={(event) => setShowTiming(event.target.checked)}
                      />
                      <span>时间</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setRealtimeControlsOpen(false)}
                      className="rounded border border-white/24 bg-white/12 px-2 py-1 transition hover:bg-white/22"
                    >
                      隐藏控件
                    </button>
                  </>
                )}
                  </div>
                )}
              </div>
            )}
          </div>

          {showTranscriptPanel && (
            <aside className="hidden w-[430px] shrink-0 border-l border-white/10 bg-slate-950/96 text-slate-100 xl:flex xl:flex-col">
              <div className="border-b border-white/10 px-3 py-2">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-semibold text-slate-100">实时字幕时间轴</span>
                  <span className="text-slate-400">{realtimeConfig.sourceLanguage} / {realtimeConfig.targetLanguage}</span>
                </div>
                {showTiming && realtimeConfig.showTiming && (
                  <div className="mt-1 truncate text-[11px] text-slate-400">
                    JST {formatClockJst(nowJst)} · 播 {playbackClockLabel} · 画面 {videoLatencyLabel}/{playbackLatencyLabel} · 字幕 {realtimeTextWindow.usedTimeline ? '时间码' : '最新段'} +{subtitleOffsetSeconds}s
                  </div>
                )}
              </div>

              {realtimeSegments.length === 0 && (
                <div className="px-3 py-4 text-xs text-slate-500">转写后端尚未接入。</div>
              )}

              {showSourceText && (
                <section className="min-h-0 flex-1 border-b border-white/10">
                  <div className="flex items-center justify-between px-3 py-1.5 text-[11px] font-medium text-slate-400">
                    <span>原文</span>
                    <span>{activeCaptureClock}</span>
                  </div>
                  <div ref={sourceTranscriptRef} className="h-[calc(100%-28px)] overflow-x-hidden overflow-y-auto px-3 pb-2 font-mono text-[12px] leading-6">
                    <p className="whitespace-normal text-slate-200 [overflow-wrap:anywhere] [word-break:keep-all]" lang="ja">
                      {transcriptRows.map(({ segment, bucket, showMarker, color }) => (
                        <span key={`source-${segment.id}`}>
                          {showMarker && (
                            <span
                              className="mx-1 inline-flex items-center rounded px-1 text-[10px] tabular-nums text-slate-950"
                              style={{ backgroundColor: color }}
                            >
                              +{formatDuration(bucket * realtimeConfig.cursorIntervalSeconds * 1000)}
                            </span>
                          )}
                          <span
                            className="rounded-sm px-0.5"
                            style={{ backgroundColor: showMarker ? `${color}18` : 'transparent' }}
                          >
                            {segment.sourceText || ''}
                          </span>
                          {segment.sourceText?.trim() && (
                            <span className="mx-1 text-slate-500/55">/</span>
                          )}
                        </span>
                      ))}
                    </p>
                  </div>
                </section>
              )}

              {showTranslationText && (
                <section className="min-h-0 flex-1">
                  <div className="flex items-center justify-between px-3 py-1.5 text-[11px] font-medium text-slate-400">
                    <span>中文</span>
                    <span>译 {activeTranslationLag}</span>
                  </div>
                  <div ref={translationTranscriptRef} className="h-[calc(100%-28px)] overflow-x-hidden overflow-y-auto px-3 pb-2 font-mono text-[12px] leading-6">
                    <p className="whitespace-normal text-slate-100 [overflow-wrap:anywhere] [word-break:keep-all]" lang="zh-CN">
                      {transcriptRows.map(({ segment, bucket, showMarker, color }) => (
                        <span key={`translation-${segment.id}`}>
                          {showMarker && (
                            <span
                              className="mx-1 inline-flex items-center rounded px-1 text-[10px] tabular-nums text-slate-950"
                              style={{ backgroundColor: color }}
                            >
                              +{formatDuration(bucket * realtimeConfig.cursorIntervalSeconds * 1000)}
                            </span>
                          )}
                          <span
                            className={`rounded-sm px-0.5 ${segment.translatedText ? '' : 'text-slate-600'}`}
                            style={{ backgroundColor: showMarker ? `${color}18` : 'transparent' }}
                          >
                            {segment.translatedText || ''}
                          </span>
                          {segment.translatedText?.trim() && (
                            <span className="mx-1 text-slate-500/55">/</span>
                          )}
                        </span>
                      ))}
                    </p>
                  </div>
                </section>
              )}
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
