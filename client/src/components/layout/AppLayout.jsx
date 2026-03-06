import { Outlet, useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import Header from './Header';
import Sidebar from './Sidebar';
import MobileDrawer from './MobileDrawer';
import TickerTape from '../market/TickerTape';
import { useAppStore } from '../../store/useAppStore';

export default function AppLayout({ children }) {
  const location = useLocation();
  const isLiveCockpitRoute = location.pathname === '/live' || location.pathname === '/cockpit';
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useAppStore((state) => state.setSidebarCollapsed);
  const previousSidebarStateRef = useRef(null);

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
      <div className="fixed inset-x-0 top-14 z-40">
        <TickerTape />
      </div>

      <div className="pt-24">
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
