import { ArrowRight, Play, RotateCcw, Scissors, Upload } from 'lucide-react';
import type {
  ExportRecord,
  HighlightClip,
  ProcessingJob,
  SidebarTab,
  VideoRecord,
} from '../../shared/types';
import { formatBytes, formatDuration } from '../api/client';

interface DashboardViewProps {
  videos: VideoRecord[];
  clips: HighlightClip[];
  jobs: ProcessingJob[];
  exports: ExportRecord[];
  geminiConfigured: boolean;
  onNavigate: (tab: SidebarTab) => void;
  onOpenClipEditor: (clipId: string) => void;
  onResumeJob: (jobId: string) => void;
  onLoadSample: () => void;
  sampleLoading: boolean;
}

export function DashboardView({
  videos,
  clips,
  jobs,
  exports,
  geminiConfigured,
  onNavigate,
  onOpenClipEditor,
  onResumeJob,
  onLoadSample,
  sampleLoading,
}: DashboardViewProps) {
  const activeJobs = jobs.filter((j) => j.status === 'processing' || j.status === 'queued');

  const kpis = [
    { label: 'Total Videos', value: videos.length, note: 'Uploaded & captured sources' },
    { label: 'Total Clips', value: clips.length, note: '9:16 vertical highlights' },
    { label: 'Processing Jobs', value: activeJobs.length, note: 'Active FFmpeg & AI queue' },
    { label: 'Completed Exports', value: exports.length, note: 'Final MP4 + SRT renders' },
  ];

  return (
    <div className="space-y-8">
      {/* KPI Grid */}
      <section aria-label="Studio overview metrics" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="bg-[#11151C] border border-white/8 rounded-xl p-5 flex flex-col justify-between"
          >
            <p className="text-xs font-medium text-slate-400">{kpi.label}</p>
            <p className="mt-2 font-mono text-3xl font-semibold text-white tabular-nums">
              {kpi.value}
            </p>
            <p className="mt-1.5 text-xs text-slate-500">{kpi.note}</p>
          </div>
        ))}
      </section>

      {/* Primary Action Strip when workspace is empty or ready */}
      <section className="bg-[#11151C] border border-white/8 rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="max-w-2xl">
          <h2 className="font-display text-xl font-semibold text-white">
            Turn long-form videos and live broadcasts into 9:16 shorts
          </h2>
          <p className="mt-1.5 text-sm text-slate-400">
            Upload a video, test our built-in spoken podcast sample, or monitor an authorized live stream.
            {!geminiConfigured && (
              <span className="text-amber-400">
                {' '}
                Gemini API key is not configured in server secrets yet—FFmpeg clipping, captions, and sample testing work immediately, and AI analysis can be resumed once the key is set.
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onLoadSample}
            disabled={sampleLoading}
            className="px-4 py-2.5 rounded-lg bg-white/8 hover:bg-white/12 text-sm font-medium text-slate-100 transition-colors whitespace-nowrap disabled:opacity-50"
          >
            {sampleLoading ? 'Generating Sample...' : 'Test Sample Video'}
          </button>
          <button
            type="button"
            onClick={() => onNavigate('upload')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium text-white transition-colors whitespace-nowrap"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            <span>Upload Video</span>
          </button>
        </div>
      </section>

      {/* Background Job Queue */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-white">
            Background Processing Queue
          </h2>
          <button
            type="button"
            onClick={() => onNavigate('exports')}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 whitespace-nowrap"
          >
            <span>View Exports</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        {jobs.length === 0 ? (
          <div className="bg-[#11151C] border border-white/8 rounded-xl p-8 text-center">
            <p className="text-sm text-slate-400">
              No processing jobs yet. Upload a video or test the sample video to launch FFmpeg and Gemini analysis.
            </p>
          </div>
        ) : (
          <div className="bg-[#11151C] border border-white/8 rounded-xl divide-y divide-white/6">
            {jobs.slice(0, 6).map((job) => (
              <div
                key={job.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-white">
                    <span className="truncate">{job.title}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span className="capitalize">
                      {job.status === 'processing'
                        ? `Running (${job.stage.replace('_', ' ')})`
                        : job.status}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">{job.progress}%</span>
                    {job.errorMessage && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-red-400">{job.errorMessage}</span>
                      </>
                    )}
                  </div>
                  {(job.status === 'processing' || job.status === 'queued') && (
                    <div className="mt-2 h-1.5 w-full max-w-md rounded-full bg-white/8 overflow-hidden">
                      <div
                        className="h-full bg-blue-500 transition-all duration-300"
                        style={{ width: `${job.progress}%` }}
                      />
                    </div>
                  )}
                </div>

                {job.status === 'failed' && job.canResume && (
                  <button
                    type="button"
                    onClick={() => onResumeJob(job.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-xs font-medium text-amber-300 transition-colors shrink-0 whitespace-nowrap"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Resume Job</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent Clips */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-white">Recent AI Clips</h2>
          <button
            type="button"
            onClick={() => onNavigate('clips')}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 whitespace-nowrap"
          >
            <span>All Clips</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        {clips.length === 0 ? (
          <div className="bg-[#11151C] border border-white/8 rounded-xl p-8 text-center">
            <p className="text-sm text-slate-400">
              Generated 9:16 vertical clips will appear here once processing completes.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {clips.slice(0, 6).map((clip) => (
              <div
                key={clip.id}
                className="bg-[#11151C] border border-white/8 rounded-xl p-4 flex gap-4"
              >
                <div className="relative w-20 aspect-[9/16] rounded-lg overflow-hidden bg-black shrink-0 border border-white/8">
                  {clip.thumbnailPath ? (
                    <img
                      src={clip.thumbnailPath}
                      alt={clip.title}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-slate-600">
                      <Scissors className="h-5 w-5" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-400 font-mono tabular-nums">
                      <span className="text-amber-400 font-semibold">Score {clip.score}/100</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatDuration(clip.duration)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{clip.resolution}</span>
                    </div>
                    <h3 className="mt-1 text-sm font-semibold text-white line-clamp-2">
                      {clip.title}
                    </h3>
                    <p className="mt-1 text-xs text-slate-400 line-clamp-2">{clip.reason}</p>
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenClipEditor(clip.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600/15 hover:bg-blue-600/25 text-xs font-medium text-blue-400 transition-colors whitespace-nowrap"
                    >
                      <Play className="h-3 w-3" aria-hidden="true" />
                      <span>Open in Studio</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent Source Videos Summary */}
      {videos.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-base font-semibold text-white">Source Video Library</h2>
          <div className="bg-[#11151C] border border-white/8 rounded-xl divide-y divide-white/6">
            {videos.slice(0, 5).map((vid) => (
              <div
                key={vid.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">{vid.title}</p>
                  <p className="mt-0.5 text-xs text-slate-400 font-mono tabular-nums">
                    {formatDuration(vid.duration)} · {vid.width}×{vid.height} ·{' '}
                    {formatBytes(vid.sizeBytes)} · {vid.language.toUpperCase()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('upload')}
                  className="px-3 py-1.5 rounded-lg bg-white/6 hover:bg-white/10 text-xs font-medium text-slate-200 whitespace-nowrap self-start sm:self-center"
                >
                  Manage & Clip
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
