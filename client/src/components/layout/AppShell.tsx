import { Outlet, useLocation } from 'react-router-dom';
import { useEffect, useRef, type ReactNode } from 'react';
import Header from './Header';
import Sidebar from './Sidebar';
import MobileDrawer from './MobileDrawer';
import { useAppStore } from '../../store/useAppStore';

type AppShellProps = {
  children?: ReactNode;
};

export default function AppShell({ children }: AppShellProps) {
  const location = useLocation();
  const isLiveCockpitRoute = location.pathname === '/live';
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useAppStore((state) => state.setSidebarCollapsed);
  const previousSidebarStateRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (isLiveCockpitRoute) {
      if (previousSidebarStateRef.current === null) {
        previousSidebarStateRef.current = sidebarCollapsed;
      }
      if (!sidebarCollapsed) {
        setSidebarCollapsed(true);
      }
      return;
    }

    if (previousSidebarStateRef.current !== null) {
      setSidebarCollapsed(previousSidebarStateRef.current);
      previousSidebarStateRef.current = null;
    }
  }, [isLiveCockpitRoute, sidebarCollapsed, setSidebarCollapsed]);

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <Header />
      <div className="pt-14">
        <div className="flex">
          <Sidebar />
          <MobileDrawer />

          <main
            className={`min-w-0 flex-1 transition-[margin,padding] duration-300 ease-in-out ${
              sidebarCollapsed ? 'md:ml-16' : 'md:ml-60'
            } ${isLiveCockpitRoute ? 'p-0' : 'p-3 sm:p-4 md:p-6'}`}
          >
            <div className="w-full max-w-full">{children || <Outlet />}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
