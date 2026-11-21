import { Download, FileText, RotateCcw, Trash2 } from 'lucide-react';
import type { ExportRecord, ProcessingJob } from '../../shared/types';
import { formatBytes, formatDuration } from '../api/client';

interface ExportsViewProps {
  exports: ExportRecord[];
  jobs: ProcessingJob[];
  onResumeJob: (jobId: string) => Promise<void>;
  onDeleteExport: (exportId: string) => Promise<void>;
}

export function ExportsView({
  exports,
  jobs,
  onResumeJob,
  onDeleteExport,
}: ExportsViewProps) {
  const exportJobs = jobs.filter((j) => j.type === 'export_clip' && j.status !== 'completed');

  return (
    <div className="space-y-8">
      {/* Active or Failed Export Jobs */}
      {exportJobs.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-base font-semibold text-white">
            Render Queue ({exportJobs.length})
          </h2>
          <div className="bg-[#11151C] border border-white/8 rounded-xl divide-y divide-white/6">
            {exportJobs.map((job) => (
              <div
                key={job.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white truncate">{job.title}</p>
                  <p className="mt-1 text-xs text-slate-400 font-mono tabular-nums">
                    {job.status} · {job.progress}%
                    {job.errorMessage ? ` · ${job.errorMessage}` : ''}
                  </p>
                  {job.status === 'processing' && (
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
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-xs font-medium text-amber-300 whitespace-nowrap"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Resume Render</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Completed Exports */}
      <section className="space-y-3">
        <h2 className="font-display text-base font-semibold text-white">
          Completed MP4 Exports ({exports.length})
        </h2>

        {exports.length === 0 ? (
          <div className="bg-[#11151C] border border-white/8 rounded-xl p-12 text-center">
            <p className="text-sm text-slate-400">
              No exported MP4 files yet. Export any clip from AI Clips, Auto Captions, or Video Editor to download MP4 and SRT files here.
            </p>
          </div>
        ) : (
          <div className="bg-[#11151C] border border-white/8 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/8 text-xs font-medium text-slate-400">
                    <th className="py-3.5 px-4">Clip Title</th>
                    <th className="py-3.5 px-4">Resolution</th>
                    <th className="py-3.5 px-4">Duration</th>
                    <th className="py-3.5 px-4">File Size</th>
                    <th className="py-3.5 px-4">Captions</th>
                    <th className="py-3.5 px-4 text-right">Downloads</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/6 text-sm">
                  {exports.map((exp) => (
                    <tr key={exp.id} className="hover:bg-white/[0.02]">
                      <td className="py-3.5 px-4 font-medium text-white max-w-xs truncate">
                        {exp.title}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs text-slate-300 tabular-nums">
                        {exp.resolution}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs text-slate-300 tabular-nums">
                        {formatDuration(exp.duration)}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs text-slate-300 tabular-nums">
                        {formatBytes(exp.sizeBytes)}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-300">
                        {exp.burnedCaptions ? 'Burned-in + SRT' : 'SRT only'}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center justify-end gap-2">
                          <a
                            href={`${exp.filePath}?download=1`}
                            download={`${exp.id}.mp4`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white whitespace-nowrap"
                          >
                            <Download className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>MP4</span>
                          </a>

                          {exp.srtPath && (
                            <a
                              href={`${exp.srtPath}?download=1`}
                              download={`${exp.id}.srt`}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/8 hover:bg-white/12 text-xs font-medium text-slate-200 whitespace-nowrap"
                            >
                              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>SRT</span>
                            </a>
                          )}

                          <button
                            type="button"
                            onClick={() => onDeleteExport(exp.id)}
                            aria-label={`Delete export ${exp.title}`}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
