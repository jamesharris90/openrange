import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import AppShell from './components/layout/AppShell';
import WatchlistPage from './components/watchlist/WatchlistPage';
import EarningsPage from './components/earnings/EarningsPage';
import GappersPage from './components/gappers/GappersPage';
import PreMarketPage from './pages/PreMarketPage';
import NewsScannerPage from './pages/NewsScannerPage';
import AdvancedScreenerPage from './pages/AdvancedScreenerPage';
import ExpectedMovePage from './pages/ExpectedMovePage';
import ScreenersPage from './pages/ScreenersPage';
import MarketOverviewPage from './pages/MarketOverviewPage';
import MarketHoursPage from './pages/MarketHoursPage';
import ResearchPage from './pages/ResearchPage';
import OpenMarketPage from './pages/OpenMarketPage';
import PostMarketPage from './pages/PostMarketPage';

const AIQuantPage = lazy(() => import('./components/ai-quant/AIQuantPage'));

export default function App() {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/premarket" element={<PreMarketPage />} />
          <Route path="/open-market" element={<OpenMarketPage />} />
          <Route path="/postmarket" element={<PostMarketPage />} />
          <Route path="/screeners" element={<ScreenersPage />} />
          <Route path="/market-overview" element={<MarketOverviewPage />} />
          <Route path="/market-hours" element={<MarketHoursPage />} />
          <Route path="/research" element={<ResearchPage />} />
          <Route path="/news-scanner" element={<NewsScannerPage />} />
          <Route path="/advanced-screener" element={<AdvancedScreenerPage />} />
          <Route path="/expected-move" element={<ExpectedMovePage />} />
          <Route path="/watchlist" element={<WatchlistPage />} />
          <Route path="/gappers" element={<GappersPage />} />
          <Route path="/earnings" element={<EarningsPage />} />
          <Route path="/ai-quant" element={<Suspense fallback={<div style={{ padding: 32, opacity: 0.5 }}>Loading Intelligence Engine…</div>}><AIQuantPage /></Suspense>} />
          <Route path="/intelligence-engine" element={<Suspense fallback={<div style={{ padding: 32, opacity: 0.5 }}>Loading Intelligence Engine…</div>}><AIQuantPage /></Suspense>} />
          <Route path="*" element={<Navigate to="/watchlist" replace />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
