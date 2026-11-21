import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { synthesizeWordTimings } from '../../shared/subtitles';
import type { SubtitleConfig, TranscriptSegment } from '../../shared/types';

interface VideoPlayer916Props {
  src: string;
  poster?: string;
  subtitleConfig?: SubtitleConfig;
  transcript?: TranscriptSegment[];
  showLiveOverlay?: boolean;
  className?: string;
}

export function VideoPlayer916({
  src,
  poster,
  subtitleConfig,
  transcript = [],
  showLiveOverlay = true,
  className = '',
}: VideoPlayer916Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
  }, [src]);

  const activeCue = useMemo(() => {
    if (!showLiveOverlay || !subtitleConfig?.enabled || transcript.length === 0) {
      return null;
    }
    const seg = transcript.find((s) => currentTime >= s.start && currentTime <= s.end);
    if (!seg) return null;

    const words = synthesizeWordTimings(seg);
    if (words.length === 0) return { words: [{ word: seg.text, active: true, important: false }] };

    // Group in chunks of 4 words
    const activeWordIdx = Math.max(
      0,
      words.findIndex((w) => currentTime >= w.start && currentTime <= w.end)
    );
    const chunkStart = Math.floor(activeWordIdx / 4) * 4;
    const chunk = words.slice(chunkStart, chunkStart + 4).map((w, idx) => ({
      word: subtitleConfig.stylePreset === 'viral_pop' ? w.word.toUpperCase() : w.word,
      active: subtitleConfig.wordByWord ? chunkStart + idx === activeWordIdx : false,
      important: Boolean(w.important),
    }));
    return { words: chunk };
  }, [currentTime, showLiveOverlay, subtitleConfig, transcript]);

  const togglePlay = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play();
      setPlaying(true);
    } else {
      el.pause();
      setPlaying(false);
    }
  };

  const toggleMute = () => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  };

  const positionClass =
    subtitleConfig?.position === 'top'
      ? 'top-10'
      : subtitleConfig?.position === 'middle'
        ? 'top-1/2 -translate-y-1/2'
        : 'bottom-16';

  const scaledPreviewFontSize = subtitleConfig
    ? Math.max(13, Math.min(26, Math.round(subtitleConfig.fontSize * 0.42)))
    : 18;

  return (
    <div
      className={`relative aspect-[9/16] w-full max-w-[300px] mx-auto overflow-hidden rounded-xl bg-black border border-white/10 ${className}`}
    >
      {src ? (
        <video
          ref={videoRef}
          src={src}
          poster={poster}
          playsInline
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
          onEnded={() => setPlaying(false)}
          onClick={togglePlay}
          className="h-full w-full object-cover cursor-pointer"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">
          No preview rendered yet
        </div>
      )}

      {activeCue && subtitleConfig && (
        <div
          className={`pointer-events-none absolute inset-x-4 flex justify-center text-center ${positionClass}`}
        >
          <div
            className={`px-3 py-1.5 rounded-md leading-snug ${
              subtitleConfig.stylePreset === 'clean_minimal' ? 'bg-black/75' : ''
            }`}
            style={{
              fontSize: `${scaledPreviewFontSize}px`,
              fontWeight: subtitleConfig.stylePreset === 'editorial_classic' ? 500 : 800,
              textShadow:
                subtitleConfig.stylePreset === 'clean_minimal'
                  ? 'none'
                  : '0 2px 6px rgba(0,0,0,0.95)',
            }}
          >
            {activeCue.words.map((w, i) => (
              <span
                key={`${w.word}_${i}`}
                className="inline-block mx-1 transition-transform duration-75"
                style={{
                  color: w.active
                    ? subtitleConfig.highlightColor
                    : subtitleConfig.primaryColor,
                  transform: w.active ? 'scale(1.08)' : 'scale(1)',
                  textDecoration: !w.active && w.important ? 'underline' : 'none',
                }}
              >
                {w.word}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Subtle bottom control bar */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-3 pt-6 pb-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? 'Pause preview' : 'Play preview'}
          className="p-1.5 rounded-md bg-white/10 text-white hover:bg-white/20 transition-colors"
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>

        <input
          type="range"
          min={0}
          max={Math.max(1, duration)}
          step={0.1}
          value={currentTime}
          aria-label="Seek video timeline"
          onChange={(e) => {
            const t = Number(e.target.value);
            if (videoRef.current) videoRef.current.currentTime = t;
            setCurrentTime(t);
          }}
          className="flex-1 h-1 accent-blue-500 cursor-pointer"
        />

        <span className="font-mono text-[11px] text-slate-300 tabular-nums">
          {currentTime.toFixed(0)}s
        </span>

        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? 'Unmute preview' : 'Mute preview'}
          className="p-1.5 rounded-md bg-white/10 text-white hover:bg-white/20 transition-colors"
        >
          {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}
