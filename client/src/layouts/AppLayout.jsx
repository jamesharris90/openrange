import { Outlet } from 'react-router-dom';
import Header from '../components/layout/Header';
import Sidebar from '../components/layout/Sidebar';
import MobileDrawer from '../components/layout/MobileDrawer';
import TickerTape from '../components/market/TickerTape';
import ErrorBoundary from '../components/ErrorBoundary';

export default function AppLayout() {
  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <Header />
      <TickerTape />
      <div className="pt-16">
        <div className="flex">
          <Sidebar />
          <MobileDrawer />
          <main className="min-w-0 flex-1 p-3 sm:p-4 md:p-6 md:ml-60">
            <div className="w-full max-w-full">
              <ErrorBoundary
                inline
                title="Page failed to load"
                description="This page encountered an error, but navigation is still available."
              >
                <Outlet />
              </ErrorBoundary>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
