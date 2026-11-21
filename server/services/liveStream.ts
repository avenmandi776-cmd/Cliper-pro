import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  ClipDurationOption,
  HighlightClip,
  LanguageCode,
  LiveStreamSegmentLog,
  LiveStreamSession,
  SubtitleConfig,
} from '../../shared/types';
import { validateStreamUrl } from '../../shared/videoMath';
import {
  analyzeAudioPeakDb,
  concatMp4Segments,
  extractAudio,
  generateLiveDemoSegment,
  generateThumbnail,
  probeMedia,
  renderVerticalClip,
} from './ffmpeg';
import { analyzeHighlightsWithGemini, transcribeAudio } from './gemini';
import { DIRS, getDb, updateDb } from './store';

interface ActiveMonitorHandle {
  stopped: boolean;
  segmentPaths: string[];
  timer?: NodeJS.Timeout;
}

const activeMonitors = new Map<string, ActiveMonitorHandle>();

async function fetchYouTubeOEmbed(videoId: string): Promise<{
  title: string;
  authorName: string;
  thumbnailUrl: string;
} | null> {
  try {
    const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;
    const resp = await fetch(oembedUrl, { signal: AbortSignal.timeout(6000) });
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    };
    return {
      title: data.title || `YouTube Live (${videoId})`,
      authorName: data.author_name || 'YouTube Creator',
      thumbnailUrl: data.thumbnail_url || '',
    };
  } catch {
    return null;
  }
}

function captureHlsSegment(
  streamUrl: string,
  outMp4Path: string,
  durationSec = 15
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ffmpeg',
      [
        '-y',
        '-rw_timeout',
        '8000000',
        '-i',
        streamUrl,
        '-t',
        String(durationSec),
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        outMp4Path,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(outMp4Path)) {
        resolve();
      } else {
        reject(new Error(`Stream capture failed: ${stderr.split('\n').slice(-4).join(' ')}`));
      }
    });
  });
}

export async function startLiveStreamSession(params: {
  sourceUrl: string;
  relayHlsUrl?: string;
  authorizedConfirmed: boolean;
  language: LanguageCode;
  clipDuration: ClipDurationOption;
  autoClipThreshold: number;
}): Promise<LiveStreamSession> {
  if (!params.authorizedConfirmed) {
    throw new Error(
      'You must confirm ownership or explicit authorization before monitoring a live stream.'
    );
  }

  const validation = validateStreamUrl(params.sourceUrl);
  if (!validation.valid || !validation.kind || !validation.normalizedUrl) {
    throw new Error(validation.error || 'Invalid stream URL.');
  }

  let relayValidation: ReturnType<typeof validateStreamUrl> | null = null;
  if (params.relayHlsUrl?.trim()) {
    relayValidation = validateStreamUrl(params.relayHlsUrl);
    if (!relayValidation.valid || relayValidation.kind === 'youtube_live') {
      throw new Error(
        relayValidation.error || 'Authorized companion HLS/media relay URL must be a direct http(s) stream.'
      );
    }
  }

  const sessionId = `live_${crypto.randomUUID().slice(0, 8)}`;
  const sessionDir = path.join(DIRS.live, sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });

  let youtubeMeta: LiveStreamSession['youtubeMeta'];
  let title = 'Authorized Live Broadcast';

  if (validation.kind === 'youtube_live' && validation.youtubeVideoId) {
    const meta = await fetchYouTubeOEmbed(validation.youtubeVideoId);
    youtubeMeta = meta
      ? { videoId: validation.youtubeVideoId, ...meta }
      : {
          videoId: validation.youtubeVideoId,
          title: `YouTube Live Broadcast (${validation.youtubeVideoId})`,
          authorName: 'YouTube Creator',
          thumbnailUrl: '',
        };
    title = youtubeMeta.title;
  } else if (validation.kind === 'studio_demo') {
    title = 'ClipGenius Studio Demo Broadcast';
  } else {
    title = new URL(validation.normalizedUrl).hostname + ' Live Feed';
  }

  const session: LiveStreamSession = {
    id: sessionId,
    title,
    sourceUrl: validation.normalizedUrl,
    streamKind: validation.kind,
    authorizedConfirmed: true,
    status: 'monitoring',
    language: params.language,
    clipDuration: params.clipDuration,
    autoClipThreshold: Math.max(50, Math.min(99, params.autoClipThreshold || 75)),
    elapsedSeconds: 0,
    segmentsCaptured: 0,
    autoClipsCreated: 0,
    youtubeMeta,
    logs: [],
    startedAt: new Date().toISOString(),
  };

  updateDb((db) => {
    // Stop any previously monitoring session to keep container resources lean
    for (const s of db.liveSessions) {
      if (s.status === 'monitoring') {
        s.status = 'stopped';
        const prevHandle = activeMonitors.get(s.id);
        if (prevHandle) prevHandle.stopped = true;
      }
    }
    db.liveSessions.unshift(session);
  });

  const handle: ActiveMonitorHandle = { stopped: false, segmentPaths: [] };
  activeMonitors.set(sessionId, handle);

  const effectiveIngestUrl =
    validation.kind === 'youtube_live'
      ? relayValidation?.normalizedUrl || null
      : validation.normalizedUrl;

  void runMonitorLoop(sessionId, sessionDir, validation.kind, effectiveIngestUrl, handle);

  return session;
}

async function runMonitorLoop(
  sessionId: string,
  sessionDir: string,
  kind: LiveStreamSession['streamKind'],
  ingestUrl: string | null,
  handle: ActiveMonitorHandle
): Promise<void> {
  let segIndex = 0;

  while (!handle.stopped) {
    const db = getDb();
    const session = db.liveSessions.find((s) => s.id === sessionId);
    if (!session || session.status !== 'monitoring') {
      handle.stopped = true;
      break;
    }

    // If YouTube Live without a direct authorized HLS relay, poll metadata & wait cleanly without bypassing DRM
    if (kind === 'youtube_live' && !ingestUrl) {
      updateDb((d) => {
        const s = d.liveSessions.find((item) => item.id === sessionId);
        if (!s) return;
        s.elapsedSeconds += 5;
        if (segIndex === 0) {
          s.logs.unshift({
            id: `log_${Date.now()}`,
            timestamp: new Date().toISOString(),
            startSec: 0,
            endSec: 0,
            audioPeakDb: -24,
            transcriptSnippet:
              'Connected via official YouTube oEmbed API. To ingest live video frames without bypassing platform DRM, attach an authorized HLS/RTMP relay URL or switch to Studio Demo Live Stream.',
            highlightScore: null,
          });
        }
      });
      segIndex++;
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }

    const segPath = path.join(sessionDir, `seg_${String(segIndex).padStart(4, '0')}.mp4`);
    try {
      if (kind === 'studio_demo') {
        await generateLiveDemoSegment(segPath, segIndex);
      } else if (ingestUrl) {
        await captureHlsSegment(ingestUrl, segPath, 15);
      }

      if (handle.stopped) break;

      handle.segmentPaths.push(segPath);
      if (handle.segmentPaths.length > 8) {
        handle.segmentPaths.shift();
      }

      const audioPeakDb = await analyzeAudioPeakDb(segPath);
      const startSec = segIndex * 15;
      const endSec = startSec + 15;

      let transcriptSnippet = `Captured 15s live segment #${segIndex + 1} (audio mean ${audioPeakDb.toFixed(1)} dB).`;
      let highlightScore: number | null = null;
      let highlightReason: string | undefined;
      let autoClippedClipId: string | undefined;

      // Run Gemini transcription & highlight detection if API key is configured
      if (process.env.GEMINI_API_KEY?.trim()) {
        try {
          const mp3Path = path.join(sessionDir, `seg_${segIndex}.mp3`);
          await extractAudio(segPath, mp3Path, db.settings.ffmpegThreads, 15);
          const trans = await transcribeAudio({
            audioPath: mp3Path,
            language: session.language,
            durationSec: 15,
            model: db.settings.geminiModel,
          });
          transcriptSnippet = trans.text || transcriptSnippet;

          const ai = await analyzeHighlightsWithGemini({
            transcript: trans.segments,
            videoTitle: session.title,
            durationSec: 15,
            targetClipDuration: 15,
            language: session.language,
            model: db.settings.geminiModel,
          });

          if (ai.highlights[0]) {
            highlightScore = ai.highlights[0].score;
            highlightReason = ai.highlights[0].reason;

            if (highlightScore >= session.autoClipThreshold) {
              const savedClip = await createClipFromSegmentPaths({
                session,
                segmentPaths: [segPath],
                title: ai.highlights[0].title,
                description: ai.highlights[0].description,
                hashtags: ai.highlights[0].hashtags,
                score: highlightScore,
                reason: highlightReason,
                category: 'livestream',
                transcriptSegments: trans.segments,
              });
              autoClippedClipId = savedClip.id;
            }
          }
          if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path);
        } catch (aiErr) {
          transcriptSnippet = `Captured segment #${segIndex + 1} (AI analysis skipped: ${
            aiErr instanceof Error ? aiErr.message : 'API error'
          })`;
        }
      }

      const logEntry: LiveStreamSegmentLog = {
        id: `log_${crypto.randomUUID().slice(0, 6)}`,
        timestamp: new Date().toISOString(),
        startSec,
        endSec,
        audioPeakDb,
        transcriptSnippet,
        highlightScore,
        highlightReason,
        autoClippedClipId,
      };

      updateDb((d) => {
        const s = d.liveSessions.find((item) => item.id === sessionId);
        if (!s) return;
        s.segmentsCaptured += 1;
        s.elapsedSeconds += 15;
        s.previewSegmentPath = segPath;
        if (autoClippedClipId) s.autoClipsCreated += 1;
        s.logs.unshift(logEntry);
        if (s.logs.length > 40) s.logs.pop();
      });

      segIndex++;
    } catch (err) {
      updateDb((d) => {
        const s = d.liveSessions.find((item) => item.id === sessionId);
        if (!s) return;
        s.status = 'error';
        s.errorMessage = err instanceof Error ? err.message : 'Live capture error';
      });
      handle.stopped = true;
      break;
    }

    // Pace demo loop cleanly so container stays responsive
    await new Promise((r) => setTimeout(r, kind === 'studio_demo' ? 3500 : 500));
  }
}

export function stopLiveStreamSession(sessionId: string): LiveStreamSession {
  const handle = activeMonitors.get(sessionId);
  if (handle) {
    handle.stopped = true;
  }
  let updated: LiveStreamSession | undefined;
  updateDb((db) => {
    const s = db.liveSessions.find((item) => item.id === sessionId);
    if (s) {
      s.status = 'stopped';
      updated = s;
    }
  });
  if (!updated) throw new Error('Live stream session not found.');
  return updated;
}

async function createClipFromSegmentPaths(params: {
  session: LiveStreamSession;
  segmentPaths: string[];
  title: string;
  description: string;
  hashtags: string[];
  score: number;
  reason: string;
  category: HighlightClip['category'];
  transcriptSegments?: HighlightClip['transcript'];
}): Promise<HighlightClip> {
  const db = getDb();
  const clipId = `clip_${crypto.randomUUID().slice(0, 8)}`;
  const joinedPath = path.join(DIRS.uploads, `live_${clipId}.mp4`);
  await concatMp4Segments(params.segmentPaths, joinedPath, db.settings.ffmpegThreads);

  const probe = await probeMedia(joinedPath);
  const videoId = `vid_live_${clipId}`;
  const videoThumb = path.join(DIRS.thumbnails, `${videoId}.jpg`);
  await generateThumbnail(joinedPath, Math.min(1, probe.duration / 2), videoThumb);

  const previewPath = path.join(DIRS.clips, `${clipId}_preview.mp4`);
  const clipThumb = path.join(DIRS.thumbnails, `${clipId}.jpg`);

  const subtitleConfig: SubtitleConfig = {
    enabled: true,
    language: params.session.language,
    stylePreset: 'viral_pop',
    fontFamily:
      params.session.language === 'hi'
        ? 'Noto Sans Devanagari'
        : params.session.language === 'bn'
          ? 'Noto Sans Bengali'
          : 'DejaVu Sans',
    fontSize: 42,
    primaryColor: '#FFFFFF',
    highlightColor: '#FACC15',
    position: 'bottom',
    wordByWord: true,
  };

  await renderVerticalClip({
    sourceVideoPath: joinedPath,
    sourceWidth: probe.width,
    sourceHeight: probe.height,
    hasAudio: probe.hasAudio,
    startTime: 0,
    duration: probe.duration,
    cropMode: db.settings.autoReframeDefault,
    focusXPercent: 0,
    resolution: db.settings.defaultResolution,
    subtitleConfig,
    transcript: params.transcriptSegments ?? [],
    musicTrackPath: null,
    musicVolume: 0.18,
    introPath: null,
    outroPath: null,
    outputMp4Path: previewPath,
    threads: db.settings.ffmpegThreads,
    lowResourceMode: db.settings.lowResourceMode,
  });

  await generateThumbnail(previewPath, Math.min(1, probe.duration / 2), clipThumb);

  const clip: HighlightClip = {
    id: clipId,
    videoId,
    title: params.title,
    description: params.description,
    hashtags: params.hashtags,
    startTime: 0,
    endTime: probe.duration,
    duration: probe.duration,
    score: params.score,
    category: params.category,
    reason: params.reason,
    previewPath,
    thumbnailPath: clipThumb,
    cropMode: db.settings.autoReframeDefault,
    focusXPercent: 0,
    resolution: db.settings.defaultResolution,
    subtitleConfig,
    musicTrackId: null,
    musicVolume: 0.18,
    introAssetId: null,
    outroAssetId: null,
    transcript: params.transcriptSegments ?? [],
    createdAt: new Date().toISOString(),
  };

  updateDb((d) => {
    d.videos.unshift({
      id: videoId,
      title: `${params.session.title} (Live Capture)`,
      filename: path.basename(joinedPath),
      filePath: joinedPath,
      thumbnailPath: videoThumb,
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
      hasAudio: probe.hasAudio,
      sizeBytes: fs.statSync(joinedPath).size,
      language: params.session.language,
      sourceType: 'livestream',
      transcript: params.transcriptSegments ?? [],
      createdAt: new Date().toISOString(),
    });
    d.clips.unshift(clip);
  });

  return clip;
}

export async function manualClipLiveStream(
  sessionId: string,
  durationSec: ClipDurationOption
): Promise<HighlightClip> {
  const db = getDb();
  const session = db.liveSessions.find((s) => s.id === sessionId);
  if (!session) throw new Error('Live stream session not found.');

  const handle = activeMonitors.get(sessionId);
  let segments = handle?.segmentPaths.filter((p) => fs.existsSync(p)) ?? [];

  if (segments.length === 0 && session.previewSegmentPath && fs.existsSync(session.previewSegmentPath)) {
    segments = [session.previewSegmentPath];
  }

  if (segments.length === 0) {
    throw new Error(
      session.streamKind === 'youtube_live'
        ? 'No buffered video segments yet. Attach an authorized companion HLS relay URL or use Studio Demo Live Stream to capture video frames.'
        : 'Wait for the first 15-second stream segment to finish capturing before creating a manual clip.'
    );
  }

  const neededCount = Math.max(1, Math.min(segments.length, Math.ceil(durationSec / 15)));
  const selectedSegs = segments.slice(-neededCount);

  const clip = await createClipFromSegmentPaths({
    session,
    segmentPaths: selectedSegs,
    title: `Live Highlight · ${session.title}`,
    description: `Manual ${durationSec}s live stream clip captured from ${session.title}.`,
    hashtags: ['#LiveClip', '#Shorts', '#ClipGeniusAI'],
    score: 88,
    reason: 'Manually clipped by producer during live broadcast monitoring.',
    category: 'manual',
  });

  updateDb((d) => {
    const s = d.liveSessions.find((item) => item.id === sessionId);
    if (s) s.autoClipsCreated += 1;
  });

  return clip;
}
