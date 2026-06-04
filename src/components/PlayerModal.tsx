'use client';

import { useState, useEffect } from 'react';
import type { Player } from '@/lib/db';
import { captureCoverImage, captureMultipleFrames, type CoverFrame } from '@/lib/videoCapture';
import CoverSelector from './CoverSelector';

interface PlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (player: Omit<Player, 'id' | 'createdAt' | 'updatedAt' | 'coverImage'>) => void;
  player?: Player | null;
  loading?: boolean;
}

export default function PlayerModal({ isOpen, onClose, onSubmit, player, loading }: PlayerModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    pId: '',
    description: '',
    url: '',
    coverUrl: '',
    announcement: ''
  });
  const [streamConfig, setStreamConfig] = useState({
    mode: 'udp', // 'udp' | 'echo'
    configJson: '{}' // Full JSON config for echo mode
  });
  const [realtimeText, setRealtimeText] = useState({
    enabled: false,
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
  });
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [capturingCover, setCapturingCover] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewingCover, setPreviewingCover] = useState(false);
  const [showCoverSelector, setShowCoverSelector] = useState(false);
  const [coverFrames, setCoverFrames] = useState<CoverFrame[]>([]);
  const [loadingFrames, setLoadingFrames] = useState(false);

  const [sources, setSources] = useState<{ label: string; url: string }[]>([]);

  useEffect(() => {
    if (isOpen) {
      if (player) {
        setFormData({
          name: player.name,
          pId: player.pId,
          description: player.description || '',
          url: player.url,
          coverUrl: player.coverUrl || '',
          announcement: player.announcement || ''
        });
        setSources(player.sources || []);
        // Parse streamConfig if available
        try {
          // @ts-ignore
          const config = player.streamConfig ? JSON.parse(player.streamConfig) : { mode: 'udp' };
          setStreamConfig({
            mode: config.mode || 'udp',
            configJson: config.mode === 'echo' ? JSON.stringify(config, null, 2) : '{}'
          });
          setRealtimeText({
            enabled: config.realtimeText?.enabled === true,
            sourceLanguage: config.realtimeText?.sourceLanguage || 'ja-JP',
            targetLanguage: config.realtimeText?.targetLanguage || 'zh-CN',
            subtitleOpacity: typeof config.realtimeText?.subtitleOpacity === 'number' ? config.realtimeText.subtitleOpacity : 0.78,
            subtitleScale: typeof config.realtimeText?.subtitleScale === 'number' ? config.realtimeText.subtitleScale : 1,
            transcriptPanel: config.realtimeText?.transcriptPanel === true,
            showSource: config.realtimeText?.showSource !== false,
            showTranslation: config.realtimeText?.showTranslation !== false,
            showTiming: config.realtimeText?.showTiming !== false,
            cursorMarkers: config.realtimeText?.cursorMarkers !== false,
            cursorIntervalSeconds: typeof config.realtimeText?.cursorIntervalSeconds === 'number'
              ? config.realtimeText.cursorIntervalSeconds
              : 10,
            videoDelaySeconds: typeof config.realtimeText?.videoDelaySeconds === 'number'
              ? config.realtimeText.videoDelaySeconds
              : (typeof config.videoDelaySeconds === 'number' ? config.videoDelaySeconds : 0),
          });
        } catch (e) {
          setStreamConfig({ mode: 'udp', configJson: '{}' });
          setRealtimeText({
            enabled: false,
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
          });
        }
      } else {
        setFormData({
          name: '',
          pId: '',
          description: '',
          url: '',
          coverUrl: '',
          announcement: ''
        });
        setSources([]);
        setStreamConfig({ mode: 'udp', configJson: '{}' });
        setRealtimeText({
          enabled: false,
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
        });
      }
    } else {
      // Clean up preview image URL
      if (previewImage) {
        URL.revokeObjectURL(previewImage);
        setPreviewImage(null);
      }
    }
  }, [isOpen, player]);

  // Cleanup function
  useEffect(() => {
    return () => {
      if (previewImage) {
        URL.revokeObjectURL(previewImage);
      }
    };
  }, [previewImage]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    let finalStreamConfig: any = { mode: streamConfig.mode };

    if (streamConfig.mode === 'echo') {
      try {
        const configStr = streamConfig.configJson?.trim() || '{}';
        const parsedConfig = JSON.parse(configStr);
        // Merge the parsed config (preserve all fields like streams, licenses, cookies_b64, etc.)
        finalStreamConfig = { ...parsedConfig, mode: 'echo' };
      } catch (e) {
        alert('配置字段中的 JSON 无效');
        return;
      }
    }

    finalStreamConfig.realtimeText = {
      enabled: realtimeText.enabled,
      mode: 'both',
      sourceLanguage: realtimeText.sourceLanguage,
      targetLanguage: realtimeText.targetLanguage,
      subtitleOpacity: realtimeText.subtitleOpacity,
      subtitleScale: realtimeText.subtitleScale,
      transcriptPanel: realtimeText.transcriptPanel,
      showSource: realtimeText.showSource,
      showTranslation: realtimeText.showTranslation,
      showTiming: realtimeText.showTiming,
      cursorMarkers: realtimeText.cursorMarkers,
      cursorIntervalSeconds: realtimeText.cursorIntervalSeconds,
      videoDelaySeconds: realtimeText.videoDelaySeconds,
    };
    finalStreamConfig.videoDelaySeconds = realtimeText.videoDelaySeconds;

    // Filter empty sources
    const validSources = sources.filter(s => s.label.trim() && s.url.trim());

    onSubmit({
      ...formData,
      createdBy: null, // Auto-populated by backend
      // @ts-ignore
      streamConfig: finalStreamConfig,
      sources: validSources.length > 0 ? validSources : null
    });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleCoverFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setCoverFile(file || null);
  };

  const handleCoverUpload = async () => {
    if (!coverFile || !player?.id) return;

    setUploadingCover(true);
    try {
      const formData = new FormData();
      formData.append('cover', coverFile);

      const response = await fetch(`/api/players/${player.id}/cover`, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        alert('封面上传成功');
        setCoverFile(null);
        // Reset file input
        const fileInput = document.getElementById('coverFile') as HTMLInputElement;
        if (fileInput) fileInput.value = '';
      } else {
        const error = await response.json();
        alert((error as { error: string }).error || '封面上传失败');
      }
    } catch (error) {
      console.error('Error uploading cover:', error);
      alert('封面上传失败');
    }
    setUploadingCover(false);
  };

  const handleAutoCapture = async () => {
    if (!player?.id) return;

    let imageBlob: Blob;

    // If there's a preview image, use the preview image
    if (previewImage) {
      try {
        const response = await fetch(previewImage);
        imageBlob = await response.blob();
      } catch (error) {
        alert('无法使用预览图');
        return;
      }
    } else {
      // If no preview, capture directly from video
      const videoUrl = formData.url || player.url;
      if (!videoUrl) {
        alert('请先填写视频地址');
        return;
      }

      try {
        imageBlob = await captureCoverImage(videoUrl);
      } catch (error) {
        console.error('Error capturing cover:', error);
        alert('封面抓取失败，请检查视频地址是否正确');
        return;
      }
    }

    setCapturingCover(true);
    try {
      // Upload the captured image
      const formDataToSend = new FormData();
      formDataToSend.append('cover', imageBlob, 'cover.jpg');

      const response = await fetch(`/api/players/${player.id}/cover`, {
        method: 'POST',
        body: formDataToSend,
      });

      if (response.ok) {
        alert('封面上传成功');
        setPreviewImage(null); // Clear preview image
      } else {
        const error = await response.json();
        alert((error as { error: string }).error || '封面上传失败');
      }
    } catch (error) {
      console.error('Error uploading cover:', error);
      alert('封面上传失败');
    }
    setCapturingCover(false);
  };

  const handlePreviewCapture = async () => {
    // Use URL from form data, or player URL if not available
    const videoUrl = formData.url || player?.url;
    if (!videoUrl) {
      alert('请先填写视频地址');
      return;
    }

    const isHlsUrl = videoUrl.toLowerCase().includes('.m3u8') || videoUrl.toLowerCase().includes('m3u');

    setPreviewingCover(true);
    try {
      // Frontend capture video first frame
      const imageBlob = await captureCoverImage(videoUrl);

      // Create preview URL
      const previewUrl = URL.createObjectURL(imageBlob);
      setPreviewImage(previewUrl);
    } catch (error) {
      console.error('Error previewing cover:', error);

      let errorMessage = '预览失败，请检查视频地址是否正确';
      if (isHlsUrl) {
        errorMessage = 'HLS 流预览失败，请检查：\n1. 地址是否正确\n2. 视频流是否可访问\n3. 是否存在 CORS 限制';
      }

      alert(errorMessage);
    }
    setPreviewingCover(false);
  };

  const handleMultiFrameCapture = async () => {
    const videoUrl = formData.url || player?.url;
    if (!videoUrl) {
      alert('请先填写视频地址');
      return;
    }

    setLoadingFrames(true);
    setShowCoverSelector(true);

    try {
      // Capture 8 frames
      const frames = await captureMultipleFrames(videoUrl, 8);
      setCoverFrames(frames);
    } catch (error) {
      console.error('Error capturing multiple frames:', error);
      alert('批量抓帧失败，请检查视频地址是否正确');
      setShowCoverSelector(false);
    }

    setLoadingFrames(false);
  };

  const handleFrameSelect = async (selectedFrame: CoverFrame) => {
    if (!player?.id) return;

    setCapturingCover(true);
    try {
      // Upload selected frame
      const formDataToSend = new FormData();
      formDataToSend.append('cover', selectedFrame.blob, 'cover.jpg');

      const response = await fetch(`/api/players/${player.id}/cover`, {
        method: 'POST',
        body: formDataToSend,
      });

      if (response.ok) {
        alert('封面上传成功');
        setShowCoverSelector(false);
        // Clean up all frame URLs
        coverFrames.forEach(frame => {
          if (frame.previewUrl) {
            URL.revokeObjectURL(frame.previewUrl);
          }
        });
        setCoverFrames([]);
      } else {
        const error = await response.json();
        alert((error as { error: string }).error || '封面上传失败');
      }
    } catch (error) {
      console.error('Error uploading selected frame:', error);
      alert('封面上传失败');
    }
    setCapturingCover(false);
  };

  const handleCancelFrameSelect = () => {
    setShowCoverSelector(false);
    // Clean up all frame URLs
    coverFrames.forEach(frame => {
      if (frame.previewUrl) {
        URL.revokeObjectURL(frame.previewUrl);
      }
    });
    setCoverFrames([]);
  };

  if (!isOpen) return null;

  // If showing cover selector, render cover selection interface
  if (showCoverSelector) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <CoverSelector
          frames={coverFrames}
          onSelect={handleFrameSelect}
          onCancel={handleCancelFrameSelect}
          loading={loadingFrames}
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <div className="max-h-[92vh] w-full max-w-[1240px] overflow-hidden rounded-3xl border border-white/35 bg-white shadow-2xl shadow-slate-900/20">
        <div className="border-b border-slate-200 bg-slate-50/85 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-700/80">Channel Editor</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-900">
                {player ? '编辑频道' : '新建频道'}
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                Echo 模式和完整报文放在左侧主工作区，频道基本信息、封面和备用信源放在右侧。
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-2xl border border-slate-300 bg-white p-2 text-slate-500 transition hover:border-slate-400 hover:text-slate-700"
            >
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex max-h-[calc(92vh-126px)] flex-col">
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.14fr)_minmax(360px,0.86fr)]">
              <div className="space-y-6">
                <section className="rounded-3xl border border-slate-200 bg-slate-50/90 p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">转播与 Echo 配置</h3>
                      <p className="mt-2 text-sm text-slate-600">
                        这里优先放模式切换、输出地址和扩展导出的完整报文。
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white px-3 py-2 text-xs text-slate-500">
                      当前模式: {streamConfig.mode === 'echo' ? 'Echo 远程 M3U8' : '直接 UDP 推流'}
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 lg:grid-cols-2">
                    <label className="space-y-2 text-sm text-slate-700">
                      <span>播放地址（输出）*</span>
                      <div className="text-xs text-slate-500">
                        StreamServ 托管频道开播后会自动刷新；现在可以先填占位地址或目标输出地址。
                      </div>
                      <input
                        type="url"
                        id="url"
                        name="url"
                        required
                        value={formData.url}
                        onChange={handleChange}
                        className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 shadow-sm outline-none ring-0 focus:border-sky-500"
                        placeholder="https://tv.n2nj.moe/live/native.m3u8"
                      />
                    </label>

                    <div className="space-y-2 text-sm text-slate-700">
                      <span className="block">模式</span>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-300 bg-white px-4 py-3">
                          <input
                            type="radio"
                            className="mt-1"
                            name="mode"
                            value="udp"
                            checked={streamConfig.mode === 'udp'}
                            onChange={(e) => setStreamConfig({ ...streamConfig, mode: e.target.value })}
                          />
                          <span>
                            <span className="block font-medium text-slate-900">直接 UDP 推流</span>
                            <span className="mt-1 block text-xs text-slate-500">按频道常规推流配置运行。</span>
                          </span>
                        </label>

                        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-300 bg-white px-4 py-3">
                          <input
                            type="radio"
                            className="mt-1"
                            name="mode"
                            value="echo"
                            checked={streamConfig.mode === 'echo'}
                            onChange={(e) => setStreamConfig({ ...streamConfig, mode: e.target.value })}
                          />
                          <span>
                            <span className="block font-medium text-slate-900">Echo 远程 M3U8</span>
                            <span className="mt-1 block text-xs text-slate-500">粘贴扩展导出的完整 DRM / relay 包。</span>
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>

                  {streamConfig.mode === 'echo' && (
                    <div className="mt-5 rounded-3xl border border-sky-200 bg-white p-4">
                      <label className="block text-sm font-medium text-slate-800">
                        流配置报文（JSON）
                        <span className="ml-2 text-xs text-slate-500">扩展导出的完整 Echo / DRM 包会被原样保留</span>
                      </label>
                      <div className="mt-2 rounded-2xl bg-sky-50 px-3 py-2 text-xs text-sky-700">
                        直接粘贴扩展导出的完整 JSON，streams、licenses、cookies、PSSH 等字段都会一起保存。
                      </div>
                      <textarea
                        rows={18}
                        value={streamConfig.configJson}
                        onChange={(e) => setStreamConfig({ ...streamConfig, configJson: e.target.value })}
                        className="mt-3 min-h-[24rem] w-full rounded-2xl border border-sky-300 bg-slate-950 px-4 py-3 font-mono text-xs leading-6 text-slate-100 shadow-sm outline-none ring-0 focus:border-sky-400"
                        placeholder='{"mode":"echo","streams":[...],"licenses":[...],"cookies_b64":"..."}'
                      />
                    </div>
                  )}

                  {streamConfig.mode !== 'echo' && (
                    <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-white px-4 py-5 text-sm text-slate-600">
                      当前是 UDP 模式，不需要额外报文。若要接 Stagecrowd / DRM / relay 包，请切到 Echo。
                    </div>
                  )}

                  <div className="mt-5 rounded-3xl border border-slate-200 bg-white p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900">实时转写 / 翻译预备接口</h4>
                        <p className="mt-1 text-xs text-slate-500">
                          开启后播放器显示字幕层和转写窗；真实 ASR 链路稍后接入。
                        </p>
                      </div>
                      <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={realtimeText.enabled}
                          onChange={(event) => setRealtimeText({ ...realtimeText, enabled: event.target.checked })}
                        />
                        启用显示
                      </label>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <label className="space-y-1 text-xs text-slate-600">
                        <span>源语言</span>
                        <input
                          type="text"
                          value={realtimeText.sourceLanguage}
                          onChange={(event) => setRealtimeText({ ...realtimeText, sourceLanguage: event.target.value })}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
                        />
                      </label>
                      <label className="space-y-1 text-xs text-slate-600">
                        <span>目标语言</span>
                        <input
                          type="text"
                          value={realtimeText.targetLanguage}
                          onChange={(event) => setRealtimeText({ ...realtimeText, targetLanguage: event.target.value })}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
                        />
                      </label>
                      <label className="space-y-1 text-xs text-slate-600">
                        <span>字幕透明度</span>
                        <input
                          type="range"
                          min="0.2"
                          max="1"
                          step="0.05"
                          value={realtimeText.subtitleOpacity}
                          onChange={(event) => setRealtimeText({ ...realtimeText, subtitleOpacity: Number(event.target.value) })}
                          className="w-full"
                        />
                      </label>
                      <label className="space-y-1 text-xs text-slate-600">
                        <span>字幕字号</span>
                        <input
                          type="range"
                          min="0.8"
                          max="1.5"
                          step="0.05"
                          value={realtimeText.subtitleScale}
                          onChange={(event) => setRealtimeText({ ...realtimeText, subtitleScale: Number(event.target.value) })}
                          className="w-full"
                        />
                      </label>
                    </div>

                    <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={realtimeText.transcriptPanel}
                        onChange={(event) => setRealtimeText({ ...realtimeText, transcriptPanel: event.target.checked })}
                      />
                      非全屏时显示右侧转写窗口
                    </label>
                    <div className="mt-3 grid gap-2 text-sm text-slate-700 md:grid-cols-2">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={realtimeText.showTranslation}
                          onChange={(event) => setRealtimeText({ ...realtimeText, showTranslation: event.target.checked })}
                        />
                        显示译文字幕
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={realtimeText.showSource}
                          onChange={(event) => setRealtimeText({ ...realtimeText, showSource: event.target.checked })}
                        />
                        显示原文字幕
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={realtimeText.showTiming}
                          onChange={(event) => setRealtimeText({ ...realtimeText, showTiming: event.target.checked })}
                        />
                        显示时间差
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={realtimeText.cursorMarkers}
                          onChange={(event) => setRealtimeText({ ...realtimeText, cursorMarkers: event.target.checked })}
                        />
                        每段色标
                      </label>
                    </div>
                    <label className="mt-3 block space-y-1 text-xs text-slate-600">
                      <span>色标间隔（秒）</span>
                      <input
                        type="number"
                        min="5"
                        max="60"
                        step="1"
                        value={realtimeText.cursorIntervalSeconds}
                        onChange={(event) => setRealtimeText({
                          ...realtimeText,
                          cursorIntervalSeconds: Number(event.target.value),
                        })}
                        className="w-32 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
                      />
                    </label>
                    <label className="mt-3 block space-y-1 text-xs text-slate-600">
                      <span>字幕追加延迟（秒）</span>
                      <input
                        type="number"
                        min="0"
                        max="30"
                        step="1"
                        value={realtimeText.videoDelaySeconds}
                        onChange={(event) => setRealtimeText({
                          ...realtimeText,
                          videoDelaySeconds: Number(event.target.value),
                        })}
                        className="w-32 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
                      />
                    </label>
                  </div>
                </section>

                <section className="rounded-3xl border border-slate-200 bg-slate-50/90 p-5">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">备用信源</h3>
                      <p className="mt-1 text-sm text-slate-600">这里保留多路备用源，不影响左侧主 Echo 报文。</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSources([...sources, { label: '', url: '' }])}
                      className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      添加信源
                    </button>
                  </div>

                  <div className="space-y-3">
                    {sources.map((source, index) => (
                      <div key={index} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 lg:grid-cols-[180px_minmax(0,1fr)_44px]">
                        <input
                          type="text"
                          value={source.label}
                          onChange={(e) => {
                            const newSources = [...sources];
                            newSources[index].label = e.target.value;
                            setSources(newSources);
                          }}
                          placeholder="标签（如：备用）"
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none ring-0 focus:border-sky-500"
                        />
                        <input
                          type="url"
                          value={source.url}
                          onChange={(e) => {
                            const newSources = [...sources];
                            newSources[index].url = e.target.value;
                            setSources(newSources);
                          }}
                          placeholder="流地址"
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none ring-0 focus:border-sky-500"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const newSources = sources.filter((_, i) => i !== index);
                            setSources(newSources);
                          }}
                          className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-rose-600 transition hover:bg-rose-100"
                        >
                          <svg className="mx-auto h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}

                    {sources.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
                        当前未配置备用信源。
                      </div>
                    )}
                  </div>
                </section>
              </div>

              <div className="space-y-6">
                <section className="rounded-3xl border border-slate-200 bg-slate-50/90 p-5">
                  <h3 className="text-lg font-semibold text-slate-900">频道基础信息</h3>
                  <p className="mt-2 text-sm text-slate-600">名称、PID、封面、描述和公告集中放在这里。</p>

                  <div className="mt-5 grid gap-4">
                    <label className="space-y-2 text-sm text-slate-700">
                      <span>频道名称 *</span>
                      <input
                        type="text"
                        id="name"
                        name="name"
                        required
                        value={formData.name}
                        onChange={handleChange}
                        className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 shadow-sm outline-none ring-0 focus:border-sky-500"
                        placeholder="请输入频道名称"
                      />
                    </label>

                    <label className="space-y-2 text-sm text-slate-700">
                      <span>频道 ID *</span>
                      <input
                        type="text"
                        id="pId"
                        name="pId"
                        required
                        value={formData.pId}
                        onChange={handleChange}
                        className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 shadow-sm outline-none ring-0 focus:border-sky-500"
                        placeholder="请输入唯一频道 ID"
                      />
                    </label>

                    <label className="space-y-2 text-sm text-slate-700">
                      <span>封面图地址</span>
                      <input
                        type="url"
                        id="coverUrl"
                        name="coverUrl"
                        value={formData.coverUrl}
                        onChange={handleChange}
                        className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 shadow-sm outline-none ring-0 focus:border-sky-500"
                        placeholder="https://example.com/cover.jpg"
                      />
                    </label>

                    <label className="space-y-2 text-sm text-slate-700">
                      <span>描述</span>
                      <textarea
                        id="description"
                        name="description"
                        rows={4}
                        value={formData.description}
                        onChange={handleChange}
                        className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 shadow-sm outline-none ring-0 focus:border-sky-500"
                        placeholder="请输入频道描述"
                      />
                    </label>

                    <label className="space-y-2 text-sm text-slate-700">
                      <span>公告</span>
                      <textarea
                        id="announcement"
                        name="announcement"
                        rows={4}
                        value={formData.announcement}
                        onChange={handleChange}
                        className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 shadow-sm outline-none ring-0 focus:border-sky-500"
                        placeholder="请输入公告内容"
                      />
                    </label>
                  </div>
                </section>

                {player && (
                  <section className="rounded-3xl border border-slate-200 bg-slate-50/90 p-5">
                    <h3 className="text-lg font-semibold text-slate-900">封面操作</h3>
                    <p className="mt-2 text-sm text-slate-600">支持本地上传或从当前视频地址抓帧后作为封面。</p>

                    <div className="mt-5 space-y-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                        <input
                          type="file"
                          id="coverFile"
                          accept="image/*"
                          onChange={handleCoverFileChange}
                          className="block w-full text-sm text-slate-500 file:mr-4 file:rounded-2xl file:border-0 file:bg-sky-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-sky-700 hover:file:bg-sky-100"
                        />
                        <button
                          type="button"
                          onClick={handleCoverUpload}
                          disabled={!coverFile || uploadingCover}
                          className="rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {uploadingCover ? '上传中...' : '上传'}
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={handlePreviewCapture}
                          disabled={previewingCover || !formData.url}
                          className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {previewingCover ? '抓取中...' : '快速抓取'}
                        </button>
                        <button
                          type="button"
                          onClick={handleMultiFrameCapture}
                          disabled={loadingFrames || !formData.url}
                          className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {loadingFrames ? '抓取中...' : '多帧选择'}
                        </button>
                      </div>

                      {formData.url && (formData.url.toLowerCase().includes('.m3u8') || formData.url.toLowerCase().includes('m3u')) && (
                        <div className="space-y-1 rounded-2xl bg-sky-50 px-4 py-3 text-xs text-sky-700">
                          <div>检测到 HLS 地址，抓帧可能较慢。</div>
                          {new URL(formData.url).search && (
                            <div>检测到 URL 参数，抓取时会一并带到相关请求。</div>
                          )}
                        </div>
                      )}

                      {previewImage && (
                        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="text-sm font-medium text-slate-800">抓取预览</div>
                          <img
                            src={previewImage}
                            alt="封面预览"
                            className="h-auto w-full max-w-sm rounded-2xl border border-slate-200"
                          />
                          <button
                            type="button"
                            onClick={handleAutoCapture}
                            disabled={capturingCover}
                            className="rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {capturingCover ? '上传中...' : '使用这张封面'}
                          </button>
                        </div>
                      )}
                    </div>
                  </section>
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 bg-white px-6 py-4">
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-2xl border border-slate-300 bg-slate-100 px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={loading}
                className="rounded-2xl bg-sky-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? '保存中...' : (player ? '更新频道' : '创建频道')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
