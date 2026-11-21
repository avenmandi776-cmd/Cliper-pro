import { Radio, Scissors, Square } from 'lucide-react';
import { useState } from 'react';
import type {
  ClipDurationOption,
  LanguageCode,
  LiveStreamSession,
} from '../../shared/types';
import { formatDuration } from '../api/client';

interface LiveStreamViewProps {
  sessions: LiveStreamSession[];
  defaultLanguage: LanguageCode;
  onStartStream: (opts: {
    sourceUrl: string;
    relayHlsUrl?: string;
    authorizedConfirmed: boolean;
    language: LanguageCode;
    clipDuration: ClipDurationOption;
    autoClipThreshold: number;
  }) => Promise<void>;
  onStopStream: (sessionId: string) => Promise<void>;
  onManualClip: (sessionId: string, duration: ClipDurationOption) => Promise<void>;
  onOpenClipsTab: () => void;
}

export function LiveStreamView({
  sessions,
  defaultLanguage,
  onStartStream,
  onStopStream,
  onManualClip,
  onOpenClipsTab,
}: LiveStreamViewProps) {
  const [sourceUrl, setSourceUrl] = useState('');
  const [relayHlsUrl, setRelayHlsUrl] = useState('');
  const [authorizedConfirmed, setAuthorizedConfirmed] = useState(false);
  const [language, setLanguage] = useState<LanguageCode>(defaultLanguage);
  const [clipDuration, setClipDuration] = useState<ClipDurationOption>(15);
  const [autoClipThreshold, setAutoClipThreshold] = useState(75);
  const [starting, setStarting] = useState(false);
  const [clippingDur, setClippingDur] = useState<number | null>(null);

  const activeSession = sessions.find((s) => s.status === 'monitoring') ?? sessions[0];

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    setStarting(true);
    try {
      await onStartStream({
        sourceUrl,
        relayHlsUrl: relayHlsUrl.trim() || undefined,
        authorizedConfirmed,
        language,
        clipDuration,
        autoClipThreshold,
      });
    } finally {
      setStarting(false);
    }
  };

  const handleStartDemo = async () => {
    setSourceUrl('studio://demo-live');
    setAuthorizedConfirmed(true);
    setStarting(true);
    try {
      await onStartStream({
        sourceUrl: 'studio://demo-live',
        authorizedConfirmed: true,
        language,
        clipDuration,
        autoClipThreshold,
      });
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Stream Configuration */}
        <form
          onSubmit={handleStart}
          className="lg:col-span-5 bg-[#11151C] border border-white/8 rounded-xl p-6 space-y-5"
        >
          <div>
            <h2 className="font-display text-lg font-semibold text-white">
              Authorized Live Stream Ingest
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Monitor a YouTube Live broadcast or direct authorized HLS/MP4 stream. Clips are detected continuously and can be triggered manually in one click.
            </p>
          </div>

          <div>
            <label htmlFor="live-url" className="block text-xs font-medium text-slate-300 mb-1.5">
              YouTube Live URL or Direct HLS (.m3u8) Stream
            </label>
            <input
              id="live-url"
              type="text"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=... or https://stream.example.com/live.m3u8"
              className="w-full rounded-lg bg-[#090B0F] border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label htmlFor="relay-url" className="block text-xs font-medium text-slate-300 mb-1.5">
              Companion Authorized HLS Relay URL (Optional for YouTube Live)
            </label>
            <input
              id="relay-url"
              type="text"
              value={relayHlsUrl}
              onChange={(e) => setRelayHlsUrl(e.target.value)}
              placeholder="https://your-ingest-relay.example.com/stream.m3u8"
              className="w-full rounded-lg bg-[#090B0F] border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              YouTube Live URLs fetch official metadata via YouTube oEmbed without bypassing DRM. Attach your own RTMP/HLS mirror URL to capture video segments directly.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="live-lang" className="block text-xs font-medium text-slate-300 mb-1.5">
                Language
              </label>
              <select
                id="live-lang"
                value={language}
                onChange={(e) => setLanguage(e.target.value as LanguageCode)}
                className="w-full rounded-lg bg-[#090B0F] border border-white/10 px-3 py-2.5 text-sm text-white"
              >
                <option value="en">English</option>
                <option value="hi">Hindi</option>
                <option value="bn">Bengali</option>
              </select>
            </div>

            <div>
              <label htmlFor="live-thresh" className="block text-xs font-medium text-slate-300 mb-1.5">
                Auto-Clip Score ({autoClipThreshold}+)
              </label>
              <input
                id="live-thresh"
                type="range"
                min={50}
                max={95}
                value={autoClipThreshold}
                onChange={(e) => setAutoClipThreshold(Number(e.target.value))}
                className="w-full mt-2 accent-blue-500"
              />
            </div>
          </div>

          <label className="flex items-start gap-2.5 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={authorizedConfirmed}
              onChange={(e) => setAuthorizedConfirmed(e.target.checked)}
              className="mt-0.5 rounded border-white/20 bg-[#090B0F] accent-blue-600"
            />
            <span>
              I confirm I own this stream or have explicit permission from the broadcaster to record and clip it.
            </span>
          </label>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="submit"
              disabled={starting || !sourceUrl.trim() || !authorizedConfirmed}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-sm font-medium text-white transition-colors"
            >
              <Radio className="h-4 w-4" aria-hidden="true" />
              <span>{starting ? 'Connecting...' : 'Start Stream Monitor'}</span>
            </button>

            <button
              type="button"
              onClick={handleStartDemo}
              disabled={starting}
              className="px-4 py-2.5 rounded-lg bg-white/8 hover:bg-white/12 text-sm font-medium text-slate-100 transition-colors whitespace-nowrap"
            >
              Run Demo Stream
            </button>
          </div>
        </form>

        {/* Live Monitor Viewport & Controls */}
        <div className="lg:col-span-7 bg-[#11151C] border border-white/8 rounded-xl p-6 space-y-5">
          {!activeSession ? (
            <div className="py-16 text-center space-y-3">
              <Radio className="mx-auto h-9 w-9 text-slate-600" aria-hidden="true" />
              <p className="text-sm text-slate-400">
                No active live stream monitor. Enter an authorized stream URL or click Run Demo Stream to test real-time segment capture and manual clipping.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs font-mono">
                    <span
                      className={
                        activeSession.status === 'monitoring'
                          ? 'text-red-400 font-semibold'
                          : 'text-slate-400'
                      }
                    >
                      {activeSession.status === 'monitoring'
                        ? 'MONITORING LIVE'
                        : activeSession.status.toUpperCase()}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="text-slate-400 tabular-nums">
                      Elapsed {formatDuration(activeSession.elapsedSeconds)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="text-slate-400 tabular-nums">
                      Segments {activeSession.segmentsCaptured}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="text-emerald-400 tabular-nums">
                      Clips {activeSession.autoClipsCreated}
                    </span>
                  </div>
                  <h3 className="mt-1 text-base font-semibold text-white truncate">
                    {activeSession.title}
                  </h3>
                </div>

                {activeSession.status === 'monitoring' && (
                  <button
                    type="button"
                    onClick={() => onStopStream(activeSession.id)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-xs font-medium text-red-300 whitespace-nowrap"
                  >
                    <Square className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Stop Monitor</span>
                  </button>
                )}
              </div>

              {/* Live Preview Frame */}
              <div className="aspect-video w-full rounded-xl overflow-hidden bg-black border border-white/10 flex items-center justify-center">
                {activeSession.previewSegmentPath ? (
                  <video
                    key={activeSession.previewSegmentPath}
                    src={activeSession.previewSegmentPath}
                    controls
                    autoPlay
                    muted
                    className="h-full w-full object-cover"
                  />
                ) : activeSession.youtubeMeta?.thumbnailUrl ? (
                  <img
                    src={activeSession.youtubeMeta.thumbnailUrl}
                    alt={activeSession.youtubeMeta.title}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <p className="text-xs text-slate-500">
                    Waiting for first 15s stream segment capture...
                  </p>
                )}
              </div>

              {/* Manual Clip Controls */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-slate-300">Manual Clip Now:</span>
                  {([15, 30, 45] as ClipDurationOption[]).map((dur) => (
                    <button
                      key={dur}
                      type="button"
                      disabled={clippingDur !== null}
                      onClick={async () => {
                        setClippingDur(dur);
                        try {
                          await onManualClip(activeSession.id, dur);
                        } finally {
                          setClippingDur(null);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-mono font-medium text-white whitespace-nowrap"
                    >
                      <Scissors className="h-3 w-3" aria-hidden="true" />
                      <span>{clippingDur === dur ? 'Saving...' : `Last ${dur}s`}</span>
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={onOpenClipsTab}
                  className="text-xs font-medium text-blue-400 hover:text-blue-300 whitespace-nowrap"
                >
                  View Saved Clips →
                </button>
              </div>

              {activeSession.errorMessage && (
                <p className="text-xs text-red-400">{activeSession.errorMessage}</p>
              )}

              {/* Live Segment Feed */}
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-slate-400">Live Analysis Feed</h4>
                <div className="max-h-56 overflow-y-auto divide-y divide-white/6 rounded-lg bg-[#090B0F] border border-white/6">
                  {activeSession.logs.length === 0 ? (
                    <p className="p-4 text-xs text-slate-500">
                      Capturing initial stream buffer...
                    </p>
                  ) : (
                    activeSession.logs.map((log) => (
                      <div key={log.id} className="p-3 text-xs space-y-1">
                        <div className="flex items-center justify-between font-mono text-slate-400 tabular-nums">
                          <span>
                            {formatDuration(log.startSec)} – {formatDuration(log.endSec)} · Audio{' '}
                            {log.audioPeakDb.toFixed(1)} dB
                          </span>
                          {log.highlightScore !== null && (
                            <span className="text-amber-400 font-semibold">
                              Score {log.highlightScore}/100
                              {log.autoClippedClipId ? ' · Auto-Clipped' : ''}
                            </span>
                          )}
                        </div>
                        <p className="text-slate-200">{log.transcriptSnippet}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
