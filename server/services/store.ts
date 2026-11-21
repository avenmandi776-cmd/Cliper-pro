import fs from 'node:fs';
import path from 'node:path';
import type {
  AppSettings,
  ExportRecord,
  HighlightClip,
  IntroOutroAsset,
  LiveStreamSession,
  MusicTrack,
  ProcessingJob,
  VideoRecord,
} from '../../shared/types';

export const DATA_ROOT = path.resolve(process.cwd(), 'data');
export const DIRS = {
  root: DATA_ROOT,
  uploads: path.join(DATA_ROOT, 'uploads'),
  clips: path.join(DATA_ROOT, 'clips'),
  exports: path.join(DATA_ROOT, 'exports'),
  thumbnails: path.join(DATA_ROOT, 'thumbnails'),
  assets: path.join(DATA_ROOT, 'assets'),
  live: path.join(DATA_ROOT, 'live'),
  temp: path.join(DATA_ROOT, 'temp'),
};

const DB_PATH = path.join(DATA_ROOT, 'db.json');

export interface DatabaseSchema {
  videos: VideoRecord[];
  clips: HighlightClip[];
  jobs: ProcessingJob[];
  exports: ExportRecord[];
  liveSessions: LiveStreamSession[];
  musicTracks: MusicTrack[];
  introOutroAssets: IntroOutroAsset[];
  settings: AppSettings;
}

export const DEFAULT_SETTINGS: AppSettings = {
  geminiModel: process.env.GEMINI_MODEL || 'gemini-4-hydrogen',
  ffmpegThreads: 2,
  defaultClipDuration: 30,
  defaultResolution: '720x1280',
  defaultLanguage: 'en',
  lowResourceMode: false,
  autoReframeDefault: 'auto_face',
};

export function ensureDirectories(): void {
  for (const dir of Object.values(DIRS)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function resolveSafeDataPath(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  if (!resolved.startsWith(DATA_ROOT + path.sep) && resolved !== DATA_ROOT) {
    throw new Error('Access denied: path resolves outside media storage directory.');
  }
  return resolved;
}

export function toPublicMediaUrl(absPath: string): string {
  if (!absPath) return '';
  const resolved = path.resolve(absPath);
  if (!resolved.startsWith(DATA_ROOT + path.sep)) return '';
  const rel = path.relative(DATA_ROOT, resolved).split(path.sep).join('/');
  return `/media/${rel}`;
}

function createInitialDb(): DatabaseSchema {
  return {
    videos: [],
    clips: [],
    jobs: [],
    exports: [],
    liveSessions: [],
    musicTracks: [],
    introOutroAssets: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

let dbCache: DatabaseSchema | null = null;

export function getDb(): DatabaseSchema {
  ensureDirectories();
  if (dbCache) return dbCache;

  if (!fs.existsSync(DB_PATH)) {
    dbCache = createInitialDb();
    saveDb(dbCache);
    return dbCache;
  }

  try {
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<DatabaseSchema>;
    dbCache = {
      videos: parsed.videos ?? [],
      clips: parsed.clips ?? [],
      jobs: (parsed.jobs ?? []).map((j) =>
        j.status === 'processing' || j.status === 'queued'
          ? {
              ...j,
              status: 'failed',
              canResume: true,
              errorMessage: j.errorMessage || 'Interrupted by server restart. Click Resume to continue.',
            }
          : j
      ),
      exports: parsed.exports ?? [],
      liveSessions: (parsed.liveSessions ?? []).map((s) =>
        s.status === 'monitoring' ? { ...s, status: 'stopped' } : s
      ),
      musicTracks: parsed.musicTracks ?? [],
      introOutroAssets: parsed.introOutroAssets ?? [],
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
    };
    return dbCache;
  } catch {
    dbCache = createInitialDb();
    saveDb(dbCache);
    return dbCache;
  }
}

export function saveDb(nextDb?: DatabaseSchema): void {
  ensureDirectories();
  const target = nextDb ?? getDb();
  dbCache = target;
  const tmpPath = `${DB_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(target, null, 2), 'utf-8');
  fs.renameSync(tmpPath, DB_PATH);
}

export function updateDb(mutator: (db: DatabaseSchema) => void): DatabaseSchema {
  const db = getDb();
  mutator(db);
  saveDb(db);
  return db;
}
