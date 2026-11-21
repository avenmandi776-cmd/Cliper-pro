import { Download, Music, Save, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type {
  CropMode,
  HighlightClip,
  IntroOutroAsset,
  MusicTrack,
  ResolutionOption,
  VideoRecord,
} from '../../shared/types';
import { VideoPlayer916 } from '../components/VideoPlayer916';

interface EditorViewProps {
  clips: HighlightClip[];
  videos: VideoRecord[];
  musicTracks: MusicTrack[];
  introOutroAssets: IntroOutroAsset[];
  selectedClipId: string | null;
  onSelectClip: (clipId: string) => void;
  onSaveClip: (clipId: string, patch: Partial<HighlightClip>) => Promise<void>;
  onRenderPreview: (clipId: string) => Promise<void>;
  onExportClip: (clipId: string) => Promise<void>;
  onUploadMusic: (fd: FormData) => Promise<void>;
  onUploadSlate: (fd: FormData) => Promise<void>;
}

export function EditorView({
  clips,
  videos,
  musicTracks,
  introOutroAssets,
  selectedClipId,
  onSelectClip,
  onSaveClip,
  onRenderPreview,
  onExportClip,
  onUploadMusic,
  onUploadSlate,
}: EditorViewProps) {
  const activeClip = clips.find((c) => c.id === selectedClipId) ?? clips[0] ?? null;
  const sourceVideo = videos.find((v) => v.id === activeClip?.videoId);

  const [title, setTitle] = useState(activeClip?.title ?? '');
  const [startTime, setStartTime] = useState(activeClip?.startTime ?? 0);
  const [endTime, setEndTime] = useState(activeClip?.endTime ?? 15);
  const [resolution, setResolution] = useState<ResolutionOption>(
    activeClip?.resolution ?? '720x1280'
  );
  const [cropMode, setCropMode] = useState<CropMode>(activeClip?.cropMode ?? 'auto_face');
  const [focusXPercent, setFocusXPercent] = useState(activeClip?.focusXPercent ?? 0);
  const [musicTrackId, setMusicTrackId] = useState<string | null>(
    activeClip?.musicTrackId ?? null
  );
  const [musicVolume, setMusicVolume] = useState(activeClip?.musicVolume ?? 0.18);
  const [introAssetId, setIntroAssetId] = useState<string | null>(
    activeClip?.introAssetId ?? null
  );
  const [outroAssetId, setOutroAssetId] = useState<string | null>(
    activeClip?.outroAssetId ?? null
  );
  const [captionsEnabled, setCaptionsEnabled] = useState(
    activeClip?.subtitleConfig.enabled ?? true
  );
  const [rendering, setRendering] = useState(false);

  const musicUploadRef = useRef<HTMLInputElement | null>(null);
  const introUploadRef = useRef<HTMLInputElement | null>(null);
  const outroUploadRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!activeClip) return;
    setTitle(activeClip.title);
    setStartTime(activeClip.startTime);
    setEndTime(activeClip.endTime);
    setResolution(activeClip.resolution);
    setCropMode(activeClip.cropMode);
    setFocusXPercent(activeClip.focusXPercent);
    setMusicTrackId(activeClip.musicTrackId);
    setMusicVolume(activeClip.musicVolume);
    setIntroAssetId(activeClip.introAssetId);
    setOutroAssetId(activeClip.outroAssetId);
    setCaptionsEnabled(activeClip.subtitleConfig.enabled);
  }, [activeClip?.id]);

  if (!activeClip) {
    return (
      <div className="bg-[#11151C] border border-white/8 rounded-xl p-12 text-center">
        <p className="text-sm text-slate-400">
          No clips available to edit. Upload a video or load the sample podcast video first.
        </p>
      </div>
    );
  }

  const intros = introOutroAssets.filter((a) => a.kind === 'intro');
  const outros = introOutroAssets.filter((a) => a.kind === 'outro');
  const maxVideoDuration = Math.max(15, sourceVideo?.duration ?? activeClip.endTime + 10);

  const buildPatch = (): Partial<HighlightClip> => ({
    title,
    startTime,
    endTime: Math.max(startTime + 3, endTime),
    resolution,
    cropMode,
    focusXPercent,
    musicTrackId,
    musicVolume,
    introAssetId,
    outroAssetId,
    subtitleConfig: {
      ...activeClip.subtitleConfig,
      enabled: captionsEnabled,
    },
  });

  const handleSaveAndRender = async () => {
    setRendering(true);
    try {
      await onSaveClip(activeClip.id, buildPatch());
      await onRenderPreview(activeClip.id);
    } finally {
      setRendering(false);
    }
  };

  const handleExport = async () => {
    await onSaveClip(activeClip.id, buildPatch());
    await onExportClip(activeClip.id);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* Left Editor Controls */}
      <div className="xl:col-span-7 space-y-6">
        <div className="bg-[#11151C] border border-white/8 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <label htmlFor="editor-clip-select" className="block text-xs text-slate-400 mb-1">
              Editing Clip
            </label>
            <select
              id="editor-clip-select"
              value={activeClip.id}
              onChange={(e) => onSelectClip(e.target.value)}
              className="w-full rounded-lg bg-[#090B0F] border border-white/10 px-3 py-2 text-sm text-white"
            >
              {clips.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={handleSaveAndRender}
            disabled={rendering}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-medium text-white whitespace-nowrap disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{rendering ? 'Rendering FFmpeg Preview...' : 'Apply & Render Preview'}</span>
          </button>
        </div>

        {/* Framing, Resolution & Trim */}
        <div className="bg-[#11151C] border border-white/8 rounded-xl p-6 space-y-5">
          <h2 className="font-display text-base font-semibold text-white">
            9:16 Vertical Framing & Trim
          </h2>

          <div>
            <label htmlFor="ed-title" className="block text-xs font-medium text-slate-300 mb-1.5">
              Clip Title
            </label>
            <input
              id="ed-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg bg-[#090B0F] border border-white/10 px-3.5 py-2 text-sm text-white"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="ed-start" className="block text-xs font-medium text-slate-300 mb-1.5">
                Start Time ({startTime.toFixed(1)}s)
              </label>
              <input
                id="ed-start"
                type="range"
                min={0}
                max={Math.max(0, maxVideoDuration - 3)}
                step={0.5}
                value={startTime}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setStartTime(v);
                  if (endTime < v + 3) setEndTime(Math.min(maxVideoDuration, v + 3));
                }}
                className="w-full accent-blue-500"
              />
            </div>

            <div>
              <label htmlFor="ed-end" className="block text-xs font-medium text-slate-300 mb-1.5">
                End Time ({endTime.toFixed(1)}s)
              </label>
              <input
                id="ed-end"
                type="range"
                min={Math.min(maxVideoDuration, startTime + 3)}
                max={maxVideoDuration}
                step={0.5}
                value={endTime}
                onChange={(e) => setEndTime(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="ed-res" className="block text-xs font-medium text-slate-300 mb-1.5">
                Export Resolution
              </label>
              <select
                id="ed-res"
                value={resolution}
                onChange={(e) => setResolution(e.target.value as ResolutionOption)}
                className="w-full rounded-lg bg-[#090B0F] border border-white/10 px-3 py-2 text-sm text-white"
              >
                <option value="720x1280">720 × 1280 (9:16 HD)</option>
                <option value="480x854">480 × 854 (Low-Resolution Fast)</option>
              </select>
            </div>

            <div>
              <label htmlFor="ed-crop" className="block text-xs font-medium text-slate-300 mb-1.5">
                Auto-Reframe & Face Tracking
              </label>
              <select
                id="ed-crop"
                value={cropMode}
                onChange={(e) => setCropMode(e.target.value as CropMode)}
                className="w-full rounded-lg bg-[#090B0F] border border-white/10 px-3 py-2 text-sm text-white"
              >
                <option value="auto_face">Auto Subject / Face Track</option>
                <option value="center">Center 9:16 Crop</option>
                <option value="fit_blur">Fit 16:9 + Blurred Backdrop</option>
              </select>
            </div>
          </div>

          {cropMode !== 'fit_blur' && (
            <div>
              <label htmlFor="ed-focus" className="block text-xs font-medium text-slate-300 mb-1.5">
                Horizontal Focus Offset ({focusXPercent}%)
              </label>
              <input
                id="ed-focus"
                type="range"
                min={-100}
                max={100}
                value={focusXPercent}
                onChange={(e) => setFocusXPercent(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
            </div>
          )}

          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={captionsEnabled}
              onChange={(e) => setCaptionsEnabled(e.target.checked)}
              className="accent-blue-600"
            />
            <span>Burn in animated word-by-word captions on MP4 export</span>
          </label>
        </div>

        {/* Background Music & Intro/Outro */}
        <div className="bg-[#11151C] border border-white/8 rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-white">
              Licensed Music & Intro / Outro
            </h2>
            <div className="flex items-center gap-2">
              <input
                ref={musicUploadRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const fd = new FormData();
                  fd.append('audio', file);
                  fd.append('name', file.name.replace(/\.[^.]+$/, ''));
                  await onUploadMusic(fd);
                }}
              />
              <button
                type="button"
                onClick={() => musicUploadRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/8 hover:bg-white/12 text-xs font-medium text-slate-200 whitespace-nowrap"
              >
                <Music className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Add Music</span>
              </button>

              <input
                ref={introUploadRef}
                type="file"
                accept="video/mp4,video/quicktime,video/webm"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const fd = new FormData();
                  fd.append('video', file);
                  fd.append('kind', 'intro');
                  fd.append('name', file.name.replace(/\.[^.]+$/, ''));
                  await onUploadSlate(fd);
                }}
              />
              <button
                type="button"
                onClick={() => introUploadRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/8 hover:bg-white/12 text-xs font-medium text-slate-200 whitespace-nowrap"
              >
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Upload Intro</span>
              </button>

              <input
                ref={outroUploadRef}
                type="file"
                accept="video/mp4,video/quicktime,video/webm"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const fd = new FormData();
                  fd.append('video', file);
                  fd.append('kind', 'outro');
                  fd.append('name', file.name.replace(/\.[^.]+$/, ''));
                  await onUploadSlate(fd);
                }}
              />
              <button
                type="button"
                onClick={() => outroUploadRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/8 hover:bg-white/12 text-xs font-medium text-slate-200 whitespace-nowrap"
              >
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Upload Outro</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="ed-music" className="block text-xs font-medium text-slate-300 mb-1.5">
                Background Music
              </label>
              <select
                id="ed-music"
                value={musicTrackId ?? ''}
                onChange={(e) => setMusicTrackId(e.target.value || null)}
                className="w-full rounded-lg bg-[#090B0F] border border-white/10 px-3 py-2 text-sm text-white"
              >
                <option value="">None (Original Audio Only)</option>
                {musicTracks.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.mood})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="ed-vol" className="block text-xs font-medium text-slate-300 mb-1.5">
                Music Mix Level ({Math.round(musicVolume * 100)}%)
              </label>
              <input
                id="ed-vol"
                type="range"
                min={0.05}
                max={0.6}
                step={0.05}
                value={musicVolume}
                onChange={(e) => setMusicVolume(Number(e.target.value))}
                className="w-full mt-2 accent-blue-500"
              />
            </div>

            <div>
              <label htmlFor="ed-intro" className="block text-xs font-medium text-slate-300 mb-1.5">
                Custom Intro
              </label>
              <select
                id="ed-intro"
                value={introAssetId ?? ''}
                onChange={(e) => setIntroAssetId(e.target.value || null)}
                className="w-full rounded-lg bg-[#090B0F] border border-white/10 px-3 py-2 text-sm text-white"
              >
                <option value="">No Intro</option>
                {intros.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="ed-outro" className="block text-xs font-medium text-slate-300 mb-1.5">
                Custom Outro
              </label>
              <select
                id="ed-outro"
                value={outroAssetId ?? ''}
                onChange={(e) => setOutroAssetId(e.target.value || null)}
                className="w-full rounded-lg bg-[#090B0F] border border-white/10 px-3 py-2 text-sm text-white"
              >
                <option value="">No Outro</option>
                {outros.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Right Preview & Final Export */}
      <div className="xl:col-span-5 bg-[#11151C] border border-white/8 rounded-xl p-6 space-y-5 xl:sticky xl:top-6">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-sm font-semibold text-white">9:16 Studio Preview</h3>
          <span className="font-mono text-xs text-slate-400 tabular-nums">
            {resolution} · {(endTime - startTime).toFixed(1)}s
          </span>
        </div>

        <VideoPlayer916
          src={activeClip.previewPath}
          poster={activeClip.thumbnailPath}
          subtitleConfig={{ ...activeClip.subtitleConfig, enabled: captionsEnabled }}
          transcript={activeClip.transcript}
        />

        <button
          type="button"
          onClick={handleExport}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-semibold text-white transition-colors"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          <span>Render & Export MP4</span>
        </button>
      </div>
    </div>
  );
}
