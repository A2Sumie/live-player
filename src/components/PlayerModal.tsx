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
        } catch (e) {
          setStreamConfig({ mode: 'udp', configJson: '{}' });
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900">
              {player ? '编辑频道' : '新建频道'}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                频道名称 *
              </label>
              <input
                type="text"
                id="name"
                name="name"
                required
                value={formData.name}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="请输入频道名称"
              />
            </div>

            <div>
              <label htmlFor="pId" className="block text-sm font-medium text-gray-700 mb-1">
                频道 ID *
              </label>
              <input
                type="text"
                id="pId"
                name="pId"
                required
                value={formData.pId}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="请输入唯一频道 ID"
              />
            </div>

            <div>
              <label htmlFor="url" className="block text-sm font-medium text-gray-700 mb-1">
                播放地址（输出）*
              </label>
              <div className="text-xs text-gray-500 mb-1">
                对于 StreamServ 托管频道，这里会在开播后自动更新。
                你可以先填写占位地址（如 `http://pending`）或预期输出地址。
              </div>
              <input
                type="url"
                id="url"
                name="url"
                required
                value={formData.url}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="https://tv.n2nj.moe/live/native.m3u8"
              />
            </div>

            <div>
              <label htmlFor="coverUrl" className="block text-sm font-medium text-gray-700 mb-1">
                封面图地址
              </label>
              <input
                type="url"
                id="coverUrl"
                name="coverUrl"
                value={formData.coverUrl}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="https://example.com/cover.jpg"
              />
            </div>

            {player && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  上传封面
                </label>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="file"
                      id="coverFile"
                      accept="image/*"
                      onChange={handleCoverFileChange}
                      className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                    />
                    <button
                      type="button"
                      onClick={handleCoverUpload}
                      disabled={!coverFile || uploadingCover}
                      className="px-4 py-2 text-sm font-medium text-white bg-green-600 border border-transparent rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {uploadingCover ? '上传中...' : '上传'}
                    </button>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-500">或从视频中抓取：</span>
                      <button
                        type="button"
                        onClick={handlePreviewCapture}
                        disabled={previewingCover || !formData.url}
                        className="px-3 py-1 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {previewingCover ? '抓取中...' : '快速抓取'}
                      </button>
                      <button
                        type="button"
                        onClick={handleMultiFrameCapture}
                        disabled={loadingFrames || !formData.url}
                        className="px-3 py-1 text-sm font-medium text-white bg-purple-600 border border-transparent rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {loadingFrames ? '抓取中...' : '多帧选择'}
                      </button>
                    </div>

                    {formData.url && (formData.url.toLowerCase().includes('.m3u8') || formData.url.toLowerCase().includes('m3u')) && (
                      <div className="text-xs text-blue-600 bg-blue-50 p-2 rounded space-y-1">
                        <div>💡 检测到 HLS 流（.m3u8），抓取可能较慢，请耐心等待</div>
                        {new URL(formData.url).search && (
                          <div>🔑 检测到 URL 参数，抓取时会自动带到所有视频分片</div>
                        )}
                      </div>
                    )}

                    {previewImage && (
                      <div className="space-y-2">
                        <div className="text-sm text-gray-700">抓取预览：</div>
                        <img
                          src={previewImage}
                          alt="封面预览"
                          className="w-full max-w-xs h-auto border rounded-md"
                        />
                        <button
                          type="button"
                          onClick={handleAutoCapture}
                          disabled={capturingCover}
                          className="px-4 py-2 text-sm font-medium text-white bg-green-600 border border-transparent rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {capturingCover ? '上传中...' : '使用这张封面'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
                描述
              </label>
              <textarea
                id="description"
                name="description"
                rows={3}
                value={formData.description}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="请输入频道描述"
              />
            </div>

            <div>
              <label htmlFor="announcement" className="block text-sm font-medium text-gray-700 mb-1">
                公告
              </label>
              <textarea
                id="announcement"
                name="announcement"
                rows={2}
                value={formData.announcement}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="请输入公告内容"
              />
            </div>

            {/* Sources Editor */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  备用信源
                </label>
                <button
                  type="button"
                  onClick={() => setSources([...sources, { label: '', url: '' }])}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  + 添加信源
                </button>
              </div>

              <div className="space-y-2">
                {sources.map((source, index) => (
                  <div key={index} className="flex gap-2 items-start">
                    <div className="w-1/3">
                      <input
                        type="text"
                        value={source.label}
                        onChange={(e) => {
                          const newSources = [...sources];
                          newSources[index].label = e.target.value;
                          setSources(newSources);
                        }}
                        placeholder="标签（如：备用）"
                        className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="flex-1">
                      <input
                        type="url"
                        value={source.url}
                        onChange={(e) => {
                          const newSources = [...sources];
                          newSources[index].url = e.target.value;
                          setSources(newSources);
                        }}
                        placeholder="流地址"
                        className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const newSources = sources.filter((_, i) => i !== index);
                        setSources(newSources);
                      }}
                      className="text-red-500 hover:text-red-700 px-1"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
                {sources.length === 0 && (
                  <div className="text-xs text-gray-400 italic">当前未配置备用信源</div>
                )}
              </div>
            </div>

            <div className="border-t border-gray-200 pt-4 mt-4">
              <h3 className="text-lg font-medium text-gray-900 mb-3">流配置（Echo）</h3>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">模式</label>
                <div className="flex gap-4">
                  <label className="inline-flex items-center">
                    <input
                      type="radio"
                      className="form-radio text-blue-600"
                      name="mode"
                      value="udp"
                      checked={streamConfig.mode === 'udp'}
                      onChange={(e) => setStreamConfig({ ...streamConfig, mode: e.target.value })}
                    />
                    <span className="ml-2">直接 UDP 推流</span>
                  </label>
                  <label className="inline-flex items-center">
                    <input
                      type="radio"
                      className="form-radio text-blue-600"
                      name="mode"
                      value="echo"
                      checked={streamConfig.mode === 'echo'}
                      onChange={(e) => setStreamConfig({ ...streamConfig, mode: e.target.value })}
                    />
                    <span className="ml-2">Echo 远程 M3U8</span>
                  </label>
                </div>
              </div>

              {streamConfig.mode === 'echo' && (
                <div className="space-y-4 bg-gray-50 p-4 rounded-md border border-gray-200">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      流配置（JSON）
                      <span className="text-gray-500 text-xs ml-2">粘贴扩展导出的完整 DRM 包</span>
                    </label>
                    <div className="text-xs text-blue-600 bg-blue-50 p-2 rounded mb-2">
                      💡 直接粘贴 Chrome 扩展导出的完整 JSON。streams、licenses、cookies、PSSH 等信息都会被原样保留。
                    </div>
                    <textarea
                      rows={12}
                      value={streamConfig.configJson}
                      onChange={(e) => setStreamConfig({ ...streamConfig, configJson: e.target.value })}
                      className="w-full px-3 py-2 border border-blue-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 font-mono text-xs"
                      placeholder='{"mode":"echo","streams":[...],"licenses":[...],"cookies_b64":"..."}'
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? '保存中...' : (player ? '更新' : '创建')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
