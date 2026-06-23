'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

const MUTE_ICON_HTML = '<svg xmlns="http://www.w3.org/2000/svg" height="22" width="22" viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4zm13.5 3a4.5 4.5 0 0 0-2.5-4.03v8.05A4.5 4.5 0 0 0 17.5 12zm-2.5-8.5v2.06a7 7 0 0 1 0 12.88v2.06a9 9 0 0 0 0-17z" fill="currentColor"/></svg>';
const MUTED_ICON_HTML = '<svg xmlns="http://www.w3.org/2000/svg" height="22" width="22" viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4zm12.59 3-2.3-2.29 1.42-1.42L18 10.59l2.29-2.3 1.42 1.42L19.41 12l2.3 2.29-1.42 1.42L18 13.41l-2.29 2.3-1.42-1.42L16.59 12z" fill="currentColor"/></svg>';
const muteControlListeners = new WeakMap<HTMLElement, EventListener>();
const LIVE_SYNC_EDGE_SAFETY_SECONDS = 0.35;

function renderMuteControl(art: Artplayer, element: HTMLElement) {
  const muted = art.video.muted || art.video.volume <= 0;
  element.innerHTML = muted ? MUTED_ICON_HTML : MUTE_ICON_HTML;
  element.title = muted ? '取消静音' : '静音';
}

function requestLivePlayback(art: Artplayer) {
  if (!art.option.isLive) {
    return;
  }
  if (!art.video.paused && !art.video.ended) {
    return;
  }
  const url = String(art.option.url || '');
  if (url === 'http://offline' || url === 'https://offline') {
    return;
  }

  const playResult = art.play();
  void Promise.resolve(playResult).catch(() => {
    art.notice.show = '浏览器阻止自动播放，请点一下播放';
  });
}

function getLiveSyncTargetTime(art: Artplayer) {
  const video = art.video;
  const hls = (art as any).hls as Hls | undefined;
  const hlsLiveSyncPosition = typeof hls?.liveSyncPosition === 'number' && Number.isFinite(hls.liveSyncPosition)
    ? hls.liveSyncPosition
    : null;
  const seekable = video.seekable;

  if (!seekable.length) {
    return hlsLiveSyncPosition;
  }

  const seekableStart = seekable.start(seekable.length - 1);
  const seekableEnd = seekable.end(seekable.length - 1);
  if (!Number.isFinite(seekableStart) || !Number.isFinite(seekableEnd) || seekableEnd <= seekableStart) {
    return hlsLiveSyncPosition;
  }

  const safeEdge = Math.max(seekableStart, seekableEnd - LIVE_SYNC_EDGE_SAFETY_SECONDS);
  const wantedTime = hlsLiveSyncPosition ?? safeEdge;
  return Math.min(safeEdge, Math.max(seekableStart, wantedTime));
}

function syncLivePlayback(art: Artplayer, showNotice = false) {
  if (!art.option.isLive) {
    return false;
  }
  const video = art.video;
  const targetTime = getLiveSyncTargetTime(art);
  let didSeek = false;

  if (typeof targetTime === 'number' && Number.isFinite(targetTime) && Number.isFinite(video.currentTime)) {
    if (Math.abs(targetTime - video.currentTime) >= LIVE_SYNC_EDGE_SAFETY_SECONDS) {
      video.currentTime = targetTime;
      didSeek = true;
    }
  }

  if (video.playbackRate !== 1) {
    video.playbackRate = 1;
  }

  requestLivePlayback(art);
  if (showNotice) {
    art.notice.show = didSeek ? '画面已同步' : '已在同步点';
  }
  return didSeek;
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
        const realtimeVideoMode = readInitialRealtimeVideoMode();
        const hlsLatencyConfig = realtimeVideoMode === 'low'
          ? LOW_LATENCY_HLS_CONFIG
          : makeAlignedHlsConfig(readInitialRealtimeVideoDelaySeconds());
        const hls = new Hls({
          debug: debug, // Enable debug if requested
          autoStartLoad: false,
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
            let loadedManifestLevels: any[] = [];

            hls.on(Hls.Events.MANIFEST_LOADED, (_event, data) => {
              loadedManifestLevels = Array.isArray(data.levels) ? data.levels : [];
              updateStreamServRelayVariantControl(art, hls, loadedManifestLevels);
            });

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              // Trigger UI update for plugins that depend on parsed metadata
              if (art.plugins.artplayerPluginHlsControl) {
                (art.plugins.artplayerPluginHlsControl as any).update();
              }
              updateStreamServRelayVariantControl(art, hls, loadedManifestLevels);
              setTimeout(() => updateStreamServRelayVariantControl(art, hls, loadedManifestLevels), 100);
              let hasStartedLoad = false;
              const selectAndStart = (levelIndex: number) => {
                applyHlsLevelSelection(hls, levelIndex);
                hasStartedLoad = true;
              };

              const safeSourceIndex = findHevcUnsafeStreamServSourceLevelIndex(hls.levels, loadedManifestLevels);
              if (safeSourceIndex !== -1) {
                selectAndStart(safeSourceIndex);
                saveQuality('auto');
                updateStreamServRelayVariantControl(art, hls, loadedManifestLevels);
                requestLivePlayback(art);
                return;
              }

              if (saved && saved !== 'auto') {
                const levelIndex = resolveSavedLevelIndex(hls.levels, saved);
                if (levelIndex !== -1 && isLevelPlayableInCurrentBrowser(hls.levels[levelIndex])) {
                  selectAndStart(levelIndex);
                  saveQuality(makeQualityLevelKey(hls.levels[levelIndex], levelIndex));
                }
              }

              if (!hasStartedLoad) {
                const streamServSourceIndex = findStreamServAutoSourceLevelIndex(hls.levels, loadedManifestLevels);
                if (streamServSourceIndex !== -1) {
                  selectAndStart(streamServSourceIndex);
                  saveQuality(saved === 'auto' ? 'auto' : makeQualityLevelKey(hls.levels[streamServSourceIndex], streamServSourceIndex));
                } else if (saved === 'auto') {
                  selectAndStart(-1);
                } else {
                  const h264Index = findPreferredH264LevelIndex(hls.levels);
                  if (h264Index !== -1) {
                    selectAndStart(h264Index);
                    saveQuality(makeQualityLevelKey(hls.levels[h264Index], h264Index));
                  }
                }
              }

              if (!hasStartedLoad) {
                selectAndStart(-1);
              }
              requestLivePlayback(art);
              scheduleStreamServSourceFallbackIfStalled(art, hls, loadedManifestLevels);
            });

            // Listen for changes
            hls.on(Hls.Events.LEVEL_SWITCHING, (event, data) => {
              // Verify if it's manual or auto
              if (hls.autoLevelEnabled) {
                saveQuality('auto');

                // [FEATURE] Update Quality Control Text to show actual quality
                const level = hls.levels[data.level];
                if (level) {
                  const label = `自动: ${makeQualityLevelLabel(level, data.level)}`;

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
                  saveQuality(makeQualityLevelKey(hls.levels[data.level], data.level));
                }
              }
              setTimeout(() => updateStreamServRelayVariantControl(art, hls, loadedManifestLevels), 0);
            });

            hls.on(Hls.Events.LEVEL_SWITCHED, () => {
              updateStreamServRelayVariantControl(art, hls, loadedManifestLevels);
            });

            hls.on(Hls.Events.ERROR, (_event, data) => {
              if (!data?.fatal || data.type !== Hls.ErrorTypes.MEDIA_ERROR) {
                return;
              }
              const sourceIndex = findStreamServSourceLevelIndex(hls.levels, loadedManifestLevels);
              if (sourceIndex === -1 || hls.currentLevel === sourceIndex) {
                return;
              }
              const currentLevel = hls.currentLevel >= 0 ? hls.levels[hls.currentLevel] : null;
              if (hls.currentLevel === -1 || !currentLevel || getLevelCodecLabel(currentLevel) === 'HEVC') {
                applyHlsLevelSelection(hls, sourceIndex);
                saveQuality(makeQualityLevelKey(hls.levels[sourceIndex], sourceIndex));
                hls.recoverMediaError();
                requestLivePlayback(art);
                updateStreamServRelayVariantControl(art, hls, loadedManifestLevels);
              }
            });
          }
        },
      },
      controls: [
        {
          name: 'mute-toggle',
          index: 19,
          position: 'right',
          html: MUTE_ICON_HTML,
          tooltip: '静音',
          click: function (this: Artplayer, component) {
            if (this.video.muted || this.video.volume <= 0) {
              if (this.video.volume <= 0) {
                this.volume = 0.7;
              }
              this.muted = false;
            } else {
              this.muted = true;
            }
            if (component.$parent) {
              renderMuteControl(this, component.$parent);
            }
          },
          mounted: function (this: Artplayer, element) {
            renderMuteControl(this, element);
            const update = () => renderMuteControl(this, element);
            muteControlListeners.set(element, update);
            this.video.addEventListener('volumechange', update);
          },
          beforeUnmount: function (this: Artplayer, element) {
            const update = muteControlListeners.get(element);
            if (update) {
              this.video.removeEventListener('volumechange', update);
              muteControlListeners.delete(element);
            }
          },
        },
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
            getName: (level: any, index?: number) => makeQualityLevelLabel(level, index),
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
    const livePlaybackTimer = window.setInterval(() => requestLivePlayback(art), 3000);
    const playerElement = (art as any).template?.$player as HTMLElement | undefined;
    const handleLiveSurfaceClick = (event: MouseEvent) => {
      if (!art.option.isLive) {
        return;
      }
      const targetElement = event.target as HTMLElement | null;
      const isVideoSurface = targetElement === art.video || Boolean(targetElement?.closest('.art-mask'));
      if (!isVideoSurface) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      syncLivePlayback(art, true);
    };
    playerElement?.addEventListener('click', handleLiveSurfaceClick, true);
    art.on('pause', () => {
      if (!art.option.isLive) return;
      art.notice.show = '直播模式无法暂停';
      requestLivePlayback(art);
    });
    art.on('ready', () => requestLivePlayback(art));
    art.on('video:canplay', () => requestLivePlayback(art));
    art.on('video:stalled', () => requestLivePlayback(art));
    art.on('video:waiting', () => requestLivePlayback(art));
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestLivePlayback(art);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    if (getInstance && typeof getInstance === "function") {
      getInstance(art);
    }

    return () => {
      console.log('destroy outside')
      window.clearInterval(livePlaybackTimer);
      playerElement?.removeEventListener('click', handleLiveSurfaceClick, true);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
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
const DEFAULT_SUBTITLE_OFFSET_SECONDS = 1.5;
const DEFAULT_SOURCE_SUBTITLE_OFFSET_SECONDS = 0.3;
const SUBTITLE_OFFSET_MAX_SECONDS = 8;
const DEFAULT_ALIGNED_VIDEO_DELAY_SECONDS = 15;
const DEFAULT_STABLE_VIDEO_DELAY_SECONDS = 20;
const SUBTITLE_CONTEXT_SEGMENTS = 5;
const SUBTITLE_OVERLAY_CONTEXT_SEGMENTS = 6;
const MOBILE_PORTRAIT_BREAKPOINT = 700;
const REALTIME_SNAPSHOT_POLL_MS = 1000;
const LOW_LATENCY_HLS_CONFIG = {
  lowLatencyMode: true,
  // Keep the low-latency preset a few segments behind the live edge so normal
  // tunnel/CDN jitter does not turn into visible stalls.
  liveSyncDurationCount: 3,
  liveMaxLatencyDurationCount: 8,
  liveDurationInfinity: true,
  maxLiveSyncPlaybackRate: 1.08,
};
const REALTIME_VIDEO_MODE_KEY = 'n2nj:realtime-video-mode';
const REALTIME_VIDEO_DELAY_KEY = 'n2nj:realtime-video-delay-seconds';
const QUALITY_LEVEL_KEY_PREFIX = 'level:';

function makeAlignedHlsConfig(targetDelaySeconds: number) {
  const liveSyncDuration = Math.max(DEFAULT_ALIGNED_VIDEO_DELAY_SECONDS, targetDelaySeconds);
  return {
    lowLatencyMode: false,
    liveSyncDuration,
    liveMaxLatencyDuration: Math.max(liveSyncDuration + 10, liveSyncDuration * 1.6),
    liveDurationInfinity: true,
    maxLiveSyncPlaybackRate: 1.15,
  };
}

function getLevelVideoCodec(level: any) {
  const attrs = level?.attrs || {};
  return String(level?.videoCodec || attrs.CODECS || '').toLowerCase();
}

function stringifyLevelSource(value: any): string {
  if (!value) return '';
  if (Array.isArray(value)) return value.map(stringifyLevelSource).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    return [
      value.url,
      value.uri,
      value.relurl,
      value.path,
      value.name,
      value.NAME,
    ].map(stringifyLevelSource).filter(Boolean).join(' ');
  }
  return String(value);
}

function getLevelVariantHint(level: any) {
  const attrs = level?.attrs || {};
  return [
    level?.name,
    level?.url,
    level?.uri,
    level?.relurl,
    level?.details?.url,
    attrs.NAME,
    attrs['STABLE-VARIANT-ID'],
    attrs.STABLE_VARIANT_ID,
    attrs.URI,
  ].map(stringifyLevelSource).filter(Boolean).join(' ').toLowerCase();
}

function getLevelStableVariantId(level: any) {
  const attrs = level?.attrs || {};
  return String(attrs['STABLE-VARIANT-ID'] || attrs.STABLE_VARIANT_ID || '').trim().toLowerCase();
}

function isStreamServSourceVariant(level: any) {
  const stableId = getLevelStableVariantId(level);
  const variantHint = getLevelVariantHint(level);
  return stableId === 'source'
    || variantHint.includes('relay_source')
    || variantHint.includes('relay-source')
    || variantHint.includes('relay_source.m3u8')
    || variantHint.includes('source-copy')
    || variantHint.includes('源流');
}

function isStreamServHevcVariant(level: any) {
  const stableId = getLevelStableVariantId(level);
  const variantHint = getLevelVariantHint(level);
  return stableId.startsWith('hevc')
    || variantHint.includes('relay_hevc')
    || variantHint.includes('relay-hevc')
    || variantHint.includes('hevc_')
    || variantHint.includes('hevc-')
    || variantHint.includes('relay_reencode')
    || variantHint.includes('reencode');
}

function getLevelCodecLabel(level: any) {
  const vCodec = getLevelVideoCodec(level);
  if (vCodec.includes('hvc') || vCodec.includes('hev')) return 'HEVC';
  if (vCodec.includes('avc') || vCodec.includes('h264')) return 'H264';

  if (isStreamServHevcVariant(level)) return 'HEVC';
  if (isStreamServSourceVariant(level)) return 'H264';

  const bitrate = typeof level?.bitrate === 'number' ? level.bitrate : 0;
  return bitrate >= 4000000 ? 'HEVC' : '';
}

function getStreamServVariantLabel(level: any) {
  if (isStreamServHevcVariant(level)) return '转码';
  if (isStreamServSourceVariant(level)) return '源流';
  return '';
}

function browserSupportsHevcMse() {
  if (typeof window === 'undefined') return true;
  const mediaSource = window.MediaSource || (window as any).WebKitMediaSource;
  if (!mediaSource || typeof mediaSource.isTypeSupported !== 'function') {
    return false;
  }
  return [
    'video/mp4; codecs="hvc1.1.6.L93.B0"',
    'video/mp4; codecs="hev1.1.6.L93.B0"',
    'video/mp4; codecs="hvc1.1.6.L120.B0"',
    'video/mp4; codecs="hev1.1.6.L120.B0"',
    'video/mp4; codecs="hvc1.1.6.L93.B0,mp4a.40.2"',
  ].some((mimeType) => mediaSource.isTypeSupported(mimeType));
}

function isLevelPlayableInCurrentBrowser(level: any) {
  return getLevelCodecLabel(level) !== 'HEVC' || browserSupportsHevcMse();
}

function getStreamServHevcTargetLabel(level: any) {
  const hint = getLevelVariantHint(level);
  const explicitName = [
    level?.name,
    level?.attrs?.NAME,
  ].map(stringifyLevelSource).filter(Boolean).join(' ');
  const explicitMatch = explicitName.match(/HEVC\s+([0-9.]+)\s*([MK])\b/i);
  if (explicitMatch) {
    return `${explicitMatch[1]}${explicitMatch[2].toUpperCase()}`;
  }

  const variantMatch = hint.match(/hevc[_-]([0-9.]+)(m|k)\b/i);
  if (variantMatch) {
    return `${variantMatch[1]}${variantMatch[2].toUpperCase()}`;
  }

  return '';
}

function getStreamServLevelDescriptor(level: any) {
  const variant = getStreamServVariantLabel(level);
  if (variant === '源流') {
    return '源流';
  }

  const codec = getLevelCodecLabel(level);
  if (codec === 'HEVC') {
    const target = getStreamServHevcTargetLabel(level);
    return target ? `HEVC ${target} VBR` : 'HEVC VBR';
  }

  return '';
}

function makeQualityLevelLabel(level: any, index?: number) {
  const height = level?.height || 'Unknown';
  const descriptor = getStreamServLevelDescriptor(level);
  const codec = getLevelCodecLabel(level);
  const suffix = !descriptor && !codec && Number.isFinite(index)
    ? ` #${Number(index) + 1}`
    : '';

  let label = `${height}P`;
  if (descriptor) label += ` ${descriptor}`;
  else if (codec) label += ` ${codec}`;
  return `${label}${suffix}`;
}

function applyHlsLevelSelection(hls: Hls, levelIndex: number) {
  hls.startLevel = levelIndex;
  hls.currentLevel = levelIndex;
  hls.loadLevel = levelIndex;
  hls.nextLevel = levelIndex;
  (hls as any).nextLoadLevel = levelIndex;
  try {
    hls.startLoad();
  } catch {
    // hls.js may throw if loading has not been initialized yet.
  }
}

function saveQualityValue(value: string | number) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('artplayer_quality', String(value));
  }
}

function isH264Level(level: any) {
  return getLevelCodecLabel(level) === 'H264' || getStreamServVariantLabel(level) === '源流';
}

function makeQualityLevelKey(level: any, index: number) {
  const height = Number.isFinite(level?.height) ? level.height : 'unknown';
  const bitrate = Number.isFinite(level?.bitrate) ? level.bitrate : 0;
  const codec = getLevelCodecLabel(level) || 'unknown';
  return `${QUALITY_LEVEL_KEY_PREFIX}${index}:${height}:${codec}:${bitrate}`;
}

function findPreferredH264LevelIndex(levels: any[], preferredHeight?: number) {
  const matchingH264 = levels.findIndex((level) => (
    isH264Level(level) && (!preferredHeight || level.height === preferredHeight)
  ));
  if (matchingH264 !== -1) return matchingH264;

  return levels.findIndex(isH264Level);
}

function findStreamServSourceLevelIndex(parsedLevels: any[], manifestLevels: any[]) {
  const parsedIndex = parsedLevels.findIndex(isStreamServSourceVariant);
  if (parsedIndex !== -1) return parsedIndex;

  const manifestSource = manifestLevels.find(isStreamServSourceVariant);
  if (manifestSource) {
    return findMatchingParsedLevelIndex(manifestSource, parsedLevels);
  }

  return -1;
}

function findHevcUnsafeStreamServSourceLevelIndex(parsedLevels: any[], manifestLevels: any[]) {
  const hasHevcVariant = manifestLevels.some(isStreamServHevcVariant) || parsedLevels.some(isStreamServHevcVariant);
  const hasSourceVariant = manifestLevels.some(isStreamServSourceVariant) || parsedLevels.some(isStreamServSourceVariant);
  if (!hasHevcVariant || !hasSourceVariant || browserSupportsHevcMse()) {
    return -1;
  }
  return findStreamServSourceLevelIndex(parsedLevels, manifestLevels);
}

function findStreamServAutoSourceLevelIndex(parsedLevels: any[], manifestLevels: any[]) {
  const hasHevcVariant = manifestLevels.some(isStreamServHevcVariant) || parsedLevels.some(isStreamServHevcVariant);
  const sourceIndex = findStreamServSourceLevelIndex(parsedLevels, manifestLevels);
  return hasHevcVariant && sourceIndex !== -1 ? sourceIndex : -1;
}

function resolveSavedLevelIndex(levels: any[], saved: string | null) {
  if (!saved || saved === 'auto') return -1;

  if (saved.startsWith(QUALITY_LEVEL_KEY_PREFIX)) {
    const index = Number.parseInt(saved.slice(QUALITY_LEVEL_KEY_PREFIX.length), 10);
    return Number.isInteger(index) && index >= 0 && index < levels.length ? index : -1;
  }

  const legacyHeight = Number.parseInt(saved, 10);
  if (Number.isFinite(legacyHeight)) {
    const preferred = findPreferredH264LevelIndex(levels, legacyHeight);
    if (preferred !== -1) return preferred;
    return levels.findIndex((level) => level.height === legacyHeight);
  }

  return -1;
}

function levelUrlValues(level: any): string[] {
  const raw = level?.url ?? level?.uri ?? level?.relurl ?? level?.details?.url;
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map(String).filter(Boolean);
  }
  return [String(raw)];
}

function levelUrlPathKey(value: string) {
  try {
    return new URL(value, 'https://stream.n2nj.moe/stream/').pathname.toLowerCase();
  } catch {
    return value.split('?')[0].toLowerCase();
  }
}

function findMatchingParsedLevelIndex(manifestLevel: any, parsedLevels: any[]) {
  const manifestKeys = new Set(levelUrlValues(manifestLevel).map(levelUrlPathKey));
  if (manifestKeys.size > 0) {
    const urlIndex = parsedLevels.findIndex((level) => (
      levelUrlValues(level).some((value) => manifestKeys.has(levelUrlPathKey(value)))
    ));
    if (urlIndex !== -1) return urlIndex;
  }

  const manifestCodec = getLevelVideoCodec(manifestLevel);
  return parsedLevels.findIndex((level) => (
    level?.bitrate === manifestLevel?.bitrate
    && level?.height === manifestLevel?.height
    && getLevelVideoCodec(level) === manifestCodec
  ));
}

function streamServRelayVariantOrder(level: any) {
  const variant = getStreamServVariantLabel(level);
  if (variant === '源流') return 0;
  if (variant === '转码') return 1;
  return 2;
}

function hasStreamServRelayVariants(levels: any[]) {
  return levels.some((level) => isStreamServHevcVariant(level) || isStreamServSourceVariant(level));
}

function updateStreamServRelayVariantControl(art: Artplayer, hls: Hls, manifestLevels: any[]) {
  if (!Array.isArray(manifestLevels) || manifestLevels.length < 2 || !hasStreamServRelayVariants(manifestLevels)) {
    return;
  }

  const title = '画质';
  const autoHtml = '自动';
  const variants = manifestLevels
    .map((manifestLevel, manifestIndex) => {
      const levelIndex = findMatchingParsedLevelIndex(manifestLevel, hls.levels);
      const parsedLevel = levelIndex !== -1 ? hls.levels[levelIndex] : null;
      const supported = levelIndex !== -1 && isLevelPlayableInCurrentBrowser(parsedLevel || manifestLevel);
      const label = makeQualityLevelLabel(manifestLevel, manifestIndex);
      return {
        manifestIndex,
        levelIndex,
        supported,
        label,
        html: supported ? label : `${label}（当前浏览器不可播）`,
        sort: streamServRelayVariantOrder(manifestLevel),
      };
    })
    .sort((left, right) => left.sort - right.sort || left.manifestIndex - right.manifestIndex);

  const currentLevel = hls.currentLevel;
  const selector = variants.map((variant) => ({
    html: variant.html,
    value: variant.manifestIndex,
    default: variant.supported && currentLevel === variant.levelIndex,
  }));

  selector.push({
    html: autoHtml,
    value: -1,
    default: hls.currentLevel === -1,
  });

  const currentVariant = variants.find((variant) => variant.supported && currentLevel === variant.levelIndex);
  const defaultHtml = hls.currentLevel === -1 ? autoHtml : currentVariant?.label || autoHtml;

  const onSelect = (item: { html: string; value: number }) => {
    if (item.value === -1) {
      const safeSourceIndex = findStreamServAutoSourceLevelIndex(hls.levels, manifestLevels);
      if (safeSourceIndex !== -1) {
        const safeSourceLabel = variants.find((variant) => variant.levelIndex === safeSourceIndex)?.label
          || makeQualityLevelLabel(hls.levels[safeSourceIndex], safeSourceIndex);
        applyHlsLevelSelection(hls, safeSourceIndex);
        saveQualityValue('auto');
        art.notice.show = `${title}: 自动（${safeSourceLabel}）`;
        updateStreamServRelayVariantControl(art, hls, manifestLevels);
        requestLivePlayback(art);
        return safeSourceLabel;
      }
      applyHlsLevelSelection(hls, -1);
      saveQualityValue('auto');
      art.notice.show = `${title}: ${autoHtml}`;
      (art.controls as any).check(item);
      (art.setting as any).check(item);
      setTimeout(() => updateStreamServRelayVariantControl(art, hls, manifestLevels), 0);
      return autoHtml;
    }

    const variant = variants.find((candidate) => candidate.manifestIndex === item.value);
    if (!variant) {
      return defaultHtml;
    }

    if (!variant.supported) {
      art.notice.show = `${variant.label}: 当前浏览器不支持 HEVC/MSE`;
      return defaultHtml;
    }

    applyHlsLevelSelection(hls, variant.levelIndex);
    saveQualityValue(makeQualityLevelKey(hls.levels[variant.levelIndex], variant.levelIndex));
    art.notice.show = `${title}: ${variant.label}`;
    requestLivePlayback(art);
    scheduleStreamServSourceFallbackIfStalled(art, hls, manifestLevels);
    (art.controls as any).check(item);
    (art.setting as any).check(item);
    updateStreamServRelayVariantControl(art, hls, manifestLevels);
    setTimeout(() => updateStreamServRelayVariantControl(art, hls, manifestLevels), 0);
    setTimeout(() => updateStreamServRelayVariantControl(art, hls, manifestLevels), 250);
    return variant.label;
  };

  (art.controls as any).update({
    name: 'hls-quality',
    position: 'right',
    html: defaultHtml,
    style: { padding: '0 10px' },
    selector,
    onSelect,
  });

  (art.setting as any).update({
    name: 'hls-quality',
    tooltip: defaultHtml,
    html: title,
    width: 200,
    selector,
    onSelect,
  });
}

function scheduleStreamServSourceFallbackIfStalled(art: Artplayer, hls: Hls, manifestLevels: any[]) {
  if (typeof window === 'undefined') return;
  const sourceIndex = findStreamServSourceLevelIndex(hls.levels, manifestLevels);
  if (sourceIndex === -1) return;

  window.setTimeout(() => {
    if ((art as any).hls !== hls || hls.currentLevel === sourceIndex) {
      return;
    }

    const currentLevel = hls.currentLevel >= 0 ? hls.levels[hls.currentLevel] : null;
    const shouldFallback = hls.currentLevel === -1
      || !currentLevel
      || getLevelCodecLabel(currentLevel) === 'HEVC';
    if (!shouldFallback || art.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      return;
    }

    applyHlsLevelSelection(hls, sourceIndex);
    saveQualityValue(makeQualityLevelKey(hls.levels[sourceIndex], sourceIndex));
    art.notice.show = '画质: 源流';
    requestLivePlayback(art);
    updateStreamServRelayVariantControl(art, hls, manifestLevels);
  }, 4500);
}

type PlaybackTimecode = {
  wallTimeMs: number | null;
  latencyMs: number | null;
  liveSyncPosition: number | null;
  currentTime: number | null;
  source: 'hls-latency' | 'clock';
};

type VideoLatencyMode = 'aligned' | 'low';

const REALTIME_SETTINGS_VERSION = 10;

function getUrlRealtimePreset() {
  if (typeof window === 'undefined') {
    return null;
  }
  const params = new URLSearchParams(window.location.search);
  return {
    preset: params.get('preset') || params.get('view'),
    latency: params.get('latency'),
    subtitle: params.get('subtitle'),
  };
}

function readInitialRealtimeVideoMode(): VideoLatencyMode {
  if (typeof window !== 'undefined') {
    const override = (window as any).__n2njRealtimeVideoMode as VideoLatencyMode | undefined;
    if (override === 'low' || override === 'aligned') {
      return override;
    }
  }
  const preset = getUrlRealtimePreset();
  if (!preset) {
    return 'low';
  }
  if (preset.preset === 'low' || preset.latency === 'low' || preset.subtitle === 'off') {
    return 'low';
  }
  if (preset.preset === 'source' || preset.preset === 'bilingual' || preset.preset === 'aligned' || preset.subtitle === 'on') {
    return 'aligned';
  }
  return 'low';
}

function readInitialRealtimeVideoDelaySeconds() {
  if (typeof window !== 'undefined') {
    const override = Number((window as any).__n2njRealtimeVideoDelaySeconds);
    if (Number.isFinite(override) && override > 0) {
      return override;
    }
  }
  const preset = getUrlRealtimePreset();
  if (typeof window !== 'undefined') {
    const delay = Number(new URLSearchParams(window.location.search).get('delay'));
    if (Number.isFinite(delay) && delay > 0) {
      return delay;
    }
  }
  if (preset?.preset === 'bilingual') {
    return DEFAULT_STABLE_VIDEO_DELAY_SECONDS;
  }
  if (preset?.preset === 'source' || preset?.preset === 'aligned' || preset?.subtitle === 'on') {
    return DEFAULT_ALIGNED_VIDEO_DELAY_SECONDS;
  }
  if (typeof window !== 'undefined') {
    const stored = Number(window.localStorage.getItem(REALTIME_VIDEO_DELAY_KEY));
    if (Number.isFinite(stored) && stored > 0) {
      return stored;
    }
  }
  return DEFAULT_ALIGNED_VIDEO_DELAY_SECONDS;
}

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

function hasSourceSubtitleAnchor(segment: RealtimeTextSegment) {
  return Boolean(segment.sourceText?.trim());
}

function ensureRealtimeSubtitleLayer(art: Artplayer | null) {
  const layerRoot = (art as any)?.template?.$layer as HTMLElement | undefined;
  if (!layerRoot) {
    return null;
  }
  const existing = layerRoot.querySelector<HTMLElement>('[data-n2nj-realtime-subtitle-layer="true"]');
  if (existing) {
    return existing;
  }
  const element = document.createElement('div');
  element.dataset.n2njRealtimeSubtitleLayer = 'true';
  element.className = 'art-layer n2nj-realtime-subtitle-layer';
  layerRoot.appendChild(element);
  return element;
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
      if (!hasSourceSubtitleAnchor(segment)) {
        continue;
      }
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
        if (targetWallTimeMs < item.startAt) {
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
  maxSegments = SUBTITLE_CONTEXT_SEGMENTS,
): SubtitleTextPiece[] {
  const sorted = normalizeSegmentsByTimecode(segments);
  if (!sorted.length || (!current && !allowLatestFallback)) {
    return [];
  }

  const currentIndex = current
    ? Math.max(0, sorted.findIndex((segment) => segment.id === current.id))
    : sorted.length - 1;
  const effectiveIndex = currentIndex >= 0 ? currentIndex : sorted.length - 1;
  const startIndex = Math.max(0, effectiveIndex - Math.max(1, maxSegments) + 1);

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
  const hlsConfig = (hls as any)?.config;
  const configuredLatencySeconds = hlsConfig && typeof hlsConfig.liveSyncDuration === 'number' && Number.isFinite(hlsConfig.liveSyncDuration)
    ? hlsConfig.liveSyncDuration
    : (() => {
      const targetDuration = typeof (hls as any)?.targetDuration === 'number' && Number.isFinite((hls as any).targetDuration)
        ? (hls as any).targetDuration
        : null;
      const syncCount = typeof hlsConfig?.liveSyncDurationCount === 'number' && Number.isFinite(hlsConfig.liveSyncDurationCount)
        ? hlsConfig.liveSyncDurationCount
        : null;
      return targetDuration !== null && syncCount !== null ? Math.max(0, targetDuration * syncCount) : null;
    })();
  const effectiveLatencySeconds = latencySeconds ?? configuredLatencySeconds;
  const currentTime = video && Number.isFinite(video.currentTime) ? video.currentTime : null;
  const liveSyncPosition = hls && typeof hls.liveSyncPosition === 'number' && Number.isFinite(hls.liveSyncPosition)
    ? hls.liveSyncPosition
    : null;

  if (effectiveLatencySeconds !== null && effectiveLatencySeconds >= 0) {
    const latencyMs = effectiveLatencySeconds * 1000;
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

function clampUiNumber(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function reloadHlsForLatencyMode(art: Artplayer | null, mode: VideoLatencyMode, targetDelaySeconds?: number) {
  if (typeof window !== 'undefined') {
    (window as any).__n2njRealtimeVideoMode = mode;
    window.localStorage.setItem(REALTIME_VIDEO_MODE_KEY, mode);
    if (typeof targetDelaySeconds === 'number' && Number.isFinite(targetDelaySeconds) && targetDelaySeconds > 0) {
      (window as any).__n2njRealtimeVideoDelaySeconds = targetDelaySeconds;
      window.localStorage.setItem(REALTIME_VIDEO_DELAY_KEY, String(targetDelaySeconds));
    }
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
  const [showSourceText, setShowSourceText] = useState(() => (
    readInitialRealtimeVideoMode() === 'aligned' ? DEFAULT_REALTIME_TEXT_CONFIG.showSource : false
  ));
  const [showTranslationText, setShowTranslationText] = useState(() => {
    if (readInitialRealtimeVideoMode() !== 'aligned') {
      return false;
    }
    return getUrlRealtimePreset()?.preset === 'source' ? false : DEFAULT_REALTIME_TEXT_CONFIG.showTranslation;
  });
  const [showTiming, setShowTiming] = useState(DEFAULT_REALTIME_TEXT_CONFIG.showTiming);
  const [subtitleOffsetSeconds, setSubtitleOffsetSeconds] = useState(DEFAULT_SUBTITLE_OFFSET_SECONDS);
  const [videoDelaySeconds, setVideoDelaySeconds] = useState(() => readInitialRealtimeVideoDelaySeconds());
  const [videoLatencyMode, setVideoLatencyMode] = useState<VideoLatencyMode>(() => readInitialRealtimeVideoMode());
  const [isPortraitViewport, setIsPortraitViewport] = useState(false);
  const [nowJst, setNowJst] = useState(() => new Date());
  const [playbackTimecode, setPlaybackTimecode] = useState<PlaybackTimecode>(() => readPlaybackTimecode(null));
  const [artSubtitleLayerHost, setArtSubtitleLayerHost] = useState<HTMLElement | null>(null);
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
  const sourceSubtitleOffsetSeconds = showSourceText && showTranslationText
    ? DEFAULT_SOURCE_SUBTITLE_OFFSET_SECONDS
    : subtitleOffsetSeconds;
  const translationSubtitleOffsetSeconds = subtitleOffsetSeconds;
  const sourceSubtitleOffsetMs = Math.max(0, sourceSubtitleOffsetSeconds || 0) * 1000;
  const translationSubtitleOffsetMs = Math.max(0, translationSubtitleOffsetSeconds || 0) * 1000;
  const sourceRealtimeTextWindow = findRealtimeTextWindow(
    realtimeSegments,
    realtimeSnapshot?.partial,
    nowJst,
    sourceSubtitleOffsetMs,
    playbackTimecode,
  );
  const translationRealtimeTextWindow = findRealtimeTextWindow(
    realtimeSegments,
    realtimeSnapshot?.partial,
    nowJst,
    translationSubtitleOffsetMs,
    playbackTimecode,
  );
  const realtimeTextWindow = showTranslationText && !showSourceText
    ? translationRealtimeTextWindow
    : sourceRealtimeTextWindow;
  const activeRealtimeSegment = realtimeTextWindow.current;
  const sourceSubtitleTextPieces = buildSubtitleTextPieces(
    realtimeSegments,
    sourceRealtimeTextWindow.current,
    !sourceRealtimeTextWindow.usedTimeline || !sourceRealtimeTextWindow.current,
    SUBTITLE_OVERLAY_CONTEXT_SEGMENTS,
  );
  const translationSubtitleTextPieces = buildSubtitleTextPieces(
    realtimeSegments,
    translationRealtimeTextWindow.current,
    !translationRealtimeTextWindow.usedTimeline || !translationRealtimeTextWindow.current,
    SUBTITLE_OVERLAY_CONTEXT_SEGMENTS,
  );
  const showSubtitleText = Boolean(
    (showSourceText && sourceSubtitleTextPieces.some(({ segment }) => segment.sourceText?.trim()))
    || (showTranslationText && translationSubtitleTextPieces.some(({ segment }) => segment.translatedText?.trim())),
  );
  const activeReceiveLag = formatLag(nowJst, activeRealtimeSegment?.receivedAt || activeRealtimeSegment?.updatedAt);
  const activeTranslationLag = activeRealtimeSegment?.translatedText
    ? formatLag(nowJst, activeRealtimeSegment.updatedAt)
    : '--s';
  const activeCaptureClock = formatIsoClockJst(activeRealtimeSegment?.timelineMeta?.capture_ended_at);
  const playbackLatencyLabel = playbackTimecode.latencyMs !== null ? formatMillis(playbackTimecode.latencyMs) : '--s';
  const playbackClockLabel = playbackTimecode.wallTimeMs !== null ? formatClockJst(playbackTimecode.wallTimeMs) : '--:--:--';
  const videoLatencyLabel = videoLatencyMode === 'low' ? '低延迟' : `目标 ${videoDelaySeconds}s`;
  const subtitleOffsetLabel = showSourceText && showTranslationText
    ? `日+${sourceSubtitleOffsetSeconds}s/译+${translationSubtitleOffsetSeconds}s`
    : `+${subtitleOffsetSeconds}s`;
  const subtitlesVisible = showSourceText || showTranslationText;
  const sourceSubtitlePresetActive = videoLatencyMode === 'aligned' && showSourceText && !showTranslationText && !transcriptOpen;
  const bilingualPresetActive = videoLatencyMode === 'aligned' && showTranslationText && showSourceText && !transcriptOpen && videoDelaySeconds >= DEFAULT_STABLE_VIDEO_DELAY_SECONDS;
  const lowLatencyPresetActive = videoLatencyMode === 'low' && !subtitlesVisible && !transcriptOpen;
  const playerHrefBase = `/player/${encodeURIComponent(player.pId)}`;
  const lowLatencyHref = `${playerHrefBase}?preset=low`;
  const sourceSubtitleHref = `${playerHrefBase}?preset=source`;
  const bilingualSubtitleHref = `${playerHrefBase}?preset=bilingual`;
  const realtimeSettingsKey = `n2nj:realtime-text:${player.pId}`;
  const transcriptRows = realtimeSegments.map((segment) => {
    const intervalMs = realtimeConfig.cursorIntervalSeconds * 1000;
    const bucket = Math.floor(segment.startMs / intervalMs);
    return {
      segment,
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
    autoPlayback: false,
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

  const reloadPlayerForLatencyMode = useCallback((mode: VideoLatencyMode, targetDelaySeconds?: number) => {
    reloadHlsForLatencyMode(artPlayerRef.current, mode, targetDelaySeconds);
  }, []);

  const applySubtitlePreset = useCallback((closeControls = true) => {
    setVideoLatencyMode('aligned');
    setTranscriptOpen(false);
    setShowTranslationText(false);
    setShowSourceText(true);
    setShowTiming(false);
    setSubtitleOffsetSeconds(DEFAULT_SOURCE_SUBTITLE_OFFSET_SECONDS);
    setSubtitleOpacity((value) => Math.max(value, isPortraitViewport ? 0.86 : 0.78));
    const targetDelaySeconds = realtimeConfig.videoDelaySeconds || DEFAULT_ALIGNED_VIDEO_DELAY_SECONDS;
    setVideoDelaySeconds(targetDelaySeconds);
    reloadPlayerForLatencyMode('aligned', targetDelaySeconds);
    if (closeControls) {
      setRealtimeControlsOpen(false);
    }
  }, [isPortraitViewport, realtimeConfig.videoDelaySeconds, reloadPlayerForLatencyMode]);

  const applyStableBilingualPreset = useCallback((closeControls = true) => {
    setVideoLatencyMode('aligned');
    setShowTranslationText(true);
    setShowSourceText(true);
    setShowTiming(false);
    setTranscriptOpen(false);
    setSubtitleOffsetSeconds(DEFAULT_SUBTITLE_OFFSET_SECONDS);
    setVideoDelaySeconds(DEFAULT_STABLE_VIDEO_DELAY_SECONDS);
    reloadPlayerForLatencyMode('aligned', DEFAULT_STABLE_VIDEO_DELAY_SECONDS);
    if (closeControls) {
      setRealtimeControlsOpen(false);
    }
  }, [reloadPlayerForLatencyMode]);

  const applyLowLatencyPreset = useCallback((closeControls = true) => {
    setVideoLatencyMode('low');
    setShowTranslationText(false);
    setShowSourceText(false);
    setShowTiming(false);
    setTranscriptOpen(false);
    setSubtitleOffsetSeconds(DEFAULT_SUBTITLE_OFFSET_SECONDS);
    setVideoDelaySeconds(0);
    reloadPlayerForLatencyMode('low');
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
    setSubtitleOffsetSeconds(DEFAULT_SUBTITLE_OFFSET_SECONDS);
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
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(realtimeSettingsKey);
      const params = new URLSearchParams(window.location.search);
      const preset = params.get('preset') || params.get('view');
      const latency = params.get('latency');
      const subtitle = params.get('subtitle');
      const delayParam = Number(params.get('delay'));
      const queryDelaySeconds = Number.isFinite(delayParam) && delayParam > 0 ? delayParam : null;
      const hasExplicitRealtimeView = Boolean(preset || latency || subtitle);

      if (raw && hasExplicitRealtimeView) {
        const stored = JSON.parse(raw) as StoredRealtimeSettings;
        const storedVersion = typeof stored.version === 'number' ? stored.version : 0;
        const storedSubtitleOffset = (value: number) => {
          if (storedVersion < REALTIME_SETTINGS_VERSION) {
            return DEFAULT_SUBTITLE_OFFSET_SECONDS;
          }
          return clampUiNumber(value, DEFAULT_SUBTITLE_OFFSET_SECONDS, 0, SUBTITLE_OFFSET_MAX_SECONDS);
        };
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
          setSubtitleOffsetSeconds(storedSubtitleOffset(stored.subtitleOffsetSeconds));
        } else if (typeof stored.subtitleDelaySeconds === 'number') {
          setSubtitleOffsetSeconds(storedSubtitleOffset(stored.subtitleDelaySeconds));
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
      } else if (preset !== 'aligned' && preset !== 'source' && preset !== 'bilingual' && preset !== 'low' && latency !== 'low' && subtitle !== 'off' && subtitle !== 'on') {
        setVideoLatencyMode('low');
        setTranscriptOpen(false);
        setShowSourceText(false);
        setShowTranslationText(false);
        setShowTiming(false);
        setSubtitleOffsetSeconds(DEFAULT_SUBTITLE_OFFSET_SECONDS);
        setVideoDelaySeconds(0);
      }
      if (preset === 'low' || latency === 'low' || subtitle === 'off') {
        setVideoLatencyMode('low');
        setShowTranslationText(false);
        setShowSourceText(false);
        setShowTiming(false);
        setTranscriptOpen(false);
        setSubtitleOffsetSeconds(DEFAULT_SUBTITLE_OFFSET_SECONDS);
        setVideoDelaySeconds(0);
      } else if (preset === 'source') {
        setVideoLatencyMode('aligned');
        setShowTranslationText(false);
        setShowSourceText(true);
        setShowTiming(false);
        setTranscriptOpen(false);
        setSubtitleOffsetSeconds(DEFAULT_SOURCE_SUBTITLE_OFFSET_SECONDS);
        setVideoDelaySeconds(queryDelaySeconds || realtimeConfig.videoDelaySeconds || DEFAULT_ALIGNED_VIDEO_DELAY_SECONDS);
      } else if (preset === 'bilingual' || preset === 'aligned' || subtitle === 'on') {
        setVideoLatencyMode('aligned');
        setShowTranslationText(true);
        setShowSourceText(true);
        setShowTiming(false);
        setTranscriptOpen(false);
        setSubtitleOffsetSeconds(DEFAULT_SUBTITLE_OFFSET_SECONDS);
        setVideoDelaySeconds(queryDelaySeconds || (preset === 'bilingual' ? DEFAULT_STABLE_VIDEO_DELAY_SECONDS : realtimeConfig.videoDelaySeconds || DEFAULT_ALIGNED_VIDEO_DELAY_SECONDS));
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

  const splitSubtitlePieces = (
    pieces: SubtitleTextPiece[],
    getText: (segment: RealtimeTextSegment) => string,
  ) => {
    const visiblePieces = pieces.filter(({ segment }) => getText(segment).trim());
    if (visiblePieces.length <= 1) {
      return [visiblePieces, []] as const;
    }
    const weights = visiblePieces.map(({ segment }) => Math.max(1, getText(segment).trim().length));
    const targetWeight = weights.reduce((sum, weight) => sum + weight, 0) / 2;
    let splitIndex = 1;
    let runningWeight = 0;
    for (let index = 0; index < visiblePieces.length - 1; index += 1) {
      runningWeight += weights[index];
      splitIndex = index + 1;
      if (runningWeight >= targetWeight) {
        break;
      }
    }
    return [visiblePieces.slice(0, splitIndex), visiblePieces.slice(splitIndex)] as const;
  };
  const [sourceSubtitleRowA, sourceSubtitleRowB] = splitSubtitlePieces(
    sourceSubtitleTextPieces,
    (segment) => segment.sourceText || '',
  );
  const [translationSubtitleRowA, translationSubtitleRowB] = splitSubtitlePieces(
    translationSubtitleTextPieces,
    (segment) => segment.translatedText || '',
  );
  const sourceSubtitleRows = [
    {
      key: 'source-context',
      lang: 'ja',
      pieces: sourceSubtitleRowA,
      getText: (segment: RealtimeTextSegment) => segment.sourceText || '',
    },
    {
      key: 'source-current',
      lang: 'ja',
      pieces: sourceSubtitleRowB,
      getText: (segment: RealtimeTextSegment) => segment.sourceText || '',
    },
  ];
  const translationSubtitleRows = [
    {
      key: 'translation-context',
      lang: 'zh-CN',
      pieces: translationSubtitleRowA,
      getText: (segment: RealtimeTextSegment) => segment.translatedText || '',
    },
    {
      key: 'translation-current',
      lang: 'zh-CN',
      pieces: translationSubtitleRowB,
      getText: (segment: RealtimeTextSegment) => segment.translatedText || '',
    },
  ];
  const subtitleOverlayRows = [
    ...(showSourceText ? sourceSubtitleRows : []),
    ...(showTranslationText ? translationSubtitleRows : []),
  ];

  const subtitleOverlayNode = showSubtitleOverlay && showSubtitleText ? (
    <div
      className={`n2nj-realtime-subtitle-overlay pointer-events-none absolute inset-x-2 z-20 flex justify-center sm:inset-x-6 ${
        isPortraitViewport ? 'top-[calc(min(100vw,100vh*16/9)*9/16+0.75rem)] bottom-auto' : 'bottom-14 sm:bottom-16'
      }`}
      style={{ opacity: subtitleOpacity }}
    >
      <div
        className={`n2nj-realtime-subtitle-box w-full overflow-hidden rounded border border-white/10 bg-black/68 px-3 py-2 font-normal leading-snug text-white shadow-lg backdrop-blur-sm sm:px-4 ${
          isPortraitViewport
            ? 'max-h-[calc(100%-min(100vw,100vh*16/9)*9/16-1.5rem)] max-w-[min(98%,720px)] [overflow-wrap:anywhere] [word-break:normal]'
            : 'max-h-[34vh] max-w-[min(96%,1080px)] [overflow-wrap:anywhere] [word-break:keep-all]'
        }`}
        style={{ fontSize: `${subtitleScale}rem` }}
      >
        {subtitleOverlayRows.map((row, rowIndex) => (
          <div
            key={row.key}
            className={`realtime-subtitle-roll text-left ${isPortraitViewport ? 'realtime-subtitle-roll--wrap min-h-[1.35em]' : 'min-h-[1.35em]'} ${rowIndex > 0 ? (isPortraitViewport ? 'mt-1.5' : 'mt-1') : ''}`}
            lang={row.lang}
          >
            <div className="realtime-subtitle-roll-track">
              {row.pieces.some(({ segment }) => row.getText(segment).trim()) ? (
                row.pieces.map(({ segment, color, isCurrent }) => {
                  const text = row.getText(segment);
                  return text.trim() ? (
                    <span
                      key={`overlay-${row.key}-${segment.id}`}
                      className={isCurrent ? 'font-bold' : 'font-light'}
                      style={{ color }}
                    >
                      {text}
                      <span className="text-white/20"> </span>
                    </span>
                  ) : null;
                })
              ) : (
                <span>&nbsp;</span>
              )}
            </div>
          </div>
        ))}
        {showTiming && realtimeConfig.showTiming && activeRealtimeSegment && (
          <div className="mt-1 text-[0.66em] font-medium text-white/58">
            JST {formatClockJst(nowJst)} · 播 {playbackClockLabel} · 画面 {videoLatencyLabel}/{playbackLatencyLabel} · 字幕 {realtimeTextWindow.usedTimeline ? '时间码' : '最新段'} {subtitleOffsetLabel} · 采 {activeCaptureClock} · 收 {activeReceiveLag}
          </div>
        )}
      </div>
    </div>
  ) : null;

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
              <a
                href={lowLatencyHref}
                className={`min-w-0 flex-1 rounded-md px-3 py-1.5 transition ${
                  lowLatencyPresetActive
                    ? 'bg-slate-950 text-white shadow-sm'
                    : 'text-slate-700 hover:bg-white/90'
                }`}
              >
                生肉(低延迟)
              </a>
              <a
                href={sourceSubtitleHref}
                className={`min-w-0 flex-1 rounded-md px-3 py-1.5 transition ${
                  sourceSubtitlePresetActive
                    ? 'bg-cyan-600 text-white shadow-sm'
                    : 'text-slate-700 hover:bg-white/90'
                }`}
              >
                日字 -{DEFAULT_ALIGNED_VIDEO_DELAY_SECONDS}秒
              </a>
              <a
                href={bilingualSubtitleHref}
                className={`min-w-0 flex-1 rounded-md px-3 py-1.5 transition ${
                  bilingualPresetActive
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-700 hover:bg-white/90'
                }`}
              >
                中日双字 -{DEFAULT_STABLE_VIDEO_DELAY_SECONDS}秒
              </a>
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
                setArtSubtitleLayerHost(ensureRealtimeSubtitleLayer(art));
              }}
              debug={debug}
              player={player}
              className="w-full h-full flex"
              style={{ minHeight: '400px' }}
            />

            {realtimeEnabled && !isPortraitViewport && (
              <button
                type="button"
                onClick={toggleRealtimeSubtitles}
                className="pointer-events-auto absolute left-3 top-3 z-30 rounded border border-white/20 bg-black/54 px-2 py-1 text-[11px] font-semibold text-white shadow-lg backdrop-blur transition hover:bg-black/72 sm:hidden"
                title="开关实时字幕"
              >
                字幕{subtitlesVisible ? '开' : '关'}
              </button>
            )}

            {(!artSubtitleLayerHost || isPortraitViewport) && subtitleOverlayNode}
            {!isPortraitViewport && artSubtitleLayerHost && subtitleOverlayNode ? createPortal(subtitleOverlayNode, artSubtitleLayerHost) : null}

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
                    <a
                      href={sourceSubtitleHref}
                      className={`rounded border px-2 py-1 transition ${
                        sourceSubtitlePresetActive
                          ? 'border-cyan-300 bg-cyan-300/24 text-cyan-50'
                          : 'border-white/24 bg-white/12 hover:bg-white/22'
                      }`}
                    >
                      日字 -{DEFAULT_ALIGNED_VIDEO_DELAY_SECONDS}秒
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        setVideoLatencyMode('aligned');
                        setTranscriptOpen(true);
                        setShowSourceText(true);
                        setShowTranslationText(true);
                        setShowTiming(true);
                        const nextDelaySeconds = Math.max(videoDelaySeconds, DEFAULT_ALIGNED_VIDEO_DELAY_SECONDS);
                        setVideoDelaySeconds(nextDelaySeconds);
                        reloadPlayerForLatencyMode('aligned', nextDelaySeconds);
                      }}
                      className={`rounded border px-2 py-1 transition ${
                        videoLatencyMode === 'aligned' && transcriptOpen
                          ? 'border-cyan-300 bg-cyan-300/24 text-cyan-50'
                          : 'border-white/24 bg-white/12 hover:bg-white/22'
                      }`}
                    >
                      侧窗
                    </button>
                    <a
                      href={lowLatencyHref}
                      className={`rounded border px-2 py-1 transition ${
                        lowLatencyPresetActive
                          ? 'border-cyan-300 bg-cyan-300/24 text-cyan-50'
                          : 'border-white/24 bg-white/12 hover:bg-white/22'
                      }`}
                    >
                      画面最低延迟
                    </a>
                    <a
                      href={bilingualSubtitleHref}
                      className={`rounded border px-2 py-1 transition ${
                        bilingualPresetActive
                          ? 'border-cyan-300 bg-cyan-300/24 text-cyan-50'
                          : 'border-white/24 bg-white/12 hover:bg-white/22'
                      }`}
                    >
                      中日双字 -{DEFAULT_STABLE_VIDEO_DELAY_SECONDS}秒
                    </a>
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
                    {[10, 15, 20].map((seconds) => (
                      <a
                        key={seconds}
                        href={`${playerHrefBase}?preset=bilingual&delay=${seconds}`}
                        className={`rounded border px-2 py-1 transition ${
                          videoDelaySeconds === seconds && videoLatencyMode === 'aligned'
                            ? 'border-cyan-300 bg-cyan-300/24 text-cyan-50'
                            : 'border-white/24 bg-white/12 hover:bg-white/22'
                        }`}
                      >
                        {seconds}s
                      </a>
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
                          const nextDelaySeconds = Number(event.target.value);
                          setVideoDelaySeconds(nextDelaySeconds);
                          setVideoLatencyMode('aligned');
                          setShowTranslationText(true);
                          setShowSourceText(true);
                        }}
                        className="w-20"
                      />
                      <span className="tabular-nums">{videoDelaySeconds}s</span>
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <span>{showSourceText && showTranslationText ? '译文延迟' : '字幕延迟'}</span>
                      <input
                        type="range"
                        min="0"
                        max={SUBTITLE_OFFSET_MAX_SECONDS}
                        step="0.05"
                        value={subtitleOffsetSeconds}
                        onChange={(event) => setSubtitleOffsetSeconds(Number(event.target.value))}
                        className="w-20"
                      />
                      <span className="min-w-[3.4rem] tabular-nums">{Math.round(subtitleOffsetSeconds * 1000)}ms</span>
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
                    JST {formatClockJst(nowJst)} · 播 {playbackClockLabel} · 画面 {videoLatencyLabel}/{playbackLatencyLabel} · 字幕 {realtimeTextWindow.usedTimeline ? '时间码' : '最新段'} {subtitleOffsetLabel}
                  </div>
                )}
              </div>

              {realtimeSegments.length === 0 && (
                <div className="px-3 py-4 text-xs text-slate-500">转写后端尚未接入。</div>
              )}

              {showSourceText && (
                <section className="min-h-0 flex-1">
                  <div className="flex items-center justify-between px-3 py-1.5 text-[11px] font-medium text-slate-400">
                    <span>原文</span>
                    <span>{activeCaptureClock}</span>
                  </div>
                  <div ref={sourceTranscriptRef} className="h-[calc(100%-28px)] overflow-x-hidden overflow-y-auto px-3 pb-2 font-mono text-[12px] leading-6">
                    <p className="whitespace-normal text-slate-200 [overflow-wrap:anywhere] [word-break:keep-all]" lang="ja">
                      {transcriptRows.map(({ segment, color }) => (
                        <span key={`source-${segment.id}`}>
                          <span
                            className="rounded-sm px-0.5"
                            style={{ color }}
                          >
                            {segment.sourceText || ''}
                          </span>
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
                      {transcriptRows.map(({ segment, color }) => (
                        <span key={`translation-${segment.id}`}>
                          <span
                            className={`rounded-sm px-0.5 ${segment.translatedText ? '' : 'text-slate-600'}`}
                            style={{ color: segment.translatedText ? color : undefined }}
                          >
                            {segment.translatedText || ''}
                          </span>
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
