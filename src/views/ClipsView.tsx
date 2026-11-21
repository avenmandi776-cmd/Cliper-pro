import {
  Captions,
  Copy,
  Download,
  RefreshCw,
  Search,
  Sliders,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { HighlightClip } from '../../shared/types';
import { formatDuration } from '../api/client';
import { VideoPlayer916 } from '../components/VideoPlayer916';

interface ClipsViewProps {
  clips: HighlightClip[];
  onEditClip: (clipId: string) => void;
  onCaptionClip: (clipId: string) => void;
  onExportClip: (clipId: string) => Promise<void>;
  onRegenerateMetadata: (clipId: string) => Promise<void>;
  onDeleteClip: (clipId: string) => Promise<void>;
  onNotify: (msg: string) => void;
}

export function ClipsView({
  clips,
  onEditClip,
  onCaptionClip,
  onExportClip,
  onRegenerateMetadata,
  onDeleteClip,
  onNotify,
}: ClipsViewProps) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [selectedClipId, setSelectedClipId] = useState<string | null>(clips[0]?.id ?? null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clips.filter((c) => {
      if (categoryFilter !== 'all' && c.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        c.title.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.hashtags.some((h) => h.toLowerCase().includes(q))
      );
    });
  }, [clips, search, categoryFilter]);

  const activeClip =
    filtered.find((c) => c.id === selectedClipId) ?? filtered[0] ?? null;

  return (
    <div className="space-y-6">
      {/* Filter Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clips, titles, or #hashtags..."
            aria-label="Search AI clips"
            className="w-full rounded-lg bg-[#11151C] border border-white/10 pl-9 pr-3.5 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-[#11151C] border border-white/8">
          {['all', 'viral', 'funny', 'reaction', 'insight', 'livestream', 'manual'].map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors whitespace-nowrap ${
                categoryFilter === cat
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-[#11151C] border border-white/8 rounded-xl p-12 text-center">
          <p className="text-sm text-slate-400">
            No clips match this filter yet. Upload a video, test the sample podcast, or capture a live stream to generate clips.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Clips List */}
          <div className="xl:col-span-7 space-y-4">
            {filtered.map((clip) => {
              const isSelected = activeClip?.id === clip.id;
              return (
                <div
                  key={clip.id}
                  className={`bg-[#11151C] border rounded-xl p-5 transition-colors ${
                    isSelected ? 'border-blue-500/60' : 'border-white/8'
                  }`}
                >
                  <div className="flex items-start gap-4 justify-between">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-400 tabular-nums">
                        <span className="text-amber-400 font-semibold">
                          Score {clip.score}/100
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="capitalize">{clip.category}</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatDuration(clip.duration)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{clip.resolution}</span>
                      </div>

                      <h3 className="text-base font-semibold text-white">{clip.title}</h3>
                      <p className="text-xs text-slate-300 leading-relaxed">{clip.reason}</p>
                      {clip.description && (
                        <p className="text-xs text-slate-400">{clip.description}</p>
                      )}
                      {clip.hashtags.length > 0 && (
                        <p className="text-xs font-mono text-blue-400">
                          {clip.hashtags.join(' ')}
                        </p>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => onDeleteClip(clip.id)}
                      aria-label={`Delete ${clip.title}`}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 shrink-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="mt-4 pt-3 border-t border-white/6 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedClipId(clip.id)}
                      className="px-3 py-1.5 rounded-lg bg-white/8 hover:bg-white/12 text-xs font-medium text-white whitespace-nowrap"
                    >
                      Preview
                    </button>

                    <button
                      type="button"
                      onClick={() => onEditClip(clip.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/15 hover:bg-blue-600/25 text-xs font-medium text-blue-400 whitespace-nowrap"
                    >
                      <Sliders className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Video Editor</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onCaptionClip(clip.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/8 hover:bg-white/12 text-xs font-medium text-slate-200 whitespace-nowrap"
                    >
                      <Captions className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Captions</span>
                    </button>

                    <button
                      type="button"
                      disabled={busyId === clip.id}
                      onClick={async () => {
                        setBusyId(clip.id);
                        try {
                          await onRegenerateMetadata(clip.id);
                        } finally {
                          setBusyId(null);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/6 hover:bg-white/10 text-xs font-medium text-slate-300 whitespace-nowrap disabled:opacity-50"
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>AI Title & Tags</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const txt = `${clip.title}\n\n${clip.description}\n\n${clip.hashtags.join(' ')}`;
                        void navigator.clipboard.writeText(txt);
                        onNotify('Copied title, description, and hashtags.');
                      }}
                      aria-label={`Copy metadata for ${clip.title}`}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/8"
                    >
                      <Copy className="h-4 w-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => onExportClip(clip.id)}
                      className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white whitespace-nowrap"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Export MP4</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Sticky 9:16 Inspector Preview */}
          {activeClip && (
            <div className="xl:col-span-5 bg-[#11151C] border border-white/8 rounded-xl p-6 space-y-4 xl:sticky xl:top-6">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-semibold text-white truncate">
                  {activeClip.title}
                </h3>
                <span className="font-mono text-xs text-slate-400 tabular-nums">
                  {activeClip.resolution}
                </span>
              </div>

              <VideoPlayer916
                src={activeClip.previewPath}
                poster={activeClip.thumbnailPath}
                subtitleConfig={activeClip.subtitleConfig}
                transcript={activeClip.transcript}
              />

              <div className="flex items-center justify-between pt-2 text-xs text-slate-400">
                <span>Crop: {activeClip.cropMode.replace('_', ' ')}</span>
                <a
                  href={`/api/clips/${activeClip.id}/srt`}
                  download={`${activeClip.id}.srt`}
                  className="text-blue-400 hover:text-blue-300 font-medium"
                >
                  Download .SRT
                </a>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
