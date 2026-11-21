import type {
  AppSettings,
  ClipDurationOption,
  CropMode,
  HighlightClip,
  IntroOutroAsset,
  LanguageCode,
  LiveStreamSession,
  MusicTrack,
  ProcessingJob,
  ResolutionOption,
  StudioStateResponse,
  TranscriptSegment,
  VideoRecord,
} from '../../shared/types';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, init);
  const text = await resp.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text || `Request failed with status ${resp.status}`);
  }
  if (!resp.ok) {
    const errMsg =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Request failed with status ${resp.status}`;
    throw new Error(errMsg);
  }
  return data as T;
}

export const api = {
  getState: () => requestJson<StudioStateResponse>('/api/state'),

  uploadVideo: (formData: FormData) =>
    requestJson<{ video: VideoRecord; job: ProcessingJob | null }>('/api/videos/upload', {
      method: 'POST',
      body: formData,
    }),

  loadSampleVideo: (opts: {
    clipDuration: ClipDurationOption;
    language: LanguageCode;
    resolution: ResolutionOption;
    cropMode: CropMode;
    autoAnalyze: boolean;
  }) =>
    requestJson<{ video: VideoRecord; job: ProcessingJob | null; geminiConfigured: boolean }>(
      '/api/videos/sample',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      }
    ),

  analyzeVideo: (
    videoId: string,
    opts: {
      clipDuration: ClipDurationOption;
      language: LanguageCode;
      resolution: ResolutionOption;
      cropMode: CropMode;
    }
  ) =>
    requestJson<{ job: ProcessingJob }>(`/api/videos/${videoId}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    }),

  createManualClip: (
    videoId: string,
    opts: {
      startTime: number;
      duration: number;
      resolution: ResolutionOption;
      cropMode: CropMode;
      language: LanguageCode;
      title?: string;
    }
  ) =>
    requestJson<{ clip: HighlightClip }>(`/api/videos/${videoId}/manual-clip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    }),

  deleteVideo: (videoId: string) =>
    requestJson<{ ok: boolean }>(`/api/videos/${videoId}`, { method: 'DELETE' }),

  updateClip: (clipId: string, patch: Partial<HighlightClip>) =>
    requestJson<{ clip: HighlightClip }>(`/api/clips/${clipId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),

  renderClipPreview: (clipId: string) =>
    requestJson<{ previewUrl: string }>(`/api/clips/${clipId}/preview-render`, {
      method: 'POST',
    }),

  regenerateClipMetadata: (clipId: string) =>
    requestJson<{ title: string; description: string; hashtags: string[] }>(
      `/api/clips/${clipId}/regenerate-metadata`,
      { method: 'POST' }
    ),

  correctCaptions: (clipId: string, language: LanguageCode) =>
    requestJson<{ transcript: TranscriptSegment[] }>(`/api/clips/${clipId}/correct-captions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language }),
    }),

  exportClip: (clipId: string) =>
    requestJson<{ job: ProcessingJob }>(`/api/clips/${clipId}/export`, { method: 'POST' }),

  deleteClip: (clipId: string) =>
    requestJson<{ ok: boolean }>(`/api/clips/${clipId}`, { method: 'DELETE' }),

  resumeJob: (jobId: string) =>
    requestJson<{ job: ProcessingJob }>(`/api/jobs/${jobId}/resume`, { method: 'POST' }),

  startLiveStream: (opts: {
    sourceUrl: string;
    relayHlsUrl?: string;
    authorizedConfirmed: boolean;
    language: LanguageCode;
    clipDuration: ClipDurationOption;
    autoClipThreshold: number;
  }) =>
    requestJson<{ session: LiveStreamSession }>('/api/livestreams/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    }),

  stopLiveStream: (sessionId: string) =>
    requestJson<{ session: LiveStreamSession }>(`/api/livestreams/${sessionId}/stop`, {
      method: 'POST',
    }),

  manualClipLiveStream: (sessionId: string, duration: ClipDurationOption) =>
    requestJson<{ clip: HighlightClip }>(`/api/livestreams/${sessionId}/manual-clip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration }),
    }),

  uploadMusicTrack: (formData: FormData) =>
    requestJson<{ track: MusicTrack }>('/api/assets/music', {
      method: 'POST',
      body: formData,
    }),

  uploadSlateAsset: (formData: FormData) =>
    requestJson<{ asset: IntroOutroAsset }>('/api/assets/slate', {
      method: 'POST',
      body: formData,
    }),

  deleteExport: (exportId: string) =>
    requestJson<{ ok: boolean }>(`/api/exports/${exportId}`, { method: 'DELETE' }),

  updateSettings: (patch: Partial<AppSettings>) =>
    requestJson<{ settings: AppSettings }>('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
};

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, idx)).toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}
