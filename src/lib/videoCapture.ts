export interface CaptureOptions {
  width?: number;
  height?: number;
  quality?: number;
  currentTime?: number; // Capture time point (seconds)
}

// Check if it's an HLS stream
function isHlsUrl(url: string): boolean {
  return url.toLowerCase().includes('.m3u8') || url.toLowerCase().includes('m3u');
}

export async function captureVideoFrame(
  videoUrl: string, 
  options: CaptureOptions = {}
): Promise<Blob> {
  const { width = 400, height = 225, quality = 0.8, currentTime = 2 } = options;

  return new Promise(async (resolve, reject) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Failed to get canvas context'));
      return;
    }

    let hls: any = null;

    // Set video properties
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'metadata';
    
    const cleanup = () => {
      if (hls) {
        hls.destroy();
      }
      video.remove();
      canvas.remove();
    };

    // Set timeout
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Video loading timeout'));
    }, 30000); // 30 second timeout, HLS needs more time

    const onSeekComplete = () => {
      clearTimeout(timeout);
      try {
        // Set canvas dimensions
        canvas.width = width;
        canvas.height = height;
        
        // Draw video frame on canvas
        ctx.drawImage(video, 0, 0, width, height);
        
        // Convert to Blob
        canvas.toBlob((blob) => {
          cleanup();
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to create blob from canvas'));
          }
        }, 'image/jpeg', quality);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    // Error handling
    video.addEventListener('error', (e) => {
      cleanup();
      clearTimeout(timeout);
      reject(new Error(`Video loading failed: ${e.type}`));
    });

    try {
      if (isHlsUrl(videoUrl)) {
        // Dynamically import HLS.js
        const { default: Hls } = await import('hls.js');
        
        if (!Hls.isSupported()) {
          // If HLS.js is not supported, try native playback
          if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = videoUrl;
            video.load();
          } else {
            cleanup();
            clearTimeout(timeout);
            reject(new Error('HLS is not supported in this browser'));
            return;
          }
        } else {
          // Use HLS.js to load
          const originUrlObj = new URL(videoUrl);
          const queryParams = originUrlObj.searchParams;
          
          hls = new Hls({
            enableWorker: false, // May need to disable Worker in some environments
            xhrSetup(xhr: XMLHttpRequest, tsUrl: string) {
              // Add authentication parameters for TS segments and m3u8 files
              if (tsUrl.includes(".ts") || tsUrl.endsWith(".m3u8")) {
                const tsUrlObj = new URL(tsUrl);
                queryParams.forEach((value, key) => {
                  tsUrlObj.searchParams.set(key, value);
                });
                xhr.open("GET", tsUrlObj.toString(), true);
              }
            }
          });
          
          hls.loadSource(videoUrl);
          hls.attachMedia(video);
          
          // HLS error handling
          hls.on(Hls.Events.ERROR, (event: any, data: any) => {
            console.error('HLS error:', data);
            if (data.fatal) {
              cleanup();
              clearTimeout(timeout);
              reject(new Error(`HLS fatal error: ${data.type}`));
            }
          });
        }
      } else {
        // Regular video files
        video.src = videoUrl;
        video.load();
      }

      // Listen for video metadata loading completion
      video.addEventListener('loadedmetadata', () => {
        // Jump to specified time point
        video.currentTime = currentTime;
      });

      // Listen for time update events
      video.addEventListener('seeked', onSeekComplete, { once: true });
      
    } catch (error) {
      cleanup();
      clearTimeout(timeout);
      reject(new Error(`Failed to load video: ${error}`));
    }
  });
}

// Multiple frame capture interface
export interface CoverFrame {
  blob: Blob;
  previewUrl: string;
  timepoint: number;
}

// Get single segment duration (usually 2-10 seconds)
async function getSegmentDuration(videoUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');

    const cleanup = () => {
      video.remove();
    };

    const timeout = setTimeout(() => {
      cleanup();
      resolve(6); // Default 6 seconds for segments
    }, 8000); // Reduced timeout time

    video.muted = true;
    video.preload = 'metadata';
    video.crossOrigin = 'anonymous';

    video.addEventListener('loadedmetadata', () => {
      clearTimeout(timeout);
      const duration = video.duration || 6;
      cleanup();
      // For segments, usually 2-10 seconds
      resolve(Math.min(duration, 10));
    }, { once: true });

    video.addEventListener('error', () => {
      clearTimeout(timeout);
      cleanup();
      resolve(6);
    }, { once: true });

    // Set URL directly, whether it's a TS file or other format
    video.src = videoUrl;
    video.load();
  });
}

// Parse HLS manifest to get the first TS segment URL
async function getFirstSegmentUrl(hlsUrl: string): Promise<string> {
  try {
    const originUrlObj = new URL(hlsUrl);
    const queryParams = originUrlObj.searchParams;
    
    const response = await fetch(hlsUrl);
    if (!response.ok) {
      throw new Error('Failed to fetch HLS manifest');
    }
    
    const manifestText = await response.text();
    const lines = manifestText.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine && !trimmedLine.startsWith('#')) {
        // Found the first TS segment
        let segmentUrl: string;
        if (trimmedLine.startsWith('http')) {
          segmentUrl = trimmedLine;
        } else {
          // Relative path, construct absolute URL
          const baseUrl = new URL(hlsUrl);
          segmentUrl = new URL(trimmedLine, baseUrl.href).href;
        }
        
        // Add query parameters from the original URL
        if (queryParams.size > 0) {
          const segmentUrlObj = new URL(segmentUrl);
          queryParams.forEach((value, key) => {
            segmentUrlObj.searchParams.set(key, value);
          });
          segmentUrl = segmentUrlObj.toString();
        }
        
        return segmentUrl;
      }
    }
    
    throw new Error('No TS segments found in HLS manifest');
  } catch (error) {
    throw new Error(`Failed to get first segment: ${error}`);
  }
}

// Batch capture multiple frames from a single segment (optimized version)
export async function captureMultipleFrames(
  videoUrl: string, 
  frameCount: number = 8,
  options: Omit<CaptureOptions, 'currentTime'> = {}
): Promise<CoverFrame[]> {
  const isHls = isHlsUrl(videoUrl);
  let targetUrl = videoUrl;
  
  // If it's an HLS stream, get the direct URL of the first TS segment
  if (isHls) {
    try {
      targetUrl = await getFirstSegmentUrl(videoUrl);
      console.log('Using first TS segment:', targetUrl);
    } catch (error) {
      console.error('Failed to get TS segment, using quick capture logic:', error);
      // Use quick capture logic when failed
      return await fallbackToQuickCapture(videoUrl, frameCount, options);
    }
  }
  
  // Use quick capture logic to handle TS segments
  return await captureFramesFromSegment(targetUrl, frameCount, options);
}

// Fallback to quick capture logic
async function fallbackToQuickCapture(
  videoUrl: string,
  frameCount: number,
  options: Omit<CaptureOptions, 'currentTime'> = {}
): Promise<CoverFrame[]> {
  const frames: CoverFrame[] = [];
  
  // Evenly distribute between 2-8 seconds
  const timePoints = Array.from({ length: frameCount }, (_, i) => {
    return 2 + (6 / (frameCount - 1)) * i;
  });

  // Concurrent capture of multiple frames using existing quick capture logic
  const promises = timePoints.map(async (timepoint, index) => {
    try {
      const blob = await captureVideoFrame(videoUrl, {
        ...options,
        width: options.width || 320,
        height: options.height || 180,
        quality: options.quality || 0.7,
        currentTime: timepoint
      });
      
      return {
        blob,
        previewUrl: URL.createObjectURL(blob),
        timepoint,
        index
      };
    } catch (error) {
      console.error(`Failed to capture frame ${index + 1}:`, error);
      return null;
    }
  });

  const results = await Promise.all(promises);
  
  // Filter out failed frames and sort by order
  return results
    .filter((frame): frame is NonNullable<typeof frame> => frame !== null)
    .sort((a, b) => a.index - b.index)
    .map(({ blob, previewUrl, timepoint }) => ({ blob, previewUrl, timepoint }));
}

// Capture multiple frames from TS segment
async function captureFramesFromSegment(
  segmentUrl: string,
  frameCount: number,
  options: Omit<CaptureOptions, 'currentTime'> = {}
): Promise<CoverFrame[]> {
  const { width = 320, height = 180, quality = 0.7 } = options;
  
  // Assume TS segment is 6 seconds, distribute between 0.5-5.5 seconds
  const timePoints = Array.from({ length: frameCount }, (_, i) => {
    return 0.5 + (5 / (frameCount - 1)) * i;
  });

  // Concurrent capture of multiple frames, all using the same TS segment URL
  const promises = timePoints.map(async (timepoint, index) => {
    try {
      const blob = await captureVideoFrame(segmentUrl, {
        width,
        height,
        quality,
        currentTime: timepoint
      });
      
      return {
        blob,
        previewUrl: URL.createObjectURL(blob),
        timepoint,
        index
      };
    } catch (error) {
      console.error(`Failed to capture frame ${index + 1} from segment:`, error);
      return null;
    }
  });

  const results = await Promise.all(promises);
  
  // Filter out failed frames and sort by order
  return results
    .filter((frame): frame is NonNullable<typeof frame> => frame !== null)
    .sort((a, b) => a.index - b.index)
    .map(({ blob, previewUrl, timepoint }) => ({ blob, previewUrl, timepoint }));
}

// Simplified capture function - specifically for getting cover images
export async function captureCoverImage(videoUrl: string): Promise<Blob> {
  // Use different default parameters based on URL type
  const isHls = isHlsUrl(videoUrl);
  
  return captureVideoFrame(videoUrl, {
    width: 400,
    height: 225,
    quality: 0.8,
    currentTime: isHls ? 5 : 2 // HLS streams need longer buffer time
  });
}

// Function specifically for HLS streams (backward compatible)
export async function captureHlsVideoFrame(
  hlsUrl: string,
  options: CaptureOptions = {}
): Promise<Blob> {
  const extendedOptions = {
    currentTime: 5, // HLS streams usually need more time to prepare
    ...options
  };

  return captureVideoFrame(hlsUrl, extendedOptions);
}