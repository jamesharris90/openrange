import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { SymbolDataProvider } from './context/symbol/SymbolDataContext';
import ErrorBoundary from './components/shared/ErrorBoundary';
import AppShell from './components/layout/AppShell';
import ProtectedRoute from './components/auth/ProtectedRoute';
import PublicRoute from './components/auth/PublicRoute';
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const WatchlistPage = lazy(() => import('./components/watchlist/WatchlistPage'));
const EarningsPage = lazy(() => import('./components/earnings/EarningsPage'));
const PreMarketPage = lazy(() => import('./pages/PreMarketPage'));
const NewsScannerV2 = lazy(() => import('./pages/NewsScannerV2'));
const AdvancedScreenerPage = lazy(() => import('./pages/AdvancedScreenerPage'));
const ScreenerV2 = lazy(() => import('./pages/ScreenerV2'));
const ScreenerV3 = lazy(() => import('./pages/ScreenerV3'));
const ScreenerV3FMP = lazy(() => import('./pages/ScreenerV3FMP'));
const ScreenersPage = lazy(() => import('./pages/ScreenersPage'));
const MarketOverviewPage = lazy(() => import('./pages/MarketOverviewPage'));
const MarketHoursPage = lazy(() => import('./pages/MarketHoursPage'));
const ResearchPage = lazy(() => import('./pages/ResearchPage'));
const OpenMarketPage = lazy(() => import('./pages/OpenMarketPage'));
const PostMarketPage = lazy(() => import('./pages/PostMarketPage'));
const Charts = lazy(() => import('./pages/Charts'));
const AIQuantPage = lazy(() => import('./components/ai-quant/AIQuantPage'));
const LiveCockpit = lazy(() => import('./pages/LiveCockpit'));
const IntelligencePage = lazy(() => import('./pages/IntelligencePage'));
const ExpectedMovePage = lazy(() => import('./pages/ExpectedMovePage'));

export default function App() {
  const Dashboard = WatchlistPage;

  return (
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <Suspense fallback={<div className="page-loading">Loading…</div>}>
              <Routes>
                <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
                <Route path="/register" element={<PublicRoute><RegisterPage /></PublicRoute>} />
                <Route path="/forgot-password" element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />
                <Route path="/reset-password" element={<PublicRoute><ResetPasswordPage /></PublicRoute>} />

                <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/screeners" element={<ScreenersPage />} />
                  <Route path="/watchlists" element={<WatchlistPage />} />
                  <Route path="/pre-market" element={<PreMarketPage />} />
                  <Route path="/open-market" element={<OpenMarketPage />} />
                  <Route path="/post-market" element={<PostMarketPage />} />
                  <Route path="/market-overview" element={<MarketOverviewPage />} />
                  <Route path="/market-hours" element={<MarketHoursPage />} />
                  <Route path="/screener-v2" element={<ScreenerV2 />} />
                  <Route path="/screener-v3" element={<ScreenerV3 />} />
                  <Route path="/screener-v3-fmp" element={<ScreenerV3FMP />} />
                  <Route path="/advanced-screener" element={<AdvancedScreenerPage />} />
                  <Route path="/news-scanner" element={<NewsScannerV2 />} />
                  <Route path="/news-v2" element={<NewsScannerV2 />} />
                  <Route path="/earnings" element={<EarningsPage />} />
                  <Route path="/research" element={<ResearchPage />} />
                  <Route path="/charts" element={<SymbolDataProvider><Charts /></SymbolDataProvider>} />
                  <Route path="/live" element={<LiveCockpit />} />
                  <Route path="/intelligence-engine" element={<AIQuantPage />} />
                  <Route path="/intelligence-inbox" element={<IntelligencePage />} />
                  <Route path="/expected-move" element={<ExpectedMovePage />} />
                </Route>

                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
