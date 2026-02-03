'use client';

import { useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import type { Player } from '@/lib/db';
import Artplayer from "artplayer";
import type { Option } from "artplayer";
import Hls from "hls.js";
import artplayerPluginHlsControl from 'artplayer-plugin-hls-control';

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
  ...rest
}: {
  option: Omit<Option, "container">;
  getInstance?: (art: Artplayer) => void;
  debug?: boolean;
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
            if (tsUrl.includes(".ts") || tsUrl.endsWith(".m3u8")) {
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
        art.notice.show = "Unsupported playback format: m3u8";
      }
    },
    []
  );

  useEffect(() => {
    const art = new Artplayer({
      ...option,
      container: artRef.current || "",
      customType: {
        m3u8: playM3u8,
      },
      controls: [
        {
          name: 'pip',
          index: 20,
          position: 'right',
          html: '<svg xmlns="http://www.w3.org/2000/svg" height="22" width="22" viewBox="0 0 24 24"><path d="M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z" fill="currentColor"/></svg>',
          tooltip: 'Picture in Picture',
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
              this.notice.show = 'Picture-in-Picture not supported';
            }
          },
          mounted: function (el) {
            // Only show manual control if default PiP might rely on APIs not detected or if we want to override.
            // But actually, replacing the built-in 'pip' is better.
            // If we name it 'pip', it might override or duplicate.
            // Let's rely on this custom one being added.
          }
        }
      ],
      plugins: [
        artplayerPluginHlsControl({
          quality: {
            control: true,
            setting: true,
            getName: (level: any) => level.height + 'P',
            title: 'Quality',
            auto: 'Auto',
          },
          audio: {
            control: true,
            setting: true,
            getName: (track: any) => track.name,
            title: 'Audio',
            auto: 'Auto',
          }
        }),
      ]
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
    autoplay: false,
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

  // Actually, standard ArtPlayer allows extending.
  // We'll handle the HLS debug in the effect below if reasonable,
  // OR we modify the _Artplayer nested component to accept debug prop.


  return (
    <div className="flex flex-col h-screen">
      <header className="bg-gray-900 text-white p-4 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link
              href="/"
              className="text-blue-400 hover:text-blue-300 transition-colors"
            >
              ← Home
            </Link>
            <h1 className="text-xl font-bold">{player.name}</h1>
          </div>
        </div>
        {player.description && (
          <p className="text-gray-300 mt-2 text-sm">{player.description}</p>
        )}
      </header>

      <div className="flex-1 bg-black">
        <_Artplayer
          option={playerOption}
          getInstance={(art) => {
            artPlayerRef.current = art;
          }}
          debug={debug}
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