import { memo } from 'react';
import { Menu } from 'lucide-react';

function AdminHeader({ title, subtitle, onToggleSidebar }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-800 bg-slate-950/95 px-4 backdrop-blur">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-700 text-slate-300 transition hover:bg-slate-800 lg:hidden"
          aria-label="Toggle admin sidebar"
        >
          <Menu size={18} />
        </button>
        <div>
          <h1 className="text-sm font-semibold text-slate-100 md:text-base">{title}</h1>
          {subtitle ? <p className="text-xs text-slate-400">{subtitle}</p> : null}
        </div>
      </div>
    </header>
  );
}

export default memo(AdminHeader);
