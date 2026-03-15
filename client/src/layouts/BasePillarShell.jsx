import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import Header from '../components/layout/Header';
import Sidebar from '../components/layout/Sidebar';
import MobileDrawer from '../components/layout/MobileDrawer';
import TickerTape from '../components/market/TickerTape';
import { useAppStore } from '../store/useAppStore';

function inferSection(pathname) {
  if (pathname.startsWith('/market')) return 'Market Context';
  if (pathname.startsWith('/discovery')) return 'Discovery';
  if (pathname.startsWith('/beacon')) return 'Beacon Intelligence';
  if (pathname.startsWith('/trading')) return 'Trading Workspace';
  if (pathname.startsWith('/learning')) return 'Strategy Learning';
  if (pathname.startsWith('/system')) return 'System Control';
  return 'OpenRange';
}

export default function BasePillarShell({ title, subtitle, children }) {
  const location = useLocation();
  const queryClient = useQueryClient();
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);

  const heading = useMemo(() => title || inferSection(location.pathname), [title, location.pathname]);
  const subheading = subtitle || 'Workflow-driven trading intelligence';

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <Header />
      <TickerTape />
      <div className="pt-16">
        <div className="flex">
          <Sidebar />
          <MobileDrawer />
          <main
            className={`min-w-0 flex-1 transition-[margin,padding] duration-300 ease-in-out ${
              sidebarCollapsed ? 'md:ml-16' : 'md:ml-60'
            } p-3 sm:p-4 md:p-6`}
          >
            <section className="mb-4 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h1 className="text-lg font-semibold text-slate-100">{heading}</h1>
                  <p className="text-sm text-slate-400">{subheading}</p>
                </div>
                <span className="text-[11px] uppercase tracking-wider text-slate-500">
                  Query Cache: {queryClient ? 'Connected' : 'Unavailable'}
                </span>
              </div>
            </section>
            <div className="w-full max-w-full">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
