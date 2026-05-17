export type ArchiveKind = 'recording' | 'relay-session' | 'cache';

export type ArchiveSummary = {
  id: string;
  kind: ArchiveKind;
  title: string;
  fileName: string;
  fileExtension: string;
  localPath: string;
  sizeBytes: number;
  modifiedAt: string;
  createdAt: string;
  category: string;
  rootLabel: string;
  pageUrl: string | null;
  sourceUrl: string | null;
};

export type ArchiveUploadDefaults = {
  cookieSourcePath: string;
  helperPath: string;
  pythonPath: string;
  tid: number;
  threads: number;
  submitApi: string;
  line: string;
  copyright: number;
  tags: string[];
};

export type ArchiveSessionMetadata = {
  pid?: string | null;
  name?: string | null;
  m3u8_name?: string | null;
  reason?: string | null;
  archived_at?: string | null;
  session_started_at?: string | null;
  source?: string | null;
  page_url?: string | null;
  segments?: string[];
};

export type ArchiveRelatedFile = {
  name: string;
  path: string;
  sizeBytes: number;
  modifiedAt: string;
};

export type ArchiveDetail = ArchiveSummary & {
  durationSeconds: number | null;
  frameRate: number | null;
  relatedFiles: ArchiveRelatedFile[];
  relatedFileCount: number;
  relatedFilesTruncated: boolean;
  session: ArchiveSessionMetadata | null;
  suggestedUpload: {
    title: string;
    description: string;
    sourceUrl: string;
    tags: string[];
    cookieSourcePath: string;
    tid: number;
    threads: number;
    submitApi: string;
    line: string;
    copyright: number;
  };
};

export type ArchiveFramePreview = {
  timeSeconds: number;
  dataUrl: string;
};

export type ArchiveListResponse = {
  items: ArchiveSummary[];
  defaults: ArchiveUploadDefaults;
};

export type ArchiveFramesResponse = {
  frames: ArchiveFramePreview[];
  frameRate: number | null;
  anchorTimeSeconds: number | null;
  keyFrameTimes: number[];
  keyframeOnly: boolean;
  previousKeyframeTimeSeconds: number | null;
  nextKeyframeTimeSeconds: number | null;
};

export type ArchiveSilenceResponse = {
  status: 'ok' | 'no_audio' | 'unavailable';
  scanWindowSeconds: number;
  jumpOffsetSeconds: number;
  headSilenceEndSeconds: number | null;
  tailSilenceStartSeconds: number | null;
  headJumpTimeSeconds: number | null;
  tailJumpTimeSeconds: number | null;
};

export type ArchiveUploadResult = {
  ok: true;
  title: string;
  sourceUrl: string;
  cookieSourcePath: string;
  uploadedPath: string;
  trimmedPath: string | null;
  trimStrategy: 'passthrough' | 'keyframe_copy' | 'reencode_fallback';
  trimReason: string;
  requestedTrimStartSeconds: number;
  requestedTrimEndSeconds: number;
  appliedTrimStartSeconds: number;
  appliedTrimEndSeconds: number;
  coverPath: string | null;
  bvid: string | null;
  aid: string | null;
  videoUrl: string | null;
  stdout: string;
};
