import {
  Captions,
  Download,
  Film,
  LayoutDashboard,
  Radio,
  Scissors,
  Settings,
  Sliders,
  Upload,
  X,
} from 'lucide-react';
import type { SidebarTab } from '../../shared/types';

interface SidebarProps {
  activeTab: SidebarTab;
  onSelectTab: (tab: SidebarTab) => void;
  counts: {
    clips: number;
    activeJobs: number;
    exports: number;
    liveActive: boolean;
  };
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const NAV_ITEMS: Array<{
  id: SidebarTab;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'upload', label: 'Upload Video', icon: Upload },
  { id: 'livestream', label: 'Live Stream', icon: Radio },
  { id: 'clips', label: 'AI Clips', icon: Scissors },
  { id: 'captions', label: 'Auto Captions', icon: Captions },
  { id: 'editor', label: 'Video Editor', icon: Sliders },
  { id: 'exports', label: 'Export History', icon: Download },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function Sidebar({
  activeTab,
  onSelectTab,
  counts,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const navContent = (
    <div className="flex h-full flex-col bg-[#0D1017] border-r border-white/8">
      <div className="flex items-center justify-between px-5 py-5 border-b border-white/8">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
            <Film className="h-4 w-4" aria-hidden="true" />
          </div>
          <span className="font-display text-base font-bold tracking-tight text-white whitespace-nowrap">
            ClipGenius AI
          </span>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation menu"
          className="lg:hidden rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav aria-label="Studio navigation" className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          let countText = '';
          if (item.id === 'clips' && counts.clips > 0) countText = String(counts.clips);
          if (item.id === 'exports' && counts.exports > 0) countText = String(counts.exports);
          if (item.id === 'dashboard' && counts.activeJobs > 0) {
            countText = String(counts.activeJobs);
          }

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectTab(item.id);
                onCloseMobile();
              }}
              aria-current={isActive ? 'page' : undefined}
              className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap min-h-[40px] ${
                isActive
                  ? 'bg-blue-600/15 text-blue-400'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
              }`}
            >
              <span className="flex items-center gap-3 min-w-0">
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{item.label}</span>
              </span>
              {countText && (
                <span className="font-mono text-xs tabular-nums text-slate-400">{countText}</span>
              )}
              {item.id === 'livestream' && counts.liveActive && (
                <span className="font-mono text-[11px] font-medium text-red-400">LIVE</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-white/8">
        <div className="flex items-center gap-3">
          <img
            src="/src/assets/images/avatar_studio_creator_1795238535522.jpg"
            alt="Studio Creator"
            referrerPolicy="no-referrer"
            className="h-9 w-9 rounded-lg object-cover bg-slate-800 shrink-0"
          />
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-100 truncate">Creator Workspace</p>
            <p className="text-xs text-slate-500 truncate">9:16 Vertical Studio</p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block lg:w-64 lg:shrink-0">{navContent}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative w-72 max-w-[82vw] h-full z-10">{navContent}</aside>
        </div>
      )}
    </>
  );
}
