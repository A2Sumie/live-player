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
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [capturingCover, setCapturingCover] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewingCover, setPreviewingCover] = useState(false);
  const [showCoverSelector, setShowCoverSelector] = useState(false);
  const [coverFrames, setCoverFrames] = useState<CoverFrame[]>([]);
  const [loadingFrames, setLoadingFrames] = useState(false);

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
      } else {
        setFormData({
          name: '',
          pId: '',
          description: '',
          url: '',
          coverUrl: '',
          announcement: ''
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
    onSubmit(formData);
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
        alert('Cover image uploaded successfully!');
        setCoverFile(null);
        // Reset file input
        const fileInput = document.getElementById('coverFile') as HTMLInputElement;
        if (fileInput) fileInput.value = '';
      } else {
        const error = await response.json();
        alert((error as { error: string }).error || 'Failed to upload cover image');
      }
    } catch (error) {
      console.error('Error uploading cover:', error);
      alert('Failed to upload cover image');
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
        alert('Unable to use preview image');
        return;
      }
    } else {
      // If no preview, capture directly from video
      const videoUrl = formData.url || player.url;
      if (!videoUrl) {
        alert('Please enter video URL first');
        return;
      }
      
      try {
        imageBlob = await captureCoverImage(videoUrl);
      } catch (error) {
        console.error('Error capturing cover:', error);
        alert('Cover capture failed, please check if the video URL is correct');
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
        alert('Cover uploaded successfully!');
        setPreviewImage(null); // Clear preview image
      } else {
        const error = await response.json();
        alert((error as { error: string }).error || 'Cover upload failed');
      }
    } catch (error) {
      console.error('Error uploading cover:', error);
      alert('Cover upload failed');
    }
    setCapturingCover(false);
  };

  const handlePreviewCapture = async () => {
    // Use URL from form data, or player URL if not available
    const videoUrl = formData.url || player?.url;
    if (!videoUrl) {
      alert('Please enter video URL first');
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
      
      let errorMessage = 'Preview failed, please check if the video URL is correct';
      if (isHlsUrl) {
        errorMessage = 'HLS stream preview failed, please check:\n1. Is the URL correct\n2. Is the video stream accessible\n3. Are there CORS restrictions';
      }
      
      alert(errorMessage);
    }
    setPreviewingCover(false);
  };

  const handleMultiFrameCapture = async () => {
    const videoUrl = formData.url || player?.url;
    if (!videoUrl) {
      alert('Please enter video URL first');
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
      alert('Batch capture failed, please check if the video URL is correct');
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
        alert('Cover uploaded successfully!');
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
        alert((error as { error: string }).error || 'Cover upload failed');
      }
    } catch (error) {
      console.error('Error uploading selected frame:', error);
      alert('Cover upload failed');
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
              {player ? 'Edit Player' : 'Create Player'}
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
                Player Name *
              </label>
              <input
                type="text"
                id="name"
                name="name"
                required
                value={formData.name}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter player name"
              />
            </div>

            <div>
              <label htmlFor="pId" className="block text-sm font-medium text-gray-700 mb-1">
                Player ID *
              </label>
              <input
                type="text"
                id="pId"
                name="pId"
                required
                value={formData.pId}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter unique player ID"
              />
            </div>

            <div>
              <label htmlFor="url" className="block text-sm font-medium text-gray-700 mb-1">
                Player URL *
              </label>
              <input
                type="url"
                id="url"
                name="url"
                required
                value={formData.url}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="https://example.com/stream.m3u8"
              />
            </div>

            <div>
              <label htmlFor="coverUrl" className="block text-sm font-medium text-gray-700 mb-1">
                Cover Image URL
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
                  Cover Image Upload
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
                      {uploadingCover ? 'Uploading...' : 'Upload'}
                    </button>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-500">Or capture from video:</span>
                      <button
                        type="button"
                        onClick={handlePreviewCapture}
                        disabled={previewingCover || !formData.url}
                        className="px-3 py-1 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {previewingCover ? 'Capturing...' : 'Quick Capture'}
                      </button>
                      <button
                        type="button"
                        onClick={handleMultiFrameCapture}
                        disabled={loadingFrames || !formData.url}
                        className="px-3 py-1 text-sm font-medium text-white bg-purple-600 border border-transparent rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {loadingFrames ? 'Capturing...' : 'Multi-frame Selection'}
                      </button>
                    </div>
                    
                    {formData.url && (formData.url.toLowerCase().includes('.m3u8') || formData.url.toLowerCase().includes('m3u')) && (
                      <div className="text-xs text-blue-600 bg-blue-50 p-2 rounded space-y-1">
                        <div>💡 HLS stream (.m3u8) detected, capture may take longer, please be patient</div>
                        {new URL(formData.url).search && (
                          <div>🔑 URL parameters detected, will be automatically passed to all video segments</div>
                        )}
                      </div>
                    )}
                    
                    {previewImage && (
                      <div className="space-y-2">
                        <div className="text-sm text-gray-700">Capture Preview:</div>
                        <img 
                          src={previewImage} 
                          alt="Cover preview" 
                          className="w-full max-w-xs h-auto border rounded-md"
                        />
                        <button
                          type="button"
                          onClick={handleAutoCapture}
                          disabled={capturingCover}
                          className="px-4 py-2 text-sm font-medium text-white bg-green-600 border border-transparent rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {capturingCover ? 'Uploading...' : 'Use This Cover'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                id="description"
                name="description"
                rows={3}
                value={formData.description}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter player description"
              />
            </div>

            <div>
              <label htmlFor="announcement" className="block text-sm font-medium text-gray-700 mb-1">
                Announcement
              </label>
              <textarea
                id="announcement"
                name="announcement"
                rows={2}
                value={formData.announcement}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter announcement"
              />
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Saving...' : (player ? 'Update' : 'Create')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}