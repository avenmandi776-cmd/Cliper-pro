export type LanguageCode = 'en' | 'hi' | 'bn';

export type ClipDurationOption = 15 | 30 | 45 | 60;

export type ResolutionOption = '720x1280' | '480x854';

export type SubtitleStylePreset =
  | 'viral_pop'
  | 'clean_minimal'
  | 'karaoke_glow'
  | 'editorial_classic';

export type SubtitlePosition = 'top' | 'middle' | 'bottom';

export type CropMode = 'auto_face' | 'center' | 'fit_blur';

export type SidebarTab =
  | 'dashboard'
  | 'upload'
  | 'livestream'
  | 'clips'
  | 'captions'
  | 'editor'
  | 'exports'
  | 'settings';

export interface TranscriptWord {
  word: string;
  start: number; // seconds
  end: number; // seconds
  important?: boolean;
}

export interface TranscriptSegment {
  id: string;
  start: number; // seconds
  end: number; // seconds
  text: string;
  speaker?: string;
  words: TranscriptWord[];
}

export interface SubtitleConfig {
  enabled: boolean;
  language: LanguageCode;
  stylePreset: SubtitleStylePreset;
  fontFamily: string;
  fontSize: number; // 24 - 64
  primaryColor: string; // #RRGGBB
  highlightColor: string; // #RRGGBB
  position: SubtitlePosition;
  wordByWord: boolean;
}

export interface VideoRecord {
  id: string;
  title: string;
  filename: string;
  filePath: string;
  thumbnailPath: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  sizeBytes: number;
  language: LanguageCode;
  sourceType: 'upload' | 'sample' | 'livestream';
  summary?: string;
  transcript: TranscriptSegment[];
  createdAt: string;
}

export interface HighlightClip {
  id: string;
  videoId: string;
  title: string;
  description: string;
  hashtags: string[];
  startTime: number;
  endTime: number;
  duration: number;
  score: number; // 1 - 100
  category: 'viral' | 'funny' | 'reaction' | 'insight' | 'manual' | 'livestream';
  reason: string;
  previewPath: string;
  thumbnailPath: string;
  cropMode: CropMode;
  focusXPercent: number; // -100 to 100 (0 = center)
  resolution: ResolutionOption;
  subtitleConfig: SubtitleConfig;
  musicTrackId: string | null;
  musicVolume: number; // 0 to 1
  introAssetId: string | null;
  outroAssetId: string | null;
  transcript: TranscriptSegment[];
  createdAt: string;
}

export type JobType = 'analyze_video' | 'export_clip' | 'live_capture';

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export type JobStage =
  | 'pending'
  | 'extract_audio'
  | 'transcribe'
  | 'analyze_ai'
  | 'render_clips'
  | 'render_export'
  | 'done';

export interface ProcessingJob {
  id: string;
  type: JobType;
  targetId: string; // videoId, clipId, or streamId
  title: string;
  status: JobStatus;
  stage: JobStage;
  completedStages: JobStage[];
  progress: number; // 0 - 100
  errorMessage?: string;
  canResume: boolean;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ExportRecord {
  id: string;
  clipId: string;
  videoId: string;
  title: string;
  resolution: ResolutionOption;
  filePath: string;
  srtPath: string;
  sizeBytes: number;
  duration: number;
  burnedCaptions: boolean;
  createdAt: string;
}

export interface LiveStreamSegmentLog {
  id: string;
  timestamp: string;
  startSec: number;
  endSec: number;
  audioPeakDb: number;
  transcriptSnippet: string;
  highlightScore: number | null;
  highlightReason?: string;
  autoClippedClipId?: string;
}

export interface LiveStreamSession {
  id: string;
  title: string;
  sourceUrl: string;
  streamKind: 'hls_direct' | 'youtube_live' | 'studio_demo';
  authorizedConfirmed: boolean;
  status: 'idle' | 'monitoring' | 'stopped' | 'error';
  language: LanguageCode;
  clipDuration: ClipDurationOption;
  autoClipThreshold: number;
  elapsedSeconds: number;
  segmentsCaptured: number;
  autoClipsCreated: number;
  previewSegmentPath?: string;
  youtubeMeta?: {
    videoId: string;
    title: string;
    authorName: string;
    thumbnailUrl: string;
  };
  logs: LiveStreamSegmentLog[];
  errorMessage?: string;
  startedAt: string;
}

export interface MusicTrack {
  id: string;
  name: string;
  mood: string;
  duration: number;
  filePath: string;
  isBuiltIn: boolean;
}

export interface IntroOutroAsset {
  id: string;
  name: string;
  kind: 'intro' | 'outro';
  duration: number;
  filePath: string;
  isBuiltIn: boolean;
}

export interface AppSettings {
  geminiModel: string;
  ffmpegThreads: number;
  defaultClipDuration: ClipDurationOption;
  defaultResolution: ResolutionOption;
  defaultLanguage: LanguageCode;
  lowResourceMode: boolean;
  autoReframeDefault: CropMode;
}

export interface StudioStateResponse {
  videos: VideoRecord[];
  clips: HighlightClip[];
  jobs: ProcessingJob[];
  exports: ExportRecord[];
  liveSessions: LiveStreamSession[];
  musicTracks: MusicTrack[];
  introOutroAssets: IntroOutroAsset[];
  settings: AppSettings;
  capabilities: {
    geminiConfigured: boolean;
    whisperConfigured: boolean;
    ffmpegAvailable: boolean;
    ffmpegVersion: string;
  };
}
