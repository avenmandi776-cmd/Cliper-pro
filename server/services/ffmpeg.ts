import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { generateAss, generateSrt } from '../../shared/subtitles';
import type {
  CropMode,
  IntroOutroAsset,
  MusicTrack,
  ResolutionOption,
  SubtitleConfig,
  TranscriptSegment,
} from '../../shared/types';
import {
  buildVerticalCropFilter,
  escapeFfmpegFilterPath,
  parseFfmpegProgressTime,
  parseResolution,
} from '../../shared/videoMath';
import { DIRS, resolveSafeDataPath, updateDb } from './store';

export interface MediaProbeResult {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

function runProcess(
  cmd: string,
  args: string[],
  onStderrOrStdout?: (chunk: string) => void
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (buf: Buffer) => {
      const str = buf.toString();
      stdout += str;
      onStderrOrStdout?.(str);
    });

    child.stderr.on('data', (buf: Buffer) => {
      const str = buf.toString();
      stderr += str;
      onStderrOrStdout?.(str);
    });

    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const tail = stderr.split('\n').slice(-10).join('\n');
        reject(new Error(`${cmd} exited with code ${code}: ${tail}`));
      }
    });
  });
}

let cachedFfmpegInfo: { available: boolean; version: string } | null = null;

export async function getFfmpegInfo(): Promise<{ available: boolean; version: string }> {
  if (cachedFfmpegInfo) return cachedFfmpegInfo;
  try {
    const { stdout } = await runProcess('ffmpeg', ['-version']);
    const firstLine = stdout.split('\n')[0] || 'ffmpeg available';
    cachedFfmpegInfo = { available: true, version: firstLine.trim() };
  } catch {
    cachedFfmpegInfo = { available: false, version: 'FFmpeg not found' };
  }
  return cachedFfmpegInfo;
}

export async function probeMedia(filePath: string): Promise<MediaProbeResult> {
  const safePath = resolveSafeDataPath(filePath);
  const { stdout } = await runProcess('ffprobe', [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    safePath,
  ]);

  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
    }>;
  };

  const videoStream = parsed.streams?.find((s) => s.codec_type === 'video');
  const audioStream = parsed.streams?.find((s) => s.codec_type === 'audio');

  let fps = 30;
  if (videoStream?.r_frame_rate) {
    const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
    if (num && den) {
      fps = Math.round((num / den) * 100) / 100;
    }
  }

  return {
    duration: Number(parsed.format?.duration || 0) || 0,
    width: videoStream?.width || 1280,
    height: videoStream?.height || 720,
    fps: Math.min(60, Math.max(15, fps)),
    hasAudio: Boolean(audioStream),
  };
}

export async function generateThumbnail(
  videoPath: string,
  timestampSec: number,
  outJpgPath: string
): Promise<string> {
  const safeVideo = resolveSafeDataPath(videoPath);
  const safeOut = resolveSafeDataPath(outJpgPath);
  await runProcess('ffmpeg', [
    '-y',
    '-ss',
    String(Math.max(0, timestampSec)),
    '-i',
    safeVideo,
    '-vframes',
    '1',
    '-vf',
    'scale=480:-2',
    '-q:v',
    '4',
    safeOut,
  ]);
  return safeOut;
}

export async function extractAudio(
  videoPath: string,
  outMp3Path: string,
  threads: number,
  totalDuration: number,
  onProgress?: (pct: number) => void
): Promise<string> {
  const safeVideo = resolveSafeDataPath(videoPath);
  const safeOut = resolveSafeDataPath(outMp3Path);

  await runProcess(
    'ffmpeg',
    [
      '-y',
      '-threads',
      String(Math.max(1, Math.min(8, threads))),
      '-i',
      safeVideo,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-b:a',
      '48k',
      '-progress',
      'pipe:1',
      safeOut,
    ],
    (chunk) => {
      if (onProgress && totalDuration > 0) {
        const t = parseFfmpegProgressTime(chunk);
        if (t !== null) {
          onProgress(Math.min(100, Math.round((t / totalDuration) * 100)));
        }
      }
    }
  );
  return safeOut;
}

export async function analyzeAudioPeakDb(mediaPath: string): Promise<number> {
  try {
    const safePath = resolveSafeDataPath(mediaPath);
    const { stderr } = await runProcess('ffmpeg', [
      '-i',
      safePath,
      '-af',
      'volumedetect',
      '-f',
      'null',
      '-',
    ]);
    const match = stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
    return match ? Number(match[1]) : -28;
  } catch {
    return -30;
  }
}

export async function detectAudioAndSceneFocus(
  videoPath: string,
  durationSec: number,
  threads: number
): Promise<{ focusXPercent: number; meanVolumeDb: number }> {
  const safeVideo = resolveSafeDataPath(videoPath);
  const sampleTime = Math.min(Math.max(0.5, durationSec * 0.25), Math.max(0.5, durationSec - 1));
  let meanVolumeDb = -24;
  let focusXPercent = 0;

  try {
    const { stderr } = await runProcess('ffmpeg', [
      '-threads',
      String(threads),
      '-ss',
      String(sampleTime),
      '-t',
      '4',
      '-i',
      safeVideo,
      '-vf',
      'cropdetect=24:16:0',
      '-af',
      'volumedetect',
      '-f',
      'null',
      '-',
    ]);

    const volMatch = stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
    if (volMatch) {
      meanVolumeDb = Number(volMatch[1]);
    }

    // Check active crop region center relative to full frame
    const cropMatches = [...stderr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
    if (cropMatches.length > 0) {
      const last = cropMatches[cropMatches.length - 1];
      const cw = Number(last[1]);
      const cx = Number(last[3]);
      const probe = await probeMedia(safeVideo);
      if (probe.width > 0 && cw > 0 && cw < probe.width) {
        const cropCenter = cx + cw / 2;
        const frameCenter = probe.width / 2;
        focusXPercent = Math.round(((cropCenter - frameCenter) / (probe.width / 2)) * 60);
      }
    }
  } catch {
    // Non-fatal analysis fallback
  }

  return { focusXPercent, meanVolumeDb };
}

export interface RenderClipOptions {
  sourceVideoPath: string;
  sourceWidth: number;
  sourceHeight: number;
  hasAudio: boolean;
  startTime: number;
  duration: number;
  cropMode: CropMode;
  focusXPercent: number;
  resolution: ResolutionOption;
  subtitleConfig: SubtitleConfig;
  transcript: TranscriptSegment[];
  musicTrackPath: string | null;
  musicVolume: number;
  introPath: string | null;
  outroPath: string | null;
  outputMp4Path: string;
  outputSrtPath?: string;
  threads: number;
  lowResourceMode: boolean;
  onProgress?: (pct: number) => void;
}

export async function renderVerticalClip(opts: RenderClipOptions): Promise<{
  mp4Path: string;
  srtPath?: string;
  sizeBytes: number;
}> {
  const safeSource = resolveSafeDataPath(opts.sourceVideoPath);
  const safeOutMp4 = resolveSafeDataPath(opts.outputMp4Path);
  const { width, height } = parseResolution(opts.resolution);
  const preset = opts.lowResourceMode || opts.resolution === '480x854' ? 'ultrafast' : 'veryfast';

  // Generate SRT if requested
  let safeSrtPath: string | undefined;
  if (opts.outputSrtPath) {
    safeSrtPath = resolveSafeDataPath(opts.outputSrtPath);
    fs.writeFileSync(safeSrtPath, generateSrt(opts.transcript), 'utf-8');
  }

  // Generate ASS file if captions enabled & transcript non-empty
  let assTempPath: string | null = null;
  if (opts.subtitleConfig.enabled && opts.transcript.length > 0) {
    assTempPath = path.join(DIRS.temp, `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.ass`);
    const assContent = generateAss(opts.transcript, opts.subtitleConfig, opts.resolution);
    fs.writeFileSync(assTempPath, assContent, 'utf-8');
  }

  const intermediateMainPath =
    opts.introPath || opts.outroPath
      ? path.join(DIRS.temp, `main_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp4`)
      : safeOutMp4;

  try {
    const args: string[] = [
      '-y',
      '-threads',
      String(Math.max(1, Math.min(8, opts.threads))),
      '-ss',
      String(Math.max(0, opts.startTime)),
      '-t',
      String(Math.max(1, opts.duration)),
      '-i',
      safeSource,
    ];

    const hasMusic = Boolean(opts.musicTrackPath && fs.existsSync(opts.musicTrackPath));
    if (hasMusic && opts.musicTrackPath) {
      const safeMusic = resolveSafeDataPath(opts.musicTrackPath);
      args.push('-stream_loop', '-1', '-i', safeMusic);
    } else if (!opts.hasAudio) {
      // Synthesize silent audio stream so concat/MP4 always has AAC audio
      args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
    }

    const baseCropFilter = buildVerticalCropFilter({
      mode: opts.cropMode,
      targetWidth: width,
      targetHeight: height,
      focusXPercent: opts.focusXPercent,
      sourceWidth: opts.sourceWidth,
      sourceHeight: opts.sourceHeight,
    });

    const assFilterSuffix = assTempPath
      ? `,ass='${escapeFfmpegFilterPath(assTempPath)}'`
      : '';

    const fullVideoFilter = `${baseCropFilter}${assFilterSuffix},fps=30,setsar=1[vout]`;

    const filterComplexParts: string[] = [];
    let videoInputRef = '[0:v]';
    if (opts.cropMode === 'fit_blur') {
      // fit_blur already starts with split=2
      filterComplexParts.push(`${videoInputRef}${fullVideoFilter}`);
    } else {
      filterComplexParts.push(`${videoInputRef}${fullVideoFilter}`);
    }

    let audioMapArg = '0:a?';
    if (hasMusic && opts.hasAudio) {
      const vol = Math.max(0.05, Math.min(0.8, opts.musicVolume));
      filterComplexParts.push(
        `[1:a]volume=${vol.toFixed(2)}[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]`
      );
      audioMapArg = '[aout]';
    } else if (hasMusic && !opts.hasAudio) {
      const vol = Math.max(0.1, Math.min(0.9, opts.musicVolume));
      filterComplexParts.push(`[1:a]volume=${vol.toFixed(2)},atrim=0:${opts.duration}[aout]`);
      audioMapArg = '[aout]';
    } else if (!opts.hasAudio) {
      filterComplexParts.push(`[1:a]atrim=0:${opts.duration}[aout]`);
      audioMapArg = '[aout]';
    }

    args.push(
      '-filter_complex',
      filterComplexParts.join(';'),
      '-map',
      '[vout]',
      '-map',
      audioMapArg,
      '-c:v',
      'libx264',
      '-preset',
      preset,
      '-crf',
      opts.lowResourceMode ? '26' : '22',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ar',
      '44100',
      '-ac',
      '2',
      '-shortest',
      '-movflags',
      '+faststart',
      '-progress',
      'pipe:1',
      intermediateMainPath
    );

    const hasConcat = Boolean(opts.introPath || opts.outroPath);
    await runProcess('ffmpeg', args, (chunk) => {
      if (opts.onProgress) {
        const t = parseFfmpegProgressTime(chunk);
        if (t !== null) {
          const maxPct = hasConcat ? 75 : 100;
          opts.onProgress(Math.min(maxPct, Math.round((t / opts.duration) * maxPct)));
        }
      }
    });

    // Concatenate normalized intro / main / outro if requested
    if (hasConcat) {
      const segmentsToJoin: string[] = [];
      if (opts.introPath && fs.existsSync(opts.introPath)) {
        segmentsToJoin.push(resolveSafeDataPath(opts.introPath));
      }
      segmentsToJoin.push(intermediateMainPath);
      if (opts.outroPath && fs.existsSync(opts.outroPath)) {
        segmentsToJoin.push(resolveSafeDataPath(opts.outroPath));
      }

      if (segmentsToJoin.length > 1) {
        const concatArgs: string[] = ['-y', '-threads', String(opts.threads)];
        for (const seg of segmentsToJoin) {
          concatArgs.push('-i', seg);
        }

        const normStreams: string[] = [];
        const concatInputs: string[] = [];
        segmentsToJoin.forEach((_, idx) => {
          normStreams.push(
            `[${idx}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=#090B0F,setsar=1,fps=30[v${idx}]`
          );
          normStreams.push(
            `[${idx}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a${idx}]`
          );
          concatInputs.push(`[v${idx}][a${idx}]`);
        });

        const filter = `${normStreams.join(';')};${concatInputs.join('')}concat=n=${segmentsToJoin.length}:v=1:a=1[vc][ac]`;
        concatArgs.push(
          '-filter_complex',
          filter,
          '-map',
          '[vc]',
          '-map',
          '[ac]',
          '-c:v',
          'libx264',
          '-preset',
          preset,
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-movflags',
          '+faststart',
          safeOutMp4
        );
        await runProcess('ffmpeg', concatArgs);
      } else if (intermediateMainPath !== safeOutMp4) {
        fs.renameSync(intermediateMainPath, safeOutMp4);
      }
    }

    opts.onProgress?.(100);
    const stat = fs.statSync(safeOutMp4);
    return {
      mp4Path: safeOutMp4,
      srtPath: safeSrtPath,
      sizeBytes: stat.size,
    };
  } finally {
    if (assTempPath && fs.existsSync(assTempPath)) {
      fs.unlinkSync(assTempPath);
    }
    if (intermediateMainPath !== safeOutMp4 && fs.existsSync(intermediateMainPath)) {
      fs.unlinkSync(intermediateMainPath);
    }
  }
}

export async function ensureBuiltInAssets(): Promise<void> {
  const musicSpecs: Array<{
    id: string;
    name: string;
    mood: string;
    filename: string;
    expr: string;
    duration: number;
  }> = [
    {
      id: 'bgm_lofi_chill',
      name: 'Midnight Studio Lo-Fi',
      mood: 'Chill & Focus',
      filename: 'studio_lofi.mp3',
      expr: '0.25*sin(2*PI*220*t)+0.2*sin(2*PI*277.18*t)+0.18*sin(2*PI*329.63*t)+0.1*sin(2*PI*2*t)*sin(2*PI*110*t)',
      duration: 30,
    },
    {
      id: 'bgm_upbeat_pulse',
      name: 'Creator Energy Pulse',
      mood: 'Upbeat & Tech',
      filename: 'upbeat_pulse.mp3',
      expr: '0.22*(0.5+0.5*sin(2*PI*4*t))*sin(2*PI*261.63*t)+0.18*sin(2*PI*392*t)+0.15*sin(2*PI*523.25*t)',
      duration: 30,
    },
    {
      id: 'bgm_cinematic_pad',
      name: 'Deep Horizon Pad',
      mood: 'Documentary & Story',
      filename: 'cinematic_pad.mp3',
      expr: '0.28*sin(2*PI*146.83*t)+0.22*sin(2*PI*220*t)+0.15*sin(2*PI*293.66*t)*(0.7+0.3*sin(2*PI*0.25*t))',
      duration: 30,
    },
  ];

  const generatedTracks: MusicTrack[] = [];
  for (const spec of musicSpecs) {
    const outPath = path.join(DIRS.assets, spec.filename);
    if (!fs.existsSync(outPath)) {
      await runProcess('ffmpeg', [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `aevalsrc=${spec.expr}:s=44100:d=${spec.duration}`,
        '-af',
        'lowpass=f=1800,afade=t=in:ss=0:d=1.5,afade=t=out:st=28:d=2',
        '-c:a',
        'libmp3lame',
        '-b:a',
        '128k',
        outPath,
      ]);
    }
    generatedTracks.push({
      id: spec.id,
      name: spec.name,
      mood: spec.mood,
      duration: spec.duration,
      filePath: outPath,
      isBuiltIn: true,
    });
  }

  const slateSpecs: Array<{
    id: string;
    name: string;
    kind: 'intro' | 'outro';
    filename: string;
    title: string;
    subtitle: string;
    bgColor: string;
    duration: number;
  }> = [
    {
      id: 'slate_intro_studio',
      name: 'ClipGenius Studio Intro (2s)',
      kind: 'intro',
      filename: 'intro_studio_slate.mp4',
      title: 'HIGHLIGHT REEL',
      subtitle: 'CLIPGENIUS STUDIO',
      bgColor: '0x0B1120',
      duration: 2,
    },
    {
      id: 'slate_outro_follow',
      name: 'Follow For Part 2 Outro (2s)',
      kind: 'outro',
      filename: 'outro_follow_slate.mp4',
      title: 'FOLLOW FOR MORE',
      subtitle: 'FULL EPISODE LINKED',
      bgColor: '0x090B0F',
      duration: 2,
    },
  ];

  const generatedSlates: IntroOutroAsset[] = [];
  for (const slate of slateSpecs) {
    const outPath = path.join(DIRS.assets, slate.filename);
    if (!fs.existsSync(outPath)) {
      const vf = [
        `drawbox=x=80:y=560:w=560:h=160:color=#1E293B@0.7:t=fill`,
        `drawtext=font='DejaVu Sans':text='${slate.title}':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=(h-text_h)/2-20`,
        `drawtext=font='DejaVu Sans':text='${slate.subtitle}':fontcolor=#60A5FA:fontsize=22:x=(w-text_w)/2:y=(h-text_h)/2+38`,
      ].join(',');

      await runProcess('ffmpeg', [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `color=c=${slate.bgColor}:s=720x1280:r=30:d=${slate.duration}`,
        '-f',
        'lavfi',
        '-i',
        `anullsrc=channel_layout=stereo:sample_rate=44100:d=${slate.duration}`,
        '-vf',
        vf,
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '96k',
        '-shortest',
        outPath,
      ]);
    }
    generatedSlates.push({
      id: slate.id,
      name: slate.name,
      kind: slate.kind,
      duration: slate.duration,
      filePath: outPath,
      isBuiltIn: true,
    });
  }

  updateDb((db) => {
    const customMusic = db.musicTracks.filter((m) => !m.isBuiltIn);
    db.musicTracks = [...generatedTracks, ...customMusic];

    const customSlates = db.introOutroAssets.filter((a) => !a.isBuiltIn);
    db.introOutroAssets = [...generatedSlates, ...customSlates];
  });
}

export async function generateSamplePodcastVideo(outMp4Path: string): Promise<string> {
  const safeOut = resolveSafeDataPath(outMp4Path);
  if (fs.existsSync(safeOut)) return safeOut;

  // Synthesize a realistic 30-second spoken-word creator podcast sample using libflite
  const speechText =
    'Welcome back to the Creator Growth Show! Today we uncovered something wild about short form video retention. ' +
    'Most creators spend ten hours editing a single podcast, when ninety percent of their viral views come from three thirty-second moments! ' +
    'Listen to this data point. Vertical videos with animated word-by-word captions see forty-two percent higher completion rates! ' +
    'That is why automating highlight detection changes everything for solo founders and live streamers.';

  const textFile = path.join(DIRS.temp, `flite_sample_${Date.now()}.txt`);
  fs.writeFileSync(textFile, speechText, 'utf-8');

  const vf = [
    `drawbox=x=0:y=0:w=1280:h=720:color=#0B101B:t=fill`,
    `drawbox=x=70:y=90:w=540:h=540:color=#162033:t=fill`,
    `drawbox=x=670:y=90:w=540:h=540:color=#1B273D:t=fill`,
    `drawbox=x=220:y=210:w=240:h=240:color=#3B82F6@0.35:t=fill`,
    `drawbox=x=820:y=210:w=240:h=240:color=#F59E0B@0.35:t=fill`,
    `drawtext=font='DejaVu Sans':text='HOST CAM - STUDIO A':fontcolor=#94A3B8:fontsize=20:x=100:y=120`,
    `drawtext=font='DejaVu Sans':text='GUEST CAM - STUDIO B':fontcolor=#94A3B8:fontsize=20:x=700:y=120`,
    `drawtext=font='DejaVu Sans':text='CREATOR GROWTH PODCAST EP 42':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=36`,
    `drawtext=font='DejaVu Sans':text='%{pts\\:hms}':fontcolor=#60A5FA:fontsize=24:x=1080:y=36`,
  ].join(',');

  try {
    await runProcess('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=#0B101B:s=1280x720:r=30:d=30',
      '-f',
      'lavfi',
      '-i',
      `flite=textfile='${escapeFfmpegFilterPath(textFile)}':voice=slt`,
      '-vf',
      vf,
      '-af',
      'apad',
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
      '-ar',
      '44100',
      '-ac',
      '2',
      '-t',
      '30',
      '-movflags',
      '+faststart',
      safeOut,
    ]);
  } finally {
    if (fs.existsSync(textFile)) fs.unlinkSync(textFile);
  }

  return safeOut;
}

export async function generateLiveDemoSegment(
  outMp4Path: string,
  segmentIndex: number
): Promise<string> {
  const safeOut = resolveSafeDataPath(outMp4Path);
  const topics = [
    'Breaking news right now on stream! Our community just hit one hundred thousand subscribers live on air. Look at the chat exploding!',
    'Let us talk about the biggest mistake creators make when clipping live streams. Never cut mid-sentence without a hook!',
    'Wait did you just see that play? That reaction was unreal. Definitely saving that moment as a viral highlight clip!',
    'Quick question from live chat. Yes, automatic Hindi, Bengali, and English captions work directly in the studio editor.',
  ];
  const line = topics[segmentIndex % topics.length];
  const accentColors = ['#3B82F6', '#F59E0B', '#10B981', '#EC4899'];
  const accent = accentColors[segmentIndex % accentColors.length];

  const textFile = path.join(DIRS.temp, `flite_live_${Date.now()}_${segmentIndex}.txt`);
  fs.writeFileSync(textFile, line, 'utf-8');

  const vf = [
    `drawbox=x=40:y=40:w=1200:h=640:color=#111827:t=fill`,
    `drawbox=x=80:y=80:w=180:h=44:color=#DC2626:t=fill`,
    `drawtext=font='DejaVu Sans':text='LIVE SEG ${segmentIndex + 1}':fontcolor=white:fontsize=22:x=105:y=92`,
    `drawbox=x=490:y=210:w=300:h=300:color=${accent}@0.35:t=fill`,
    `drawtext=font='DejaVu Sans':text='LIVE BROADCAST FEED':fontcolor=white:fontsize=34:x=(w-text_w)/2:y=140`,
    `drawtext=font='DejaVu Sans':text='%{pts\\:hms}':fontcolor=#94A3B8:fontsize=24:x=1080:y=92`,
  ].join(',');

  try {
    await runProcess('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=#090B0F:s=1280x720:r=30:d=15',
      '-f',
      'lavfi',
      '-i',
      `flite=textfile='${escapeFfmpegFilterPath(textFile)}':voice=slt`,
      '-vf',
      vf,
      '-af',
      'apad',
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
      '-t',
      '15',
      '-movflags',
      '+faststart',
      safeOut,
    ]);
  } finally {
    if (fs.existsSync(textFile)) fs.unlinkSync(textFile);
  }
  return safeOut;
}

export async function concatMp4Segments(
  segmentPaths: string[],
  outMp4Path: string,
  threads: number
): Promise<string> {
  const safeOut = resolveSafeDataPath(outMp4Path);
  const safeSegs = segmentPaths.map((p) => resolveSafeDataPath(p));
  if (safeSegs.length === 1) {
    fs.copyFileSync(safeSegs[0], safeOut);
    return safeOut;
  }

  const listFile = path.join(DIRS.temp, `concat_${Date.now()}.txt`);
  try {
    fs.writeFileSync(listFile, safeSegs.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join('\n'), 'utf-8');
    await runProcess('ffmpeg', [
      '-y',
      '-threads',
      String(threads),
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listFile,
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      safeOut,
    ]);
    return safeOut;
  } finally {
    if (fs.existsSync(listFile)) fs.unlinkSync(listFile);
  }
}
