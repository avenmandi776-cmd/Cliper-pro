import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { generateSrt, sliceTranscriptForClip } from '../../shared/subtitles';
import type {
  AppSettings,
  ClipDurationOption,
  CropMode,
  HighlightClip,
  LanguageCode,
  ResolutionOption,
  StudioStateResponse,
  SubtitleConfig,
  TranscriptSegment,
  VideoRecord,
} from '../../shared/types';
import { clampClipWindow } from '../../shared/videoMath';
import {
  detectAudioAndSceneFocus,
  generateSamplePodcastVideo,
  generateThumbnail,
  getFfmpegInfo,
  probeMedia,
  renderVerticalClip,
} from '../services/ffmpeg';
import {
  correctCaptionsWithGemini,
  generateClipMetadataWithGemini,
  resolveSafeModel,
} from '../services/gemini';
import { enqueueJob, resumeJob } from '../services/jobQueue';
import {
  manualClipLiveStream,
  startLiveStreamSession,
  stopLiveStreamSession,
} from '../services/liveStream';
import { DIRS, getDb, resolveSafeDataPath, toPublicMediaUrl, updateDb } from '../services/store';

const upload = multer({
  dest: DIRS.temp,
  limits: { fileSize: 512 * 1024 * 1024 },
});

function serializeState(ffmpegInfo: { available: boolean; version: string }): StudioStateResponse {
  const db = getDb();
  return {
    videos: db.videos.map((v) => ({
      ...v,
      filePath: toPublicMediaUrl(v.filePath),
      thumbnailPath: toPublicMediaUrl(v.thumbnailPath),
    })),
    clips: db.clips.map((c) => ({
      ...c,
      previewPath: toPublicMediaUrl(c.previewPath),
      thumbnailPath: toPublicMediaUrl(c.thumbnailPath),
    })),
    jobs: db.jobs,
    exports: db.exports.map((e) => ({
      ...e,
      filePath: toPublicMediaUrl(e.filePath),
      srtPath: toPublicMediaUrl(e.srtPath),
    })),
    liveSessions: db.liveSessions.map((s) => ({
      ...s,
      previewSegmentPath: s.previewSegmentPath ? toPublicMediaUrl(s.previewSegmentPath) : undefined,
    })),
    musicTracks: db.musicTracks.map((m) => ({
      ...m,
      filePath: toPublicMediaUrl(m.filePath),
    })),
    introOutroAssets: db.introOutroAssets.map((a) => ({
      ...a,
      filePath: toPublicMediaUrl(a.filePath),
    })),
    settings: db.settings,
    capabilities: {
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      whisperConfigured: Boolean(process.env.WHISPER_API_URL?.trim()),
      ffmpegAvailable: ffmpegInfo.available,
      ffmpegVersion: ffmpegInfo.version,
    },
  };
}

export function createApiRouter(): express.Router {
  const router = express.Router();

  router.get('/state', async (_req, res) => {
    const info = await getFfmpegInfo();
    res.json(serializeState(info));
  });

  // Upload a user video file
  router.post('/videos/upload', upload.single('video'), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No video file provided.' });
        return;
      }

      const ext = path.extname(req.file.originalname).toLowerCase() || '.mp4';
      const allowedExts = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi']);
      if (!allowedExts.has(ext)) {
        fs.unlinkSync(req.file.path);
        res.status(400).json({ error: 'Unsupported video format. Upload MP4, MOV, WebM, or MKV.' });
        return;
      }

      const videoId = `vid_${crypto.randomUUID().slice(0, 8)}`;
      const destPath = path.join(DIRS.uploads, `${videoId}${ext}`);
      fs.renameSync(req.file.path, destPath);

      const probe = await probeMedia(destPath);
      const thumbPath = path.join(DIRS.thumbnails, `${videoId}.jpg`);
      await generateThumbnail(destPath, Math.min(1, probe.duration / 3), thumbPath);

      const db = getDb();
      const title =
        (typeof req.body.title === 'string' && req.body.title.trim()) ||
        path.basename(req.file.originalname, ext);
      const language = ((req.body.language as LanguageCode) || db.settings.defaultLanguage) as LanguageCode;
      const clipDuration = Number(req.body.clipDuration) || db.settings.defaultClipDuration;
      const resolution = (req.body.resolution as ResolutionOption) || db.settings.defaultResolution;
      const cropMode = (req.body.cropMode as CropMode) || db.settings.autoReframeDefault;
      const autoAnalyze = req.body.autoAnalyze !== 'false';

      const video: VideoRecord = {
        id: videoId,
        title,
        filename: req.file.originalname,
        filePath: destPath,
        thumbnailPath: thumbPath,
        duration: probe.duration,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        hasAudio: probe.hasAudio,
        sizeBytes: req.file.size,
        language,
        sourceType: 'upload',
        transcript: [],
        createdAt: new Date().toISOString(),
      };

      updateDb((d) => {
        d.videos.unshift(video);
      });

      let job = null;
      if (autoAnalyze) {
        job = enqueueJob({
          type: 'analyze_video',
          targetId: video.id,
          title: `AI Clipping · ${video.title}`,
          payload: { clipDuration, language, resolution, cropMode },
        });
      }

      res.json({
        video: {
          ...video,
          filePath: toPublicMediaUrl(video.filePath),
          thumbnailPath: toPublicMediaUrl(video.thumbnailPath),
        },
        job,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Upload failed.' });
    }
  });

  // Load or generate real spoken-word Sample Podcast Video for testing
  router.post('/videos/sample', async (req, res) => {
    try {
      const db = getDb();
      const sampleFile = path.join(DIRS.uploads, 'sample_founder_podcast.mp4');
      await generateSamplePodcastVideo(sampleFile);

      const probe = await probeMedia(sampleFile);
      const videoId = `vid_sample_${crypto.randomUUID().slice(0, 6)}`;
      const thumbPath = path.join(DIRS.thumbnails, `${videoId}.jpg`);
      await generateThumbnail(sampleFile, 2, thumbPath);

      const language = ((req.body?.language as LanguageCode) || db.settings.defaultLanguage) as LanguageCode;
      const clipDuration = (Number(req.body?.clipDuration) || 15) as ClipDurationOption;
      const resolution = (req.body?.resolution as ResolutionOption) || db.settings.defaultResolution;
      const cropMode = (req.body?.cropMode as CropMode) || db.settings.autoReframeDefault;
      const runAi = req.body?.autoAnalyze !== false;

      // Pre-populate crisp reference transcript if AI key isn't active yet so FFmpeg manual clipping & captions work right away;
      // when AI analysis runs, Gemini overwrites with full AI-detected transcript & highlights.
      const sampleTranscript: TranscriptSegment[] = [
        {
          id: 'seg_1',
          start: 0.4,
          end: 6.2,
          text: 'Welcome back to the Creator Growth Show! Today we uncovered something wild about short form retention.',
          words: [],
        },
        {
          id: 'seg_2',
          start: 6.3,
          end: 14.5,
          text: 'Most creators spend ten hours editing a single podcast when ninety percent of views come from three thirty-second moments!',
          words: [],
        },
        {
          id: 'seg_3',
          start: 14.6,
          end: 23.8,
          text: 'Vertical videos with animated word-by-word captions see forty-two percent higher completion rates across Reels and Shorts.',
          words: [],
        },
      ];

      const video: VideoRecord = {
        id: videoId,
        title: 'Creator Growth Podcast · Ep. 42 (Sample)',
        filename: 'sample_founder_podcast.mp4',
        filePath: sampleFile,
        thumbnailPath: thumbPath,
        duration: probe.duration,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        hasAudio: probe.hasAudio,
        sizeBytes: fs.statSync(sampleFile).size,
        language,
        sourceType: 'sample',
        summary: 'Sample spoken-word creator podcast ready for AI highlight clipping or manual vertical editing.',
        transcript: runAi && process.env.GEMINI_API_KEY?.trim() ? [] : sampleTranscript,
        createdAt: new Date().toISOString(),
      };

      updateDb((d) => {
        d.videos.unshift(video);
      });

      let job = null;
      if (runAi && process.env.GEMINI_API_KEY?.trim()) {
        job = enqueueJob({
          type: 'analyze_video',
          targetId: video.id,
          title: `AI Clipping · ${video.title}`,
          payload: { clipDuration, language, resolution, cropMode },
        });
      }

      res.json({
        video: {
          ...video,
          filePath: toPublicMediaUrl(video.filePath),
          thumbnailPath: toPublicMediaUrl(video.thumbnailPath),
        },
        job,
        geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create sample video.' });
    }
  });

  // Trigger AI analysis on an existing video
  router.post('/videos/:id/analyze', (req, res) => {
    try {
      const db = getDb();
      const video = db.videos.find((v) => v.id === req.params.id);
      if (!video) {
        res.status(404).json({ error: 'Video not found.' });
        return;
      }

      const clipDuration = Number(req.body?.clipDuration) || db.settings.defaultClipDuration;
      const language = (req.body?.language as LanguageCode) || video.language || db.settings.defaultLanguage;
      const resolution = (req.body?.resolution as ResolutionOption) || db.settings.defaultResolution;
      const cropMode = (req.body?.cropMode as CropMode) || db.settings.autoReframeDefault;

      const job = enqueueJob({
        type: 'analyze_video',
        targetId: video.id,
        title: `AI Clipping · ${video.title}`,
        payload: { clipDuration, language, resolution, cropMode },
      });

      res.json({ job });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to start analysis.' });
    }
  });

  // Create & render a manual 9:16 clip directly with FFmpeg (works with or without Gemini key)
  router.post('/videos/:id/manual-clip', async (req, res) => {
    try {
      const db = getDb();
      const video = db.videos.find((v) => v.id === req.params.id);
      if (!video) {
        res.status(404).json({ error: 'Video not found.' });
        return;
      }

      const startReq = Number(req.body?.startTime ?? 0);
      const durReq = Number(req.body?.duration ?? db.settings.defaultClipDuration);
      const clamped = clampClipWindow(startReq, durReq, video.duration);

      const resolution = (req.body?.resolution as ResolutionOption) || db.settings.defaultResolution;
      const cropMode = (req.body?.cropMode as CropMode) || db.settings.autoReframeDefault;
      const language = (req.body?.language as LanguageCode) || video.language || db.settings.defaultLanguage;

      const sceneInfo = await detectAudioAndSceneFocus(
        video.filePath,
        video.duration,
        db.settings.ffmpegThreads
      );

      const clipId = `clip_${crypto.randomUUID().slice(0, 8)}`;
      const previewPath = path.join(DIRS.clips, `${clipId}_preview.mp4`);
      const thumbPath = path.join(DIRS.thumbnails, `${clipId}.jpg`);

      const clipTranscript = sliceTranscriptForClip(video.transcript, clamped.start, clamped.end);
      const subtitleConfig: SubtitleConfig = {
        enabled: true,
        language,
        stylePreset: 'viral_pop',
        fontFamily:
          language === 'hi'
            ? 'Noto Sans Devanagari'
            : language === 'bn'
              ? 'Noto Sans Bengali'
              : 'DejaVu Sans',
        fontSize: 42,
        primaryColor: '#FFFFFF',
        highlightColor: '#FACC15',
        position: 'bottom',
        wordByWord: true,
      };

      await renderVerticalClip({
        sourceVideoPath: video.filePath,
        sourceWidth: video.width,
        sourceHeight: video.height,
        hasAudio: video.hasAudio,
        startTime: clamped.start,
        duration: clamped.duration,
        cropMode,
        focusXPercent: sceneInfo.focusXPercent,
        resolution,
        subtitleConfig,
        transcript: clipTranscript,
        musicTrackPath: null,
        musicVolume: 0.18,
        introPath: null,
        outroPath: null,
        outputMp4Path: previewPath,
        threads: db.settings.ffmpegThreads,
        lowResourceMode: db.settings.lowResourceMode,
      });

      await generateThumbnail(previewPath, Math.min(1, clamped.duration / 2), thumbPath);

      const clip: HighlightClip = {
        id: clipId,
        videoId: video.id,
        title: (typeof req.body?.title === 'string' && req.body.title.trim()) || `${video.title} · Clip`,
        description: `Vertical 9:16 highlight from ${video.title} (${clamped.start}s–${clamped.end}s).`,
        hashtags: ['#Shorts', '#Reels', '#ClipGeniusAI'],
        startTime: clamped.start,
        endTime: clamped.end,
        duration: clamped.duration,
        score: 85,
        category: 'manual',
        reason: 'Manual FFmpeg vertical 9:16 cut created from source video.',
        previewPath,
        thumbnailPath: thumbPath,
        cropMode,
        focusXPercent: sceneInfo.focusXPercent,
        resolution,
        subtitleConfig,
        musicTrackId: null,
        musicVolume: 0.18,
        introAssetId: null,
        outroAssetId: null,
        transcript: clipTranscript,
        createdAt: new Date().toISOString(),
      };

      updateDb((d) => {
        d.clips.unshift(clip);
      });

      res.json({
        clip: {
          ...clip,
          previewPath: toPublicMediaUrl(clip.previewPath),
          thumbnailPath: toPublicMediaUrl(clip.thumbnailPath),
        },
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create clip.' });
    }
  });

  router.delete('/videos/:id', (req, res) => {
    updateDb((d) => {
      d.videos = d.videos.filter((v) => v.id !== req.params.id);
    });
    res.json({ ok: true });
  });

  // Update clip edit settings (trim, crop, subtitle styles, music, intro/outro, transcript)
  router.patch('/clips/:id', (req, res) => {
    try {
      let updated: HighlightClip | undefined;
      updateDb((d) => {
        const clip = d.clips.find((c) => c.id === req.params.id);
        if (!clip) return;
        const body = req.body as Partial<HighlightClip>;
        if (typeof body.title === 'string') clip.title = body.title;
        if (typeof body.description === 'string') clip.description = body.description;
        if (Array.isArray(body.hashtags)) clip.hashtags = body.hashtags;
        if (typeof body.startTime === 'number' && typeof body.endTime === 'number') {
          const video = d.videos.find((v) => v.id === clip.videoId);
          const maxDur = video?.duration ?? 600;
          const clamped = clampClipWindow(
            body.startTime,
            Math.max(3, body.endTime - body.startTime),
            maxDur
          );
          clip.startTime = clamped.start;
          clip.endTime = clamped.end;
          clip.duration = clamped.duration;
        }
        if (body.cropMode) clip.cropMode = body.cropMode;
        if (typeof body.focusXPercent === 'number') {
          clip.focusXPercent = Math.max(-100, Math.min(100, body.focusXPercent));
        }
        if (body.resolution) clip.resolution = body.resolution;
        if (body.subtitleConfig) clip.subtitleConfig = body.subtitleConfig;
        if (body.musicTrackId !== undefined) clip.musicTrackId = body.musicTrackId;
        if (typeof body.musicVolume === 'number') clip.musicVolume = body.musicVolume;
        if (body.introAssetId !== undefined) clip.introAssetId = body.introAssetId;
        if (body.outroAssetId !== undefined) clip.outroAssetId = body.outroAssetId;
        if (Array.isArray(body.transcript)) clip.transcript = body.transcript;
        updated = clip;
      });

      if (!updated) {
        res.status(404).json({ error: 'Clip not found.' });
        return;
      }

      res.json({
        clip: {
          ...updated,
          previewPath: toPublicMediaUrl(updated.previewPath),
          thumbnailPath: toPublicMediaUrl(updated.thumbnailPath),
        },
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Update failed.' });
    }
  });

  // Re-render clip preview MP4 with updated FFmpeg edits
  router.post('/clips/:id/preview-render', async (req, res) => {
    try {
      const db = getDb();
      const clip = db.clips.find((c) => c.id === req.params.id);
      if (!clip) {
        res.status(404).json({ error: 'Clip not found.' });
        return;
      }
      const video = db.videos.find((v) => v.id === clip.videoId);
      if (!video) {
        res.status(404).json({ error: 'Source video not found.' });
        return;
      }

      const musicTrack = clip.musicTrackId
        ? db.musicTracks.find((m) => m.id === clip.musicTrackId)
        : undefined;
      const introAsset = clip.introAssetId
        ? db.introOutroAssets.find((a) => a.id === clip.introAssetId)
        : undefined;
      const outroAsset = clip.outroAssetId
        ? db.introOutroAssets.find((a) => a.id === clip.outroAssetId)
        : undefined;

      const nextPreviewPath = path.join(
        DIRS.clips,
        `${clip.id}_preview_${Date.now().toString().slice(-5)}.mp4`
      );

      await renderVerticalClip({
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
        outputMp4Path: nextPreviewPath,
        threads: db.settings.ffmpegThreads,
        lowResourceMode: true,
      });

      updateDb((d) => {
        const target = d.clips.find((c) => c.id === clip.id);
        if (target) target.previewPath = nextPreviewPath;
      });

      res.json({ previewUrl: toPublicMediaUrl(nextPreviewPath) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Preview render failed.' });
    }
  });

  // Regenerate clip viral title, description, hashtags via Gemini
  router.post('/clips/:id/regenerate-metadata', async (req, res) => {
    try {
      const db = getDb();
      const clip = db.clips.find((c) => c.id === req.params.id);
      if (!clip) {
        res.status(404).json({ error: 'Clip not found.' });
        return;
      }

      const transcriptText = clip.transcript.map((s) => s.text).join(' ');
      const meta = await generateClipMetadataWithGemini({
        transcriptText,
        currentTitle: clip.title,
        language: clip.subtitleConfig.language,
        model: db.settings.geminiModel,
      });

      updateDb((d) => {
        const target = d.clips.find((c) => c.id === clip.id);
        if (target) {
          target.title = meta.title;
          target.description = meta.description;
          target.hashtags = meta.hashtags;
        }
      });

      res.json(meta);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'AI metadata generation failed.' });
    }
  });

  // AI caption correction in English, Hindi, or Bengali
  router.post('/clips/:id/correct-captions', async (req, res) => {
    try {
      const db = getDb();
      const clip = db.clips.find((c) => c.id === req.params.id);
      if (!clip) {
        res.status(404).json({ error: 'Clip not found.' });
        return;
      }
      if (clip.transcript.length === 0) {
        res.status(400).json({ error: 'Add or transcribe captions before running AI correction.' });
        return;
      }

      const language = (req.body?.language as LanguageCode) || clip.subtitleConfig.language;
      const corrected = await correctCaptionsWithGemini({
        segments: clip.transcript,
        language,
        model: db.settings.geminiModel,
      });

      updateDb((d) => {
        const target = d.clips.find((c) => c.id === clip.id);
        if (target) {
          target.transcript = corrected;
          target.subtitleConfig.language = language;
        }
      });

      res.json({ transcript: corrected });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Caption correction failed.' });
    }
  });

  // Download SRT file for any clip
  router.get('/clips/:id/srt', (req, res) => {
    const db = getDb();
    const clip = db.clips.find((c) => c.id === req.params.id);
    if (!clip) {
      res.status(404).json({ error: 'Clip not found.' });
      return;
    }
    const srt = generateSrt(clip.transcript);
    res.setHeader('Content-Type', 'application/x-subrip; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${clip.id}.srt"`);
    res.send(srt);
  });

  // Enqueue MP4 + burned-in captions export job
  router.post('/clips/:id/export', (req, res) => {
    const db = getDb();
    const clip = db.clips.find((c) => c.id === req.params.id);
    if (!clip) {
      res.status(404).json({ error: 'Clip not found.' });
      return;
    }

    const job = enqueueJob({
      type: 'export_clip',
      targetId: clip.id,
      title: `Export MP4 · ${clip.title}`,
      payload: { resolution: clip.resolution },
    });

    res.json({ job });
  });

  router.delete('/clips/:id', (req, res) => {
    updateDb((d) => {
      d.clips = d.clips.filter((c) => c.id !== req.params.id);
    });
    res.json({ ok: true });
  });

  // Resume failed background job
  router.post('/jobs/:id/resume', (req, res) => {
    try {
      const job = resumeJob(req.params.id);
      res.json({ job });
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'Job not found.' });
    }
  });

  // Live Stream endpoints
  router.post('/livestreams/start', async (req, res) => {
    try {
      const db = getDb();
      const session = await startLiveStreamSession({
        sourceUrl: String(req.body?.sourceUrl || ''),
        relayHlsUrl: typeof req.body?.relayHlsUrl === 'string' ? req.body.relayHlsUrl : undefined,
        authorizedConfirmed: Boolean(req.body?.authorizedConfirmed),
        language: (req.body?.language as LanguageCode) || db.settings.defaultLanguage,
        clipDuration: (Number(req.body?.clipDuration) || 15) as ClipDurationOption,
        autoClipThreshold: Number(req.body?.autoClipThreshold || 75),
      });
      res.json({
        session: {
          ...session,
          previewSegmentPath: session.previewSegmentPath
            ? toPublicMediaUrl(session.previewSegmentPath)
            : undefined,
        },
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to start stream.' });
    }
  });

  router.post('/livestreams/:id/stop', (req, res) => {
    try {
      const session = stopLiveStreamSession(req.params.id);
      res.json({ session });
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'Session not found.' });
    }
  });

  router.post('/livestreams/:id/manual-clip', async (req, res) => {
    try {
      const duration = (Number(req.body?.duration) || 15) as ClipDurationOption;
      const clip = await manualClipLiveStream(req.params.id, duration);
      res.json({
        clip: {
          ...clip,
          previewPath: toPublicMediaUrl(clip.previewPath),
          thumbnailPath: toPublicMediaUrl(clip.thumbnailPath),
        },
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Manual clip failed.' });
    }
  });

  // Upload custom background music or intro/outro slate
  router.post('/assets/music', upload.single('audio'), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No audio file uploaded.' });
        return;
      }
      const ext = path.extname(req.file.originalname).toLowerCase() || '.mp3';
      if (!['.mp3', '.wav', '.aac', '.m4a', '.ogg'].includes(ext)) {
        fs.unlinkSync(req.file.path);
        res.status(400).json({ error: 'Unsupported audio format.' });
        return;
      }
      const id = `bgm_${crypto.randomUUID().slice(0, 6)}`;
      const destPath = path.join(DIRS.assets, `${id}${ext}`);
      fs.renameSync(req.file.path, destPath);
      const probe = await probeMedia(destPath);
      const track = {
        id,
        name: (req.body?.name as string)?.trim() || path.basename(req.file.originalname, ext),
        mood: 'Custom Licensed',
        duration: probe.duration || 30,
        filePath: destPath,
        isBuiltIn: false,
      };
      updateDb((d) => {
        d.musicTracks.push(track);
      });
      res.json({ track: { ...track, filePath: toPublicMediaUrl(track.filePath) } });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Music upload failed.' });
    }
  });

  router.post('/assets/slate', upload.single('video'), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No slate video uploaded.' });
        return;
      }
      const kind = req.body?.kind === 'outro' ? 'outro' : 'intro';
      const ext = path.extname(req.file.originalname).toLowerCase() || '.mp4';
      const id = `slate_${crypto.randomUUID().slice(0, 6)}`;
      const destPath = path.join(DIRS.assets, `${id}${ext}`);
      fs.renameSync(req.file.path, destPath);
      const probe = await probeMedia(destPath);
      const asset = {
        id,
        name: (req.body?.name as string)?.trim() || path.basename(req.file.originalname, ext),
        kind: kind as 'intro' | 'outro',
        duration: probe.duration || 3,
        filePath: destPath,
        isBuiltIn: false,
      };
      updateDb((d) => {
        d.introOutroAssets.push(asset);
      });
      res.json({ asset: { ...asset, filePath: toPublicMediaUrl(asset.filePath) } });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Slate upload failed.' });
    }
  });

  router.delete('/exports/:id', (req, res) => {
    updateDb((d) => {
      const exp = d.exports.find((e) => e.id === req.params.id);
      if (exp) {
        try {
          if (fs.existsSync(exp.filePath)) fs.unlinkSync(resolveSafeDataPath(exp.filePath));
          if (fs.existsSync(exp.srtPath)) fs.unlinkSync(resolveSafeDataPath(exp.srtPath));
        } catch {
          // ignore cleanup error
        }
      }
      d.exports = d.exports.filter((e) => e.id !== req.params.id);
    });
    res.json({ ok: true });
  });

  router.patch('/settings', (req, res) => {
    const body = req.body as Partial<AppSettings>;
    let nextSettings: AppSettings | undefined;
    updateDb((d) => {
      if (typeof body.geminiModel === 'string') {
        d.settings.geminiModel = resolveSafeModel(body.geminiModel);
      }
      if (typeof body.ffmpegThreads === 'number') {
        d.settings.ffmpegThreads = Math.max(1, Math.min(8, Math.round(body.ffmpegThreads)));
      }
      if (body.defaultClipDuration && [15, 30, 45, 60].includes(body.defaultClipDuration)) {
        d.settings.defaultClipDuration = body.defaultClipDuration;
      }
      if (body.defaultResolution && ['720x1280', '480x854'].includes(body.defaultResolution)) {
        d.settings.defaultResolution = body.defaultResolution;
      }
      if (body.defaultLanguage && ['en', 'hi', 'bn'].includes(body.defaultLanguage)) {
        d.settings.defaultLanguage = body.defaultLanguage;
      }
      if (typeof body.lowResourceMode === 'boolean') {
        d.settings.lowResourceMode = body.lowResourceMode;
      }
      if (body.autoReframeDefault && ['auto_face', 'center', 'fit_blur'].includes(body.autoReframeDefault)) {
        d.settings.autoReframeDefault = body.autoReframeDefault;
      }
      nextSettings = d.settings;
    });
    res.json({ settings: nextSettings });
  });

  return router;
}
