import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  AppSettings,
  ClipDurationOption,
  CropMode,
  LanguageCode,
  ResolutionOption,
  StudioStateResponse,
} from '../../shared/types';

interface SettingsViewProps {
  settings: AppSettings;
  capabilities: StudioStateResponse['capabilities'];
  onSaveSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

export function SettingsView({
  settings,
  capabilities,
  onSaveSettings,
}: SettingsViewProps) {
  const [form, setForm] = useState<AppSettings>(settings);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSaveSettings(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <form
        onSubmit={handleSubmit}
        className="lg:col-span-7 bg-[#11151C] border border-white/8 rounded-xl p-6 space-y-6"
      >
        <div>
          <h2 className="font-display text-lg font-semibold text-white">
            AI Model & FFmpeg Performance
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Configure default Gemini model selection, FFmpeg CPU threads, and low-resource preview behavior.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="set-model" className="block text-xs font-medium text-slate-300 mb-1.5">
              Gemini Model
            </label>
            <select
              id="set-model"
              value={form.geminiModel}
              onChange={(e) => setForm({ ...form, geminiModel: e.target.value })}
              className="w-full rounded-lg bg-[#090B0F] border border-white/10 px-3 py-2.5 text-sm text-white"
            >
              <option value="gemini-4-hydrogen">gemini-4-hydrogen (Fast & Balanced)</option>
              <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Ultra Lightweight)</option>
              <option value="gemini-4-neon">gemini-4-neon (Complex Reasoning)</option>
            </select>
          </div>

          <div>
            <label htmlFor="set-threads" className="block text-xs font-medium text-slate-300 mb-1.5">
              FFmpeg Threads ({form.ffmpegThreads})
            </label>
            <input
              id="set-threads"
              type="range"
              min={1}
              max={8}
              value={form.ffmpegThreads}
              onChange={(e) => setForm({ ...form, ffmpegThreads: Number(e.target.value) })}
              className="w-full mt-2 accent-blue-500"
            />
          </div>

          <div>
            <label htmlFor="set-dur" className="block text-xs font-medium text-slate-300 mb-1.5">
              Default Clip Duration
            </label>
            <select
              id="set-dur"
              value={form.defaultClipDuration}
              onChange={(e) =>
                setForm({
                  ...form,
                  defaultClipDuration: Number(e.target.value) as ClipDurationOption,
                })
              }
              className="w-full rounded-lg bg-[#090B0F] border border-white/10 px-3 py-2.5 text-sm text-white"
            >
              <option value={15}>15 seconds</option>
              <option value={30}>30 seconds</option>
              <option value={45}>45 seconds</option>
              <option value={60}>60 seconds</option>
            </select>
          </div>

          <div>
            <label htmlFor="set-res" className="block text-xs font-medium text-slate-300 mb-1.5">
              Default 9:16 Resolution
            </label>
            <select
              id="set-res"
              value={form.defaultResolution}
              onChange={(e) =>
                setForm({ ...form, defaultResolution: e.target.value as ResolutionOption })
              }
              className="w-full rounded-lg bg-[#090B0F] border border-white/10 px-3 py-2.5 text-sm text-white"
            >
              <option value="720x1280">720 × 1280 (HD)</option>
              <option value="480x854">480 × 854 (Low-Resource)</option>
            </select>
          </div>

          <div>
            <label htmlFor="set-lang" className="block text-xs font-medium text-slate-300 mb-1.5">
              Default Language
            </label>
            <select
              id="set-lang"
              value={form.defaultLanguage}
              onChange={(e) =>
                setForm({ ...form, defaultLanguage: e.target.value as LanguageCode })
              }
              className="w-full rounded-lg bg-[#090B0F] border border-white/10 px-3 py-2.5 text-sm text-white"
            >
              <option value="en">English</option>
              <option value="hi">Hindi (हिन्दी)</option>
              <option value="bn">Bengali (বাংলা)</option>
            </select>
          </div>

          <div>
            <label htmlFor="set-crop" className="block text-xs font-medium text-slate-300 mb-1.5">
              Default Reframe Mode
            </label>
            <select
              id="set-crop"
              value={form.autoReframeDefault}
              onChange={(e) =>
                setForm({ ...form, autoReframeDefault: e.target.value as CropMode })
              }
              className="w-full rounded-lg bg-[#090B0F] border border-white/10 px-3 py-2.5 text-sm text-white"
            >
              <option value="auto_face">Auto Face / Subject</option>
              <option value="center">Center 9:16</option>
              <option value="fit_blur">Fit + Blur Backdrop</option>
            </select>
          </div>
        </div>

        <label className="flex items-center gap-2.5 text-sm text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={form.lowResourceMode}
            onChange={(e) => setForm({ ...form, lowResourceMode: e.target.checked })}
            className="accent-blue-600"
          />
          <span>
            Enable low-resource device mode (uses ultrafast FFmpeg encoding preset & lighter bitrates)
          </span>
        </label>

        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium text-white transition-colors disabled:opacity-50"
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          <span>{saving ? 'Saving...' : 'Save Studio Settings'}</span>
        </button>
      </form>

      {/* Read-Only Runtime Capabilities & Setup Guide */}
      <div className="lg:col-span-5 bg-[#11151C] border border-white/8 rounded-xl p-6 space-y-5">
        <h2 className="font-display text-base font-semibold text-white">
          Backend Runtime & Setup
        </h2>

        <dl className="space-y-3 text-xs">
          <div className="flex items-center justify-between py-2 border-b border-white/6">
            <dt className="text-slate-400">Gemini Server Integration</dt>
            <dd
              className={`font-mono font-medium ${
                capabilities.geminiConfigured ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {capabilities.geminiConfigured ? 'Configured' : 'Key Required in Secrets'}
            </dd>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-white/6">
            <dt className="text-slate-400">FFmpeg Engine</dt>
            <dd
              className={`font-mono font-medium ${
                capabilities.ffmpegAvailable ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {capabilities.ffmpegAvailable ? 'Ready' : 'Not Installed'}
            </dd>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-white/6">
            <dt className="text-slate-400">Whisper HTTP Endpoint</dt>
            <dd className="font-mono text-slate-300">
              {capabilities.whisperConfigured ? 'Custom Endpoint Active' : 'Gemini Speech Active'}
            </dd>
          </div>
        </dl>

        <div className="rounded-lg bg-[#090B0F] border border-white/6 p-4 space-y-2 text-xs text-slate-400 leading-relaxed">
          <p className="font-medium text-slate-200">Setup Instructions</p>
          <p>
            1. Configure <code className="text-slate-200">GEMINI_API_KEY</code> in the environment secrets panel (never exposed to browser JavaScript).
          </p>
          <p>
            2. Optionally configure <code className="text-slate-200">WHISPER_API_URL</code> on the server to route audio through an external Whisper-compatible endpoint.
          </p>
          <p className="text-slate-500 font-mono text-[11px] truncate">
            {capabilities.ffmpegVersion}
          </p>
        </div>
      </div>
    </div>
  );
}
