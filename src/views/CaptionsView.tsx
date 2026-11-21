import { Download, Plus, Save, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { synthesizeWordTimings } from '../../shared/subtitles';
import type {
  HighlightClip,
  LanguageCode,
  SubtitleConfig,
  SubtitlePosition,
  SubtitleStylePreset,
  TranscriptSegment,
} from '../../shared/types';
import { VideoPlayer916 } from '../components/VideoPlayer916';

interface CaptionsViewProps {
  clips: HighlightClip[];
  selectedClipId: string | null;
  onSelectClip: (clipId: string) => void;
  onSaveClip: (clipId: string, patch: Partial<HighlightClip>) => Promise<void>;
  onRenderPreview: (clipId: string) => Promise<void>;
  onCorrectCaptions: (clipId: string, language: LanguageCode) => Promise<TranscriptSegment[]>;
  onExportClip: (clipId: string) => Promise<void>;
}

const STYLE_PRESETS: Array<{ id: SubtitleStylePreset; label: string }> = [
  { id: 'viral_pop', label: 'Viral Pop' },
  { id: 'clean_minimal', label: 'Clean Box' },
  { id: 'karaoke_glow', label: 'Karaoke Glow' },
  { id: 'editorial_classic', label: 'Editorial' },
];

export function CaptionsView({
  clips,
  selectedClipId,
  onSelectClip,
  onSaveClip,
  onRenderPreview,
  onCorrectCaptions,
  onExportClip,
}: CaptionsViewProps) {
  const activeClip = clips.find((c) => c.id === selectedClipId) ?? clips[0] ?? null;
  const [config, setConfig] = useState<SubtitleConfig | null>(activeClip?.subtitleConfig ?? null);
  const [segments, setSegments] = useState<TranscriptSegment[]>(activeClip?.transcript ?? []);
  const [saving, setSaving] = useState(false);
  const [correcting, setCorrecting] = useState(false);

  useEffect(() => {
    if (activeClip) {
      setConfig(activeClip.subtitleConfig);
      setSegments(activeClip.transcript);
    }
  }, [activeClip?.id, activeClip?.transcript, activeClip?.subtitleConfig]);

  if (!activeClip || !config) {
    return (
      <div className="bg-[#11151C] border border-white/8 rounded-xl p-12 text-center">
        <p className="text-sm text-slate-400">
          Generate or upload a clip first to edit multi-language captions and export burned-in subtitles.
        </p>
      </div>
    );
  }

  const updateCueText = (idx: number, nextText: string) => {
    setSegments((prev) =>
      prev.map((seg, i) => {
        if (i !== idx) return seg;
        const updated: TranscriptSegment = { ...seg, text: nextText, words: [] };
        updated.words = synthesizeWordTimings(updated);
        return updated;
      })
    );
  };

  const addCue = () => {
    const lastEnd = segments.length > 0 ? segments[segments.length - 1].end : 0;
    const start = Math.min(Math.max(0, activeClip.duration - 2), lastEnd);
    const end = Math.min(activeClip.duration, start + 2.5);
    const newSeg: TranscriptSegment = {
      id: `seg_${Date.now()}`,
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
      text: 'New caption line',
      words: [],
    };
    newSeg.words = synthesizeWordTimings(newSeg);
    setSegments((prev) => [...prev, newSeg]);
  };

  const handleSaveAndRender = async () => {
    setSaving(true);
    try {
      await onSaveClip(activeClip.id, { subtitleConfig: config, transcript: segments });
      await onRenderPreview(activeClip.id);
    } finally {
      setSaving(false);
    }
  };

  const handleAiCorrect = async () => {
    setCorrecting(true);
    try {
      await onSaveClip(activeClip.id, { subtitleConfig: config, transcript: segments });
      const fixed = await onCorrectCaptions(activeClip.id, config.language);
      setSegments(fixed);
    } finally {
      setCorrecting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* Controls & Transcript Editor */}
      <div className="xl:col-span-7 space-y-6">
        <div className="bg-[#11151C] border border-white/8 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <label htmlFor="caption-clip-select" className="block text-xs text-slate-400 mb-1">
              Active Clip
            </label>
            <select
              id="caption-clip-select"
              value={activeClip.id}
              onChange={(e) => onSelectClip(e.target.value)}
              className="w-full rounded-lg bg-[#090B0F] border border-white/10 px-3 py-2 text-sm text-white"
            >
              {clips.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} ({c.duration.toFixed(0)}s)
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <a
              href={`/api/clips/${activeClip.id}/srt`}
              download={`${activeClip.id}.srt`}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/8 hover:bg-white/12 text-xs font-medium text-white whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Download SRT</span>
            </a>

            <button
              type="button"
              onClick={handleSaveAndRender}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white whitespace-nowrap disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{saving ? 'Burning Captions...' : 'Save & Burn Preview'}</span>
            </button>
          </div>
        </div>

        {/* Subtitle Styling */}
        <div className="bg-[#11151C] border border-white/8 rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-white">
              Animated Subtitle Styling
            </h2>
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={config.wordByWord}
                onChange={(e) => setConfig({ ...config, wordByWord: e.target.checked })}
                className="accent-blue-600"
              />
              <span>Word-by-Word Highlight</span>
            </label>
          </div>

          <div>
            <span className="block text-xs font-medium text-slate-300 mb-1.5">Style Preset</span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-1 rounded-lg bg-[#090B0F] border border-white/8">
              {STYLE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setConfig({ ...config, stylePreset: preset.id })}
                  className={`py-2 px-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    config.stylePreset === preset.id
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="cap-lang" className="block text-xs font-medium text-slate-300 mb-1.5">
                Caption Language
              </label>
              <select
                id="cap-lang"
                value={config.language}
                onChange={(e) => setConfig({ ...config, language: e.target.value as LanguageCode })}
                className="w-full rounded-lg bg-[#090B0F] border border-white/10 px-3 py-2 text-sm text-white"
              >
                <option value="en">English</option>
                <option value="hi">Hindi (हिन्दी)</option>
                <option value="bn">Bengali (বাংলা)</option>
              </select>
            </div>

            <div>
              <label htmlFor="cap-font" className="block text-xs font-medium text-slate-300 mb-1.5">
                Font Family
              </label>
              <select
                id="cap-font"
                value={config.fontFamily}
                onChange={(e) => setConfig({ ...config, fontFamily: e.target.value })}
                className="w-full rounded-lg bg-[#090B0F] border border-white/10 px-3 py-2 text-sm text-white"
              >
                <option value="DejaVu Sans">DejaVu Sans</option>
                <option value="Liberation Sans">Liberation Sans</option>
                <option value="JetBrains Mono">JetBrains Mono</option>
                <option value="Noto Sans">Noto Sans</option>
                <option value="Noto Sans Devanagari">Noto Sans Devanagari (Hindi)</option>
                <option value="Noto Sans Bengali">Noto Sans Bengali (Bengali)</option>
              </select>
            </div>

            <div>
              <label htmlFor="cap-pos" className="block text-xs font-medium text-slate-300 mb-1.5">
                Position
              </label>
              <select
                id="cap-pos"
                value={config.position}
                onChange={(e) =>
                  setConfig({ ...config, position: e.target.value as SubtitlePosition })
                }
                className="w-full rounded-lg bg-[#090B0F] border border-white/10 px-3 py-2 text-sm text-white"
              >
                <option value="top">Top</option>
                <option value="middle">Middle</option>
                <option value="bottom">Bottom</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
            <div>
              <label htmlFor="cap-size" className="block text-xs font-medium text-slate-300 mb-1.5">
                Font Size ({config.fontSize}px)
              </label>
              <input
                id="cap-size"
                type="range"
                min={24}
                max={64}
                value={config.fontSize}
                onChange={(e) => setConfig({ ...config, fontSize: Number(e.target.value) })}
                className="w-full accent-blue-500"
              />
            </div>

            <div className="flex items-center gap-3">
              <label htmlFor="cap-primary" className="text-xs font-medium text-slate-300">
                Base Color
              </label>
              <input
                id="cap-primary"
                type="color"
                value={config.primaryColor}
                onChange={(e) => setConfig({ ...config, primaryColor: e.target.value })}
                className="h-9 w-12 rounded bg-transparent cursor-pointer"
              />
            </div>

            <div className="flex items-center gap-3">
              <label htmlFor="cap-highlight" className="text-xs font-medium text-slate-300">
                Highlight
              </label>
              <input
                id="cap-highlight"
                type="color"
                value={config.highlightColor}
                onChange={(e) => setConfig({ ...config, highlightColor: e.target.value })}
                className="h-9 w-12 rounded bg-transparent cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Transcript Cue List */}
        <div className="bg-[#11151C] border border-white/8 rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-base font-semibold text-white">
              Transcript Cues ({segments.length})
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAiCorrect}
                disabled={correcting || segments.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/8 hover:bg-white/12 text-xs font-medium text-slate-100 disabled:opacity-40 whitespace-nowrap"
              >
                <Sparkles className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                <span>{correcting ? 'Correcting...' : 'AI Caption Correction'}</span>
              </button>

              <button
                type="button"
                onClick={addCue}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/15 hover:bg-blue-600/25 text-xs font-medium text-blue-400 whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Add Cue</span>
              </button>
            </div>
          </div>

          {segments.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">
              No transcript segments yet. Click Add Cue or run AI analysis to generate speech captions.
            </p>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              {segments.map((seg, idx) => (
                <div
                  key={seg.id}
                  className="rounded-lg bg-[#090B0F] border border-white/8 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2 text-xs font-mono text-slate-400">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        step="0.1"
                        min={0}
                        value={seg.start}
                        aria-label={`Cue ${idx + 1} start seconds`}
                        onChange={(e) => {
                          const v = Number(e.target.value) || 0;
                          setSegments((prev) =>
                            prev.map((s, i) => (i === idx ? { ...s, start: v } : s))
                          );
                        }}
                        className="w-16 rounded bg-white/5 px-2 py-1 text-white"
                      />
                      <span>→</span>
                      <input
                        type="number"
                        step="0.1"
                        min={0.2}
                        value={seg.end}
                        aria-label={`Cue ${idx + 1} end seconds`}
                        onChange={(e) => {
                          const v = Number(e.target.value) || 0.5;
                          setSegments((prev) =>
                            prev.map((s, i) => (i === idx ? { ...s, end: v } : s))
                          );
                        }}
                        className="w-16 rounded bg-white/5 px-2 py-1 text-white"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setSegments((prev) => prev.filter((_, i) => i !== idx))}
                      aria-label={`Remove cue ${idx + 1}`}
                      className="p-1 text-slate-500 hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    value={seg.text}
                    aria-label={`Cue ${idx + 1} caption text`}
                    onChange={(e) => updateCueText(idx, e.target.value)}
                    className="w-full rounded bg-white/5 border border-white/8 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Live Preview Panel */}
      <div className="xl:col-span-5 bg-[#11151C] border border-white/8 rounded-xl p-6 space-y-5 xl:sticky xl:top-6">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-sm font-semibold text-white">
            Live Word-by-Word Preview
          </h3>
          <span className="font-mono text-xs text-slate-400">
            {config.language.toUpperCase()}
          </span>
        </div>

        <VideoPlayer916
          src={activeClip.previewPath}
          poster={activeClip.thumbnailPath}
          subtitleConfig={config}
          transcript={segments}
        />

        <button
          type="button"
          onClick={async () => {
            await onSaveClip(activeClip.id, { subtitleConfig: config, transcript: segments });
            await onExportClip(activeClip.id);
          }}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium text-white transition-colors"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          <span>Export MP4 with Burned-In Captions</span>
        </button>
      </div>
    </div>
  );
}
