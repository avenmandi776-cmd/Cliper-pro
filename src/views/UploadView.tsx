import { FileVideo, Play, Scissors, Sparkles, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import type {
  ClipDurationOption,
  CropMode,
  LanguageCode,
  ResolutionOption,
  VideoRecord,
} from '../../shared/types';
import { formatBytes, formatDuration } from '../api/client';

interface UploadViewProps {
  videos: VideoRecord[];
  defaultDuration: ClipDurationOption;
  defaultLanguage: LanguageCode;
  defaultResolution: ResolutionOption;
  defaultCropMode: CropMode;
  geminiConfigured: boolean;
  onUpload: (formData: FormData) => Promise<void>;
  onLoadSample: (opts: {
    clipDuration: ClipDurationOption;
    language: LanguageCode;
    resolution: ResolutionOption;
    cropMode: CropMode;
    autoAnalyze: boolean;
  }) => Promise<void>;
  onAnalyzeVideo: (
    videoId: string,
    opts: {
      clipDuration: ClipDurationOption;
      language: LanguageCode;
      resolution: ResolutionOption;
      cropMode: CropMode;
    }
  ) => Promise<void>;
  onCreateManualClip: (
    videoId: string,
    opts: {
      startTime: number;
      duration: number;
      resolution: ResolutionOption;
      cropMode: CropMode;
      language: LanguageCode;
      title?: string;
    }
  ) => Promise<void>;
  onDeleteVideo: (videoId: string) => Promise<void>;
}

const DURATIONS: ClipDurationOption[] = [15, 30, 45, 60];

export function UploadView({
  videos,
  defaultDuration,
  defaultLanguage,
  defaultResolution,
  defaultCropMode,
  geminiConfigured,
  onUpload,
  onLoadSample,
  onAnalyzeVideo,
  onCreateManualClip,
  onDeleteVideo,
}: UploadViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [clipDuration, setClipDuration] = useState<ClipDurationOption>(defaultDuration);
  const [language, setLanguage] = useState<LanguageCode>(defaultLanguage);
  const [resolution, setResolution] = useState<ResolutionOption>(defaultResolution);
  const [cropMode, setCropMode] = useState<CropMode>(defaultCropMode);
  const [uploading, setUploading] = useState(false);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [manualStartMap, setManualStartMap] = useState<Record<string, number>>({});
  const [manualBusyId, setManualBusyId] = useState<string | null>(null);

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('video', selectedFile);
      if (title.trim()) fd.append('title', title.trim());
      fd.append('clipDuration', String(clipDuration));
      fd.append('language', language);
      fd.append('resolution', resolution);
      fd.append('cropMode', cropMode);
      fd.append('autoAnalyze', 'true');
      await onUpload(fd);
      setSelectedFile(null);
      setTitle('');
    } finally {
      setUploading(false);
    }
  };

  const handleSampleClick = async () => {
    setSampleLoading(true);
    try {
      await onLoadSample({
        clipDuration,
        language,
        resolution,
        cropMode,
        autoAnalyze: geminiConfigured,
      });
    } finally {
      setSampleLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Upload & Configuration Form */}
        <form
          onSubmit={handleUploadSubmit}
          className="lg:col-span-7 bg-[#11151C] border border-white/8 rounded-xl p-6 space-y-6"
        >
          <div>
            <h2 className="font-display text-lg font-semibold text-white">
              Upload Source Video
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Upload MP4, MOV, WebM, or MKV. FFmpeg extracts audio and renders 9:16 vertical clips after Gemini highlight analysis.
            </p>
          </div>

          {/* Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              const file = e.dataTransfer.files?.[0];
              if (file) {
                setSelectedFile(file);
                if (!title) setTitle(file.name.replace(/\.[^.]+$/, ''));
              }
            }}
            className={`rounded-xl border border-dashed p-8 text-center transition-colors ${
              dragActive
                ? 'border-blue-500 bg-blue-500/10'
                : 'border-white/15 bg-[#0B0E14] hover:border-white/25'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/x-matroska"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setSelectedFile(file);
                  if (!title) setTitle(file.name.replace(/\.[^.]+$/, ''));
                }
              }}
              className="hidden"
              aria-label="Choose video file"
            />
            <FileVideo className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
            {selectedFile ? (
              <div className="mt-3">
                <p className="text-sm font-medium text-white">{selectedFile.name}</p>
                <p className="mt-1 text-xs font-mono text-slate-400">
                  {formatBytes(selectedFile.size)}
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-300">
                Drag and drop your video here, or browse from disk
              </p>
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-4 px-4 py-2 rounded-lg bg-white/8 hover:bg-white/12 text-xs font-medium text-slate-100 transition-colors"
            >
              {selectedFile ? 'Change Video File' : 'Select Video File'}
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="video-title" className="block text-xs font-medium text-slate-300 mb-1.5">
                Project Title
              </label>
              <input
                id="video-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Founder Podcast Episode 42"
                className="w-full rounded-lg bg-[#090B0F] border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* Clip Duration Segmented Selector */}
            <div>
              <span className="block text-xs font-medium text-slate-300 mb-1.5">
                Target Clip Duration
              </span>
              <div className="grid grid-cols-4 gap-2 p-1 rounded-lg bg-[#090B0F] border border-white/8">
                {DURATIONS.map((dur) => (
                  <button
                    key={dur}
                    type="button"
                    onClick={() => setClipDuration(dur)}
                    className={`py-2 rounded-md text-xs font-mono font-medium transition-colors whitespace-nowrap ${
                      clipDuration === dur
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {dur}s
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor="upload-lang" className="block text-xs font-medium text-slate-300 mb-1.5">
                  Speech & Captions
                </label>
                <select
                  id="upload-lang"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as LanguageCode)}
                  className="w-full rounded-lg bg-[#090B0F] border border-white/10 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="en">English</option>
                  <option value="hi">Hindi (हिन्दी)</option>
                  <option value="bn">Bengali (বাংলা)</option>
                </select>
              </div>

              <div>
                <label htmlFor="upload-res" className="block text-xs font-medium text-slate-300 mb-1.5">
                  9:16 Resolution
                </label>
                <select
                  id="upload-res"
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value as ResolutionOption)}
                  className="w-full rounded-lg bg-[#090B0F] border border-white/10 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="720x1280">720 × 1280 (HD)</option>
                  <option value="480x854">480 × 854 (Low-Resource)</option>
                </select>
              </div>

              <div>
                <label htmlFor="upload-crop" className="block text-xs font-medium text-slate-300 mb-1.5">
                  Reframing Mode
                </label>
                <select
                  id="upload-crop"
                  value={cropMode}
                  onChange={(e) => setCropMode(e.target.value as CropMode)}
                  className="w-full rounded-lg bg-[#090B0F] border border-white/10 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="auto_face">Auto Face / Subject</option>
                  <option value="center">Center 9:16 Crop</option>
                  <option value="fit_blur">Fit + Blur Backdrop</option>
                </select>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={!selectedFile || uploading}
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-sm font-semibold text-white transition-colors"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            <span>{uploading ? 'Uploading & Starting Pipeline...' : 'Upload & Analyze with AI'}</span>
          </button>
        </form>

        {/* Sample Video Testing Card */}
        <div className="lg:col-span-5 bg-[#11151C] border border-white/8 rounded-xl p-6 space-y-5">
          <div>
            <h2 className="font-display text-lg font-semibold text-white">
              Sample Video Testing
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Generate a real 40-second spoken-word 16:9 podcast video locally using FFmpeg so you can test AI clipping, 9:16 reframing, and word-by-word captions without uploading a file.
            </p>
          </div>

          <div className="rounded-lg bg-[#090B0F] border border-white/6 p-4 space-y-2 text-xs text-slate-400">
            <p className="font-medium text-slate-200">Included in sample video:</p>
            <p>· 1280×720 dual-speaker studio visual layout at 30 fps</p>
            <p>· Synthesized spoken-word creator podcast audio track</p>
            <p>· Ready for Gemini highlight scoring or direct FFmpeg clipping</p>
          </div>

          <button
            type="button"
            onClick={handleSampleClick}
            disabled={sampleLoading}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-white/10 hover:bg-white/15 text-sm font-medium text-white transition-colors disabled:opacity-50"
          >
            <Play className="h-4 w-4" aria-hidden="true" />
            <span>{sampleLoading ? 'Synthesizing Sample MP4...' : 'Load Sample Podcast Video'}</span>
          </button>
        </div>
      </div>

      {/* Uploaded Source Videos List */}
      <section className="space-y-3">
        <h2 className="font-display text-base font-semibold text-white">
          Uploaded & Sample Videos ({videos.length})
        </h2>

        {videos.length === 0 ? (
          <div className="bg-[#11151C] border border-white/8 rounded-xl p-8 text-center text-sm text-slate-400">
            No source videos yet. Upload a file or click Load Sample Podcast Video above.
          </div>
        ) : (
          <div className="space-y-4">
            {videos.map((video) => {
              const startSec = manualStartMap[video.id] ?? 0;
              return (
                <div
                  key={video.id}
                  className="bg-[#11151C] border border-white/8 rounded-xl p-5 flex flex-col xl:flex-row xl:items-center justify-between gap-5"
                >
                  <div className="flex flex-col sm:flex-row gap-4 min-w-0">
                    <div className="w-full sm:w-44 aspect-video rounded-lg overflow-hidden bg-black border border-white/8 shrink-0">
                      <video
                        src={video.filePath}
                        poster={video.thumbnailPath}
                        controls
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-white truncate">{video.title}</h3>
                      <p className="mt-1 text-xs font-mono text-slate-400 tabular-nums">
                        {formatDuration(video.duration)} · {video.width}×{video.height} ·{' '}
                        {video.fps} fps · {formatBytes(video.sizeBytes)}
                      </p>
                      {video.summary && (
                        <p className="mt-2 text-xs text-slate-300 max-w-2xl">{video.summary}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 shrink-0">
                    <div className="flex items-center gap-2 bg-[#090B0F] border border-white/8 rounded-lg px-3 py-1.5">
                      <label
                        htmlFor={`start-${video.id}`}
                        className="text-xs text-slate-400 whitespace-nowrap"
                      >
                        Start (s):
                      </label>
                      <input
                        id={`start-${video.id}`}
                        type="number"
                        min={0}
                        max={Math.max(0, Math.floor(video.duration - 5))}
                        value={startSec}
                        onChange={(e) =>
                          setManualStartMap((prev) => ({
                            ...prev,
                            [video.id]: Number(e.target.value) || 0,
                          }))
                        }
                        className="w-14 bg-transparent text-xs font-mono text-white focus:outline-none tabular-nums"
                      />
                      <button
                        type="button"
                        disabled={manualBusyId === video.id}
                        onClick={async () => {
                          setManualBusyId(video.id);
                          try {
                            await onCreateManualClip(video.id, {
                              startTime: startSec,
                              duration: clipDuration,
                              resolution,
                              cropMode,
                              language,
                            });
                          } finally {
                            setManualBusyId(null);
                          }
                        }}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-white/10 hover:bg-white/15 text-xs font-medium text-white whitespace-nowrap"
                      >
                        <Scissors className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>
                          {manualBusyId === video.id
                            ? 'Cutting...'
                            : `Cut ${clipDuration}s 9:16`}
                        </span>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        onAnalyzeVideo(video.id, {
                          clipDuration,
                          language,
                          resolution,
                          cropMode,
                        })
                      }
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white transition-colors whitespace-nowrap"
                    >
                      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Run AI Highlights</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onDeleteVideo(video.id)}
                      aria-label={`Delete ${video.title}`}
                      className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
