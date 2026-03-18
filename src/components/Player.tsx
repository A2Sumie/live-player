'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Player } from '@/lib/db';
import Artplayer from "artplayer";
import type { Option } from "artplayer";
import Hls from "hls.js";
import artplayerPluginHlsControl from 'artplayer-plugin-hls-control';
import ObfuscatedText from './ObfuscatedText';

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
        const hls = new Hls({
          debug: debug, // Enable debug if requested
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

    art.on('play', () => {
      if (!art.option.isLive) return;

      // Aggressive live sync for Safari/Firefox
      if ((art as any).hls) {
        const hls = (art as any).hls as Hls;
        const latency = hls.latency;
        // If latency is too high (> 5s), jump to live sync position
        if (latency > 5) {
          console.log('High latency detected, syncing to live edge...', latency);
          art.notice.show = '正在同步直播进度...';
          if (hls.liveSyncPosition) {
            art.currentTime = hls.liveSyncPosition;
          }
        }
      }
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

export default function PlayerComponent({ player, debug = false }: PlayerProps) {
  const artPlayerRef = useRef<any>(null);

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


  return (
    <div className="flex flex-col h-screen">
      <header className="text-black p-4 z-10 flex items-center justify-between" style={{ backgroundColor: '#d1e5fc' }}>
        <div>
          <div className="flex items-center space-x-4">
            <Link
              href="/"
              className="text-blue-600 hover:text-blue-800 transition-colors"
            >
              ← 返回首页
            </Link>
            <h1 className="text-xl font-bold">
              <ObfuscatedText text={player.name} playerId={player.pId} />
            </h1>
          </div>
          {player.description && (
            <p className="text-gray-700 mt-2 text-sm">{player.description}</p>
          )}
        </div>
        <img
          src="/logo.png"
          alt="N2NJ Logo"
          className={`${player.description ? 'h-20' : 'h-12'} w-auto opacity-80 ml-4 transition-all duration-300`}
        />
      </header>

      <div className="flex-1 bg-black relative">
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
      </div>

      {player.announcement && (
        <div className="bg-yellow-600 text-black px-4 py-2">
          <p className="text-sm font-medium">
            📢 {player.announcement}
          </p>
        </div>
      )}
    </div>
  );
}
