import type { ClipDurationOption, CropMode, ResolutionOption } from './types';

export function parseResolution(res: ResolutionOption): { width: number; height: number } {
  if (res === '480x854') {
    return { width: 480, height: 854 };
  }
  return { width: 720, height: 1280 };
}

export function clampClipWindow(
  requestedStart: number,
  requestedDuration: ClipDurationOption | number,
  totalVideoDuration: number
): { start: number; end: number; duration: number } {
  const safeTotal = Math.max(1, totalVideoDuration);
  const targetDur = Math.min(Math.max(3, requestedDuration), safeTotal);
  const maxStart = Math.max(0, safeTotal - targetDur);
  const start = Math.max(0, Math.min(requestedStart, maxStart));
  const end = Math.min(safeTotal, start + targetDur);
  return {
    start: Number(start.toFixed(2)),
    end: Number(end.toFixed(2)),
    duration: Number((end - start).toFixed(2)),
  };
}

export function buildVerticalCropFilter(params: {
  mode: CropMode;
  targetWidth: number;
  targetHeight: number;
  focusXPercent: number; // -100 to 100
  sourceWidth: number;
  sourceHeight: number;
}): string {
  const { mode, targetWidth, targetHeight, focusXPercent, sourceWidth, sourceHeight } = params;
  const clampedFocus = Math.max(-100, Math.min(100, focusXPercent));
  const safeSrcW = Math.max(16, sourceWidth);
  const safeSrcH = Math.max(16, sourceHeight);

  if (mode === 'fit_blur') {
    return [
      `split=2[bg][fg]`,
      `[bg]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight},boxblur=18:4,eq=brightness=-0.08[bg_blur]`,
      `[fg]scale=${targetWidth}:-2[fg_scaled]`,
      `[bg_blur][fg_scaled]overlay=(W-w)/2:(H-h)/2`,
    ].join(';');
  }

  // Compute source crop dimensions preserving 9:16 aspect ratio
  const targetRatio = targetWidth / targetHeight; // 9 / 16 = 0.5625
  const srcRatio = safeSrcW / safeSrcH;

  if (srcRatio <= targetRatio + 0.01) {
    // Source is already vertical or narrower
    return `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight}`;
  }

  const cropW = Math.min(safeSrcW, Math.round(safeSrcH * targetRatio));
  const cropH = safeSrcH;
  const maxOffset = Math.max(0, safeSrcW - cropW);
  const effectiveFocus = mode === 'center' ? 0 : clampedFocus;
  // focusXPercent: -100 => 0 (left), 0 => maxOffset / 2 (center), +100 => maxOffset (right)
  const cropX = Math.round(((effectiveFocus + 100) / 200) * maxOffset);

  return `crop=${cropW}:${cropH}:${cropX}:0,scale=${targetWidth}:${targetHeight}:flags=lanczos`;
}

export interface StreamUrlValidationResult {
  valid: boolean;
  kind?: 'youtube_live' | 'hls_direct' | 'studio_demo';
  normalizedUrl?: string;
  youtubeVideoId?: string;
  error?: string;
}

const PRIVATE_IP_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

export function extractYouTubeVideoId(urlObj: URL): string | null {
  const host = urlObj.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'youtu.be') {
    const id = urlObj.pathname.split('/').filter(Boolean)[0];
    return id && /^[a-zA-Z0-9_-]{6,20}$/.test(id) ? id : null;
  }
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const vParam = urlObj.searchParams.get('v');
    if (vParam && /^[a-zA-Z0-9_-]{6,20}$/.test(vParam)) {
      return vParam;
    }
    const parts = urlObj.pathname.split('/').filter(Boolean);
    if ((parts[0] === 'live' || parts[0] === 'shorts' || parts[0] === 'embed') && parts[1]) {
      return /^[a-zA-Z0-9_-]{6,20}$/.test(parts[1]) ? parts[1] : null;
    }
  }
  return null;
}

export function validateStreamUrl(rawUrl: string): StreamUrlValidationResult {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, error: 'Stream URL is required.' };
  }

  if (trimmed === 'studio://demo-live') {
    return {
      valid: true,
      kind: 'studio_demo',
      normalizedUrl: 'studio://demo-live',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: 'Enter a valid http:// or https:// stream URL.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: 'Only http:// and https:// stream URLs are permitted.' };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (PRIVATE_IP_PATTERNS.some((re) => re.test(hostname))) {
    return {
      valid: false,
      error: 'Local, private, and metadata network hosts are blocked for security.',
    };
  }

  const ytId = extractYouTubeVideoId(parsed);
  if (ytId) {
    return {
      valid: true,
      kind: 'youtube_live',
      normalizedUrl: parsed.toString(),
      youtubeVideoId: ytId,
    };
  }

  return {
    valid: true,
    kind: 'hls_direct',
    normalizedUrl: parsed.toString(),
  };
}

export function parseFfmpegProgressTime(outputChunk: string): number | null {
  // Check FFmpeg -progress pipe:1 format: out_time_us=12345678
  const usMatch = outputChunk.match(/out_time_us=(\d+)/);
  if (usMatch) {
    return Number(usMatch[1]) / 1_000_000;
  }
  // Fallback: time=00:00:12.34
  const timeMatch = outputChunk.match(/time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (timeMatch) {
    const h = Number(timeMatch[1]);
    const m = Number(timeMatch[2]);
    const s = Number(timeMatch[3]);
    return h * 3600 + m * 60 + s;
  }
  return null;
}

export function escapeFfmpegFilterPath(filePath: string): string {
  return filePath
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}
