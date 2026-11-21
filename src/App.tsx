import { Menu, Upload } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { SidebarTab, StudioStateResponse } from '../shared/types';
import { api } from './api/client';
import { Sidebar } from './components/Sidebar';
import { CaptionsView } from './views/CaptionsView';
import { ClipsView } from './views/ClipsView';
import { DashboardView } from './views/DashboardView';
import { EditorView } from './views/EditorView';
import { ExportsView } from './views/ExportsView';
import { LiveStreamView } from './views/LiveStreamView';
import { SettingsView } from './views/SettingsView';
import { UploadView } from './views/UploadView';

const TAB_TITLES: Record<SidebarTab, string> = {
  dashboard: 'Dashboard',
  upload: 'Upload Video',
  livestream: 'Live Stream Clipping',
  clips: 'AI Clips',
  captions: 'Auto Captions',
  editor: 'Video Editor',
  exports: 'Export History',
  settings: 'Settings',
};

export default function App() {
  const [state, setState] = useState<StudioStateResponse | null>(null);
  const [activeTab, setActiveTab] = useState<SidebarTab>('dashboard');
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [sampleLoading, setSampleLoading] = useState(false);

  const showNotice = useCallback((text: string, kind: 'info' | 'error' = 'info') => {
    setNotice({ kind, text });
  }, []);

  const refreshState = useCallback(async () => {
    try {
      const next = await api.getState();
      setState(next);
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'Failed to load studio state.', 'error');
    }
  }, [showNotice]);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  // Poll every 2.5s while background jobs or live streams are active
  useEffect(() => {
    if (!state) return;
    const hasActiveJob = state.jobs.some(
      (j) => j.status === 'processing' || j.status === 'queued'
    );
    const hasActiveLive = state.liveSessions.some((s) => s.status === 'monitoring');
    if (!hasActiveJob && !hasActiveLive) return;

    const timer = setInterval(() => {
      void refreshState();
    }, 2500);
    return () => clearInterval(timer);
  }, [state, refreshState]);

  const handleLoadSampleQuick = async () => {
    if (!state) return;
    setSampleLoading(true);
    try {
      const res = await api.loadSampleVideo({
        clipDuration: 15,
        language: state.settings.defaultLanguage,
        resolution: state.settings.defaultResolution,
        cropMode: state.settings.autoReframeDefault,
        autoAnalyze: state.capabilities.geminiConfigured,
      });
      await refreshState();
      if (res.job) {
        showNotice('Sample video loaded. Gemini AI highlight analysis started.');
      } else {
        showNotice(
          'Sample video loaded in Upload Video. Cut a manual 9:16 clip or configure GEMINI_API_KEY for AI highlight detection.'
        );
      }
      setActiveTab('upload');
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'Failed to load sample.', 'error');
    } finally {
      setSampleLoading(false);
    }
  };

  if (!state) {
    return (
      <div className="min-h-screen bg-[#090B0F] flex items-center justify-center text-sm text-slate-400">
        Loading ClipGenius AI Studio...
      </div>
    );
  }

  const activeJobsCount = state.jobs.filter(
    (j) => j.status === 'processing' || j.status === 'queued'
  ).length;
  const liveActive = state.liveSessions.some((s) => s.status === 'monitoring');

  return (
    <div className="min-h-screen bg-[#090B0F] text-slate-100 flex">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        counts={{
          clips: state.clips.length,
          activeJobs: activeJobsCount,
          exports: state.exports.length,
          liveActive,
        }}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Clean Single-Row Studio Header */}
        <header className="sticky top-0 z-30 bg-[#090B0F]/95 backdrop-blur border-b border-white/8 px-4 sm:px-8 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 rounded-lg bg-white/6 text-slate-200 hover:bg-white/10"
            >
              <Menu className="h-4 w-4" />
            </button>
            <h1 className="font-display text-base sm:text-lg font-semibold text-white truncate">
              {TAB_TITLES[activeTab]}
            </h1>
          </div>

          <button
            type="button"
            onClick={() => setActiveTab('upload')}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white transition-colors whitespace-nowrap shrink-0"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            <span>New Video</span>
          </button>
        </header>

        {/* Actionable Notification / Error Banner */}
        {notice && (
          <div
            role={notice.kind === 'error' ? 'alert' : 'status'}
            className={`mx-4 sm:mx-8 mt-4 rounded-lg border px-4 py-3 text-xs flex items-center justify-between gap-4 ${
              notice.kind === 'error'
                ? 'bg-red-500/10 border-red-500/30 text-red-200'
                : 'bg-blue-500/10 border-blue-500/30 text-blue-200'
            }`}
          >
            <span>{notice.text}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="text-xs underline underline-offset-2 shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        <main className="flex-1 p-4 sm:p-8 max-w-[1440px] w-full mx-auto">
          {activeTab === 'dashboard' && (
            <DashboardView
              videos={state.videos}
              clips={state.clips}
              jobs={state.jobs}
              exports={state.exports}
              geminiConfigured={state.capabilities.geminiConfigured}
              onNavigate={setActiveTab}
              onOpenClipEditor={(clipId) => {
                setSelectedClipId(clipId);
                setActiveTab('editor');
              }}
              onResumeJob={async (jobId) => {
                try {
                  await api.resumeJob(jobId);
                  await refreshState();
                  showNotice('Job resumed and queued.');
                } catch (err) {
                  showNotice(err instanceof Error ? err.message : 'Resume failed.', 'error');
                }
              }}
              onLoadSample={handleLoadSampleQuick}
              sampleLoading={sampleLoading}
            />
          )}

          {activeTab === 'upload' && (
            <UploadView
              videos={state.videos}
              defaultDuration={state.settings.defaultClipDuration}
              defaultLanguage={state.settings.defaultLanguage}
              defaultResolution={state.settings.defaultResolution}
              defaultCropMode={state.settings.autoReframeDefault}
              geminiConfigured={state.capabilities.geminiConfigured}
              onUpload={async (fd) => {
                try {
                  await api.uploadVideo(fd);
                  await refreshState();
                  showNotice('Video uploaded and queued for AI analysis.');
                } catch (err) {
                  showNotice(err instanceof Error ? err.message : 'Upload failed.', 'error');
                }
              }}
              onLoadSample={async (opts) => {
                try {
                  const res = await api.loadSampleVideo(opts);
                  await refreshState();
                  showNotice(
                    res.job
                      ? 'Sample podcast video generated and queued for Gemini highlight analysis.'
                      : 'Sample podcast video generated! You can cut a 9:16 clip immediately or run AI highlights once GEMINI_API_KEY is configured.'
                  );
                } catch (err) {
                  showNotice(err instanceof Error ? err.message : 'Sample failed.', 'error');
                }
              }}
              onAnalyzeVideo={async (videoId, opts) => {
                try {
                  await api.analyzeVideo(videoId, opts);
                  await refreshState();
                  showNotice('AI highlight analysis queued.');
                } catch (err) {
                  showNotice(err instanceof Error ? err.message : 'Analysis failed.', 'error');
                }
              }}
              onCreateManualClip={async (videoId, opts) => {
                try {
                  const res = await api.createManualClip(videoId, opts);
                  await refreshState();
                  setSelectedClipId(res.clip.id);
                  showNotice('9:16 vertical clip rendered! Opening in AI Clips.');
                  setActiveTab('clips');
                } catch (err) {
                  showNotice(err instanceof Error ? err.message : 'Clip creation failed.', 'error');
                }
              }}
              onDeleteVideo={async (videoId) => {
                await api.deleteVideo(videoId);
                await refreshState();
              }}
            />
          )}

          {activeTab === 'livestream' && (
            <LiveStreamView
              sessions={state.liveSessions}
              defaultLanguage={state.settings.defaultLanguage}
              onStartStream={async (opts) => {
                try {
                  await api.startLiveStream(opts);
                  await refreshState();
                  showNotice('Live stream monitor started.');
                } catch (err) {
                  showNotice(err instanceof Error ? err.message : 'Failed to start stream.', 'error');
                }
              }}
              onStopStream={async (sessionId) => {
                try {
                  await api.stopLiveStream(sessionId);
                  await refreshState();
                  showNotice('Live stream monitor stopped.');
                } catch (err) {
                  showNotice(err instanceof Error ? err.message : 'Stop failed.', 'error');
                }
              }}
              onManualClip={async (sessionId, duration) => {
                try {
                  const res = await api.manualClipLiveStream(sessionId, duration);
                  await refreshState();
                  setSelectedClipId(res.clip.id);
                  showNotice(`Captured ${duration}s live clip and rendered 9:16 preview.`);
                } catch (err) {
                  showNotice(err instanceof Error ? err.message : 'Manual clip failed.', 'error');
                }
              }}
              onOpenClipsTab={() => setActiveTab('clips')}
            />
          )}

          {activeTab === 'clips' && (
            <ClipsView
              clips={state.clips}
              onEditClip={(clipId) => {
                setSelectedClipId(clipId);
                setActiveTab('editor');
              }}
              onCaptionClip={(clipId) => {
                setSelectedClipId(clipId);
                setActiveTab('captions');
              }}
              onExportClip={async (clipId) => {
                try {
                  await api.exportClip(clipId);
                  await refreshState();
                  showNotice('MP4 export job queued. Track progress in Export History.');
                  setActiveTab('exports');
                } catch (err) {
                  showNotice(err instanceof Error ? err.message : 'Export failed.', 'error');
                }
              }}
              onRegenerateMetadata={async (clipId) => {
                try {
                  await api.regenerateClipMetadata(clipId);
                  await refreshState();
                  showNotice('Updated AI viral title, description, and hashtags.');
                } catch (err) {
                  showNotice(err instanceof Error ? err.message : 'AI metadata failed.', 'error');
                }
              }}
              onDeleteClip={async (clipId) => {
                await api.deleteClip(clipId);
                await refreshState();
              }}
              onNotify={(msg) => showNotice(msg)}
            />
          )}

          {activeTab === 'captions' && (
            <CaptionsView
              clips={state.clips}
              selectedClipId={selectedClipId}
              onSelectClip={setSelectedClipId}
              onSaveClip={async (clipId, patch) => {
                await api.updateClip(clipId, patch);
                await refreshState();
              }}
              onRenderPreview={async (clipId) => {
                try {
                  await api.renderClipPreview(clipId);
                  await refreshState();
                  showNotice('Updated 9:16 preview with burned-in animated captions.');
                } catch (err) {
                  showNotice(err instanceof Error ? err.message : 'Preview render failed.', 'error');
                }
              }}
              onCorrectCaptions={async (clipId, lang) => {
                try {
                  const res = await api.correctCaptions(clipId, lang);
                  await refreshState();
                  showNotice('Gemini AI corrected caption punctuation and spelling.');
                  return res.transcript;
                } catch (err) {
                  showNotice(
                    err instanceof Error ? err.message : 'Caption correction failed.',
                    'error'
                  );
                  throw err;
                }
              }}
              onExportClip={async (clipId) => {
                await api.exportClip(clipId);
                await refreshState();
                showNotice('MP4 export queued with burned-in captions.');
                setActiveTab('exports');
              }}
            />
          )}

          {activeTab === 'editor' && (
            <EditorView
              clips={state.clips}
              videos={state.videos}
              musicTracks={state.musicTracks}
              introOutroAssets={state.introOutroAssets}
              selectedClipId={selectedClipId}
              onSelectClip={setSelectedClipId}
              onSaveClip={async (clipId, patch) => {
                await api.updateClip(clipId, patch);
                await refreshState();
              }}
              onRenderPreview={async (clipId) => {
                try {
                  await api.renderClipPreview(clipId);
                  await refreshState();
                  showNotice('Rendered updated 9:16 studio preview.');
                } catch (err) {
                  showNotice(err instanceof Error ? err.message : 'Preview render failed.', 'error');
                }
              }}
              onExportClip={async (clipId) => {
                await api.exportClip(clipId);
                await refreshState();
                showNotice('MP4 + SRT export queued.');
                setActiveTab('exports');
              }}
              onUploadMusic={async (fd) => {
                try {
                  await api.uploadMusicTrack(fd);
                  await refreshState();
                  showNotice('Added licensed background music track.');
                } catch (err) {
                  showNotice(err instanceof Error ? err.message : 'Music upload failed.', 'error');
                }
              }}
              onUploadSlate={async (fd) => {
                try {
                  await api.uploadSlateAsset(fd);
                  await refreshState();
                  showNotice('Added custom intro/outro slate.');
                } catch (err) {
                  showNotice(err instanceof Error ? err.message : 'Slate upload failed.', 'error');
                }
              }}
            />
          )}

          {activeTab === 'exports' && (
            <ExportsView
              exports={state.exports}
              jobs={state.jobs}
              onResumeJob={async (jobId) => {
                try {
                  await api.resumeJob(jobId);
                  await refreshState();
                  showNotice('Export job resumed.');
                } catch (err) {
                  showNotice(err instanceof Error ? err.message : 'Resume failed.', 'error');
                }
              }}
              onDeleteExport={async (exportId) => {
                await api.deleteExport(exportId);
                await refreshState();
              }}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              settings={state.settings}
              capabilities={state.capabilities}
              onSaveSettings={async (patch) => {
                try {
                  await api.updateSettings(patch);
                  await refreshState();
                  showNotice('Studio settings saved.');
                } catch (err) {
                  showNotice(err instanceof Error ? err.message : 'Failed to save settings.', 'error');
                }
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}
