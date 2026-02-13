import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import AppShell from './components/layout/AppShell';
import WatchlistPage from './components/watchlist/WatchlistPage';
import EarningsPage from './components/earnings/EarningsPage';

const AIQuantPage = lazy(() => import('./components/ai-quant/AIQuantPage'));

export default function App() {
  return (
    <BrowserRouter basename="/app">
      <AppShell>
        <Routes>
          <Route path="/watchlist" element={<WatchlistPage />} />
          <Route path="/earnings" element={<EarningsPage />} />
          <Route path="/ai-quant" element={<Suspense fallback={<div style={{ padding: 32, opacity: 0.5 }}>Loading Intelligence Engine…</div>}><AIQuantPage /></Suspense>} />
          <Route path="*" element={<Navigate to="/watchlist" replace />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
