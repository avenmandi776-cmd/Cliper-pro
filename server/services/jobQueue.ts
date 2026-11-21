import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sliceTranscriptForClip } from '../../shared/subtitles';
import type {
  ClipDurationOption,
  CropMode,
  ExportRecord,
  HighlightClip,
  JobStage,
  LanguageCode,
  ProcessingJob,
  ResolutionOption,
  SubtitleConfig,
} from '../../shared/types';
import { clampClipWindow } from '../../shared/videoMath';
import {
  detectAudioAndSceneFocus,
  extractAudio,
  generateThumbnail,
  renderVerticalClip,
} from './ffmpeg';
import { analyzeHighlightsWithGemini, transcribeAudio } from './gemini';
import { DIRS, getDb, updateDb } from './store';

let isWorkerRunning = false;

function updateJobState(
  jobId: string,
  patch: Partial<ProcessingJob> & { markStageDone?: JobStage }
): void {
  updateDb((db) => {
    const job = db.jobs.find((j) => j.id === jobId);
    if (!job) return;
    if (patch.markStageDone && !job.completedStages.includes(patch.markStageDone)) {
      job.completedStages.push(patch.markStageDone);
    }
    const { markStageDone: _ignored, ...rest } = patch;
    Object.assign(job, rest, { updatedAt: new Date().toISOString() });
  });
}

export function enqueueJob(params: {
  type: ProcessingJob['type'];
  targetId: string;
  title: string;
  payload: Record<string, unknown>;
}): ProcessingJob {
  const now = new Date().toISOString();
  const job: ProcessingJob = {
    id: `job_${crypto.randomUUID().slice(0, 8)}`,
    type: params.type,
    targetId: params.targetId,
    title: params.title,
    status: 'queued',
    stage: 'pending',
    completedStages: [],
    progress: 0,
    canResume: false,
    payload: params.payload,
    createdAt: now,
    updatedAt: now,
  };

  updateDb((db) => {
    db.jobs.unshift(job);
  });

  scheduleQueue();
  return job;
}

export function resumeJob(jobId: string): ProcessingJob {
  let found: ProcessingJob | undefined;
  updateDb((db) => {
    const job = db.jobs.find((j) => j.id === jobId);
    if (!job) return;
    if (job.status !== 'failed') {
      found = job;
      return;
    }
    job.status = 'queued';
    job.errorMessage = undefined;
    job.canResume = false;
    job.updatedAt = new Date().toISOString();
    found = job;
  });

  if (!found) {
    throw new Error('Job not found.');
  }
  scheduleQueue();
  return found;
}

function scheduleQueue(): void {
  if (isWorkerRunning) return;
  setImmediate(() => {
    void processNextJob();
  });
}

async function processNextJob(): Promise<void> {
  if (isWorkerRunning) return;
  const db = getDb();
  const nextJob = db.jobs.find((j) => j.status === 'queued');
  if (!nextJob) return;

  isWorkerRunning = true;
  try {
    updateJobState(nextJob.id, { status: 'processing', errorMessage: undefined });
    if (nextJob.type === 'analyze_video') {
      await runAnalyzeVideoJob(nextJob.id);
    } else if (nextJob.type === 'export_clip') {
      await runExportClipJob(nextJob.id);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected processing error';
    updateJobState(nextJob.id, {
      status: 'failed',
      errorMessage: message,
      canResume: true,
    });
  } finally {
    isWorkerRunning = false;
    const remaining = getDb().jobs.some((j) => j.status === 'queued');
    if (remaining) scheduleQueue();
  }
}

async function runAnalyzeVideoJob(jobId: string): Promise<void> {
  const db = getDb();
  const job = db.jobs.find((j) => j.id === jobId);
  if (!job) return;

  const video = db.videos.find((v) => v.id === job.targetId);
  if (!video) {
    throw new Error('Source video no longer exists.');
  }

  const settings = db.settings;
  const clipDuration = (Number(job.payload.clipDuration) || settings.defaultClipDuration) as ClipDurationOption;
  const language = (job.payload.language || video.language || settings.defaultLanguage) as LanguageCode;
  const resolution = (job.payload.resolution || settings.defaultResolution) as ResolutionOption;
  const cropMode = (job.payload.cropMode || settings.autoReframeDefault) as CropMode;

  const audioPath = path.join(DIRS.temp, `${video.id}_audio.mp3`);

  // Stage 1: Extract Audio & Analyze Focus
  if (!job.completedStages.includes('extract_audio') || !fs.existsSync(audioPath)) {
    updateJobState(jobId, { stage: 'extract_audio', progress: 8 });
    if (video.hasAudio) {
      await extractAudio(video.filePath, audioPath, settings.ffmpegThreads, video.duration, (pct) => {
        updateJobState(jobId, { progress: 8 + Math.round(pct * 0.12) });
      });
    }
    const sceneInfo = await detectAudioAndSceneFocus(
      video.filePath,
      video.duration,
      settings.ffmpegThreads
    );
    updateDb((d) => {
      const target = d.jobs.find((j) => j.id === jobId);
      if (target) target.payload.focusXPercent = sceneInfo.focusXPercent;
    });
    updateJobState(jobId, { markStageDone: 'extract_audio', progress: 22 });
  }

  // Stage 2: Transcribe Speech (Gemini 3.5 Transcribe / Whisper)
  if (!job.completedStages.includes('transcribe')) {
    updateJobState(jobId, { stage: 'transcribe', progress: 26 });
    if (video.hasAudio && fs.existsSync(audioPath)) {
      const transcription = await transcribeAudio({
        audioPath,
        language,
        durationSec: video.duration,
        model: settings.geminiModel,
      });
      updateDb((d) => {
        const v = d.videos.find((item) => item.id === video.id);
        if (v) {
          v.transcript = transcription.segments;
          v.language = language;
        }
      });
    }
    updateJobState(jobId, { markStageDone: 'transcribe', progress: 48 });
  }

  // Stage 3: Gemini AI Highlight Detection
  let detectedHighlights = (getDb().jobs.find((j) => j.id === jobId)?.payload.detectedHighlights ||
    []) as Array<{
    startTime: number;
    endTime: number;
    duration: number;
    score: number;
    category: 'viral' | 'funny' | 'reaction' | 'insight';
    reason: string;
    title: string;
    description: string;
    hashtags: string[];
  }>;

  if (!job.completedStages.includes('analyze_ai') || detectedHighlights.length === 0) {
    updateJobState(jobId, { stage: 'analyze_ai', progress: 52 });
    const latestVideo = getDb().videos.find((v) => v.id === video.id)!;
    const analysis = await analyzeHighlightsWithGemini({
      transcript: latestVideo.transcript,
      videoTitle: latestVideo.title,
      durationSec: latestVideo.duration,
      targetClipDuration: clipDuration,
      language,
      model: settings.geminiModel,
    });
    detectedHighlights = analysis.highlights;
    updateDb((d) => {
      const v = d.videos.find((item) => item.id === video.id);
      if (v) v.summary = analysis.summary;
      const targetJob = d.jobs.find((j) => j.id === jobId);
      if (targetJob) targetJob.payload.detectedHighlights = detectedHighlights;
    });
    updateJobState(jobId, { markStageDone: 'analyze_ai', progress: 68 });
  }

  // Stage 4: Render 9:16 Vertical Preview Clips with FFmpeg
  updateJobState(jobId, { stage: 'render_clips', progress: 70 });
  const latestVideo = getDb().videos.find((v) => v.id === video.id)!;
  const focusXPercent = Number(getDb().jobs.find((j) => j.id === jobId)?.payload.focusXPercent || 0);

  const defaultSubtitleConfig: SubtitleConfig = {
    enabled: true,
    language,
    stylePreset: 'viral_pop',
    fontFamily: language === 'hi' ? 'Noto Sans Devanagari' : language === 'bn' ? 'Noto Sans Bengali' : 'DejaVu Sans',
    fontSize: 42,
    primaryColor: '#FFFFFF',
    highlightColor: '#FACC15',
    position: 'bottom',
    wordByWord: true,
  };

  for (let i = 0; i < detectedHighlights.length; i++) {
    const h = detectedHighlights[i];
    const clamped = clampClipWindow(h.startTime, h.duration || clipDuration, latestVideo.duration);
    const clipId = `clip_${crypto.randomUUID().slice(0, 8)}`;
    const previewPath = path.join(DIRS.clips, `${clipId}_preview.mp4`);
    const thumbPath = path.join(DIRS.thumbnails, `${clipId}.jpg`);
    const clipTranscript = sliceTranscriptForClip(latestVideo.transcript, clamped.start, clamped.end);

    await renderVerticalClip({
      sourceVideoPath: latestVideo.filePath,
      sourceWidth: latestVideo.width,
      sourceHeight: latestVideo.height,
      hasAudio: latestVideo.hasAudio,
      startTime: clamped.start,
      duration: clamped.duration,
      cropMode,
      focusXPercent,
      resolution,
      subtitleConfig: defaultSubtitleConfig,
      transcript: clipTranscript,
      musicTrackPath: null,
      musicVolume: 0.18,
      introPath: null,
      outroPath: null,
      outputMp4Path: previewPath,
      threads: settings.ffmpegThreads,
      lowResourceMode: settings.lowResourceMode,
      onProgress: (pct) => {
        const base = 70 + Math.round(((i + pct / 100) / Math.max(1, detectedHighlights.length)) * 28);
        updateJobState(jobId, { progress: Math.min(99, base) });
      },
    });

    await generateThumbnail(previewPath, Math.min(1, clamped.duration / 2), thumbPath);

    const newClip: HighlightClip = {
      id: clipId,
      videoId: latestVideo.id,
      title: h.title,
      description: h.description,
      hashtags: h.hashtags,
      startTime: clamped.start,
      endTime: clamped.end,
      duration: clamped.duration,
      score: h.score,
      category: h.category,
      reason: h.reason,
      previewPath,
      thumbnailPath: thumbPath,
      cropMode,
      focusXPercent,
      resolution,
      subtitleConfig: defaultSubtitleConfig,
      musicTrackId: null,
      musicVolume: 0.18,
      introAssetId: null,
      outroAssetId: null,
      transcript: clipTranscript,
      createdAt: new Date().toISOString(),
    };

    updateDb((d) => {
      d.clips.unshift(newClip);
    });
  }

  updateJobState(jobId, {
    status: 'completed',
    stage: 'done',
    markStageDone: 'render_clips',
    progress: 100,
    canResume: false,
  });
}

async function runExportClipJob(jobId: string): Promise<void> {
  const db = getDb();
  const job = db.jobs.find((j) => j.id === jobId);
  if (!job) return;

  const clip = db.clips.find((c) => c.id === job.targetId);
  if (!clip) throw new Error('Clip no longer exists.');

  const video = db.videos.find((v) => v.id === clip.videoId);
  if (!video) throw new Error('Source video for clip no longer exists.');

  const settings = db.settings;
  const exportId = `exp_${crypto.randomUUID().slice(0, 8)}`;
  const outputMp4Path = path.join(DIRS.exports, `${exportId}_${clip.id}.mp4`);
  const outputSrtPath = path.join(DIRS.exports, `${exportId}_${clip.id}.srt`);

  const musicTrack = clip.musicTrackId
    ? db.musicTracks.find((m) => m.id === clip.musicTrackId)
    : undefined;
  const introAsset = clip.introAssetId
    ? db.introOutroAssets.find((a) => a.id === clip.introAssetId)
    : undefined;
  const outroAsset = clip.outroAssetId
    ? db.introOutroAssets.find((a) => a.id === clip.outroAssetId)
    : undefined;

  updateJobState(jobId, { stage: 'render_export', progress: 10 });

  const rendered = await renderVerticalClip({
    sourceVideoPath: video.filePath,
    sourceWidth: video.width,
    sourceHeight: video.height,
    hasAudio: video.hasAudio,
    startTime: clip.startTime,
    duration: clip.duration,
    cropMode: clip.cropMode,
    focusXPercent: clip.focusXPercent,
    resolution: clip.resolution,
    subtitleConfig: clip.subtitleConfig,
    transcript: clip.transcript,
    musicTrackPath: musicTrack?.filePath ?? null,
    musicVolume: clip.musicVolume,
    introPath: introAsset?.filePath ?? null,
    outroPath: outroAsset?.filePath ?? null,
    outputMp4Path,
    outputSrtPath,
    threads: settings.ffmpegThreads,
    lowResourceMode: settings.lowResourceMode,
    onProgress: (pct) => {
      updateJobState(jobId, { progress: Math.max(10, Math.min(99, pct)) });
    },
  });

  const exportRecord: ExportRecord = {
    id: exportId,
    clipId: clip.id,
    videoId: video.id,
    title: clip.title,
    resolution: clip.resolution,
    filePath: rendered.mp4Path,
    srtPath: rendered.srtPath || outputSrtPath,
    sizeBytes: rendered.sizeBytes,
    duration:
      clip.duration + (introAsset?.duration ?? 0) + (outroAsset?.duration ?? 0),
    burnedCaptions: clip.subtitleConfig.enabled,
    createdAt: new Date().toISOString(),
  };

  updateDb((d) => {
    d.exports.unshift(exportRecord);
  });

  updateJobState(jobId, {
    status: 'completed',
    stage: 'done',
    markStageDone: 'render_export',
    progress: 100,
    canResume: false,
  });
}
