'use client';

import { useState, useEffect } from 'react';
import type { CoverFrame } from '@/lib/videoCapture';

interface CoverSelectorProps {
  frames: CoverFrame[];
  onSelect: (frame: CoverFrame) => void;
  onCancel: () => void;
  loading?: boolean;
}

export default function CoverSelector({ frames, onSelect, onCancel, loading }: CoverSelectorProps) {
  const [selectedFrame, setSelectedFrame] = useState<CoverFrame | null>(null);

  // Clean up URL objects
  useEffect(() => {
    return () => {
      frames.forEach(frame => {
        if (frame.previewUrl) {
          URL.revokeObjectURL(frame.previewUrl);
        }
      });
    };
  }, [frames]);

  // Format time display
  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const handleConfirm = () => {
    if (selectedFrame) {
      onSelect(selectedFrame);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg p-6 max-w-4xl mx-auto">
        <h3 className="text-lg font-semibold mb-4">Capturing frames from first segment...</h3>
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-3 text-gray-600">Analyzing segment content, please wait...</span>
        </div>
      </div>
    );
  }

  if (frames.length === 0) {
    return (
      <div className="bg-white rounded-lg p-6 max-w-4xl mx-auto">
        <h3 className="text-lg font-semibold mb-4">Capture Failed</h3>
        <p className="text-gray-600 mb-4">Unable to capture cover frames from video, please check if the video URL is correct.</p>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Select Cover Image</h3>
        <span className="text-sm text-gray-500">
          Captured {frames.length} frames from first segment, please select one as cover
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-6">
        {frames.map((frame, index) => (
          <div
            key={index}
            className={`relative cursor-pointer rounded-lg overflow-hidden border-2 transition-all ${
              selectedFrame === frame
                ? 'border-blue-500 ring-2 ring-blue-200'
                : 'border-gray-200 hover:border-gray-300'
            }`}
            onClick={() => setSelectedFrame(frame)}
          >
            <img
              src={frame.previewUrl}
              alt={`Frame ${index + 1}`}
              className="w-full h-auto aspect-video object-cover"
            />
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
              <div className="text-white text-xs">
                <div>Frame {index + 1}</div>
                <div>{formatTime(frame.timepoint)}</div>
              </div>
            </div>
            {selectedFrame === frame && (
              <div className="absolute top-2 right-2">
                <div className="bg-blue-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">
                  ✓
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-between items-center">
        <div className="text-sm text-gray-600">
          {selectedFrame ? (
            <span>
              Selected: Frame {frames.indexOf(selectedFrame) + 1} 
              ({formatTime(selectedFrame.timepoint)})
            </span>
          ) : (
            <span>Please select a cover frame</span>
          )}
        </div>
        
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedFrame}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Confirm Selection
          </button>
        </div>
      </div>
    </div>
  );
}