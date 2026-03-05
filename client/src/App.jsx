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
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const WatchlistPage = lazy(() => import('./components/watchlist/WatchlistPage'));
const EarningsPage = lazy(() => import('./components/earnings/EarningsPage'));
const PreMarketCommandCenter = lazy(() => import('./pages/PreMarketCommandCenter'));
const NewsScannerV2 = lazy(() => import('./pages/NewsScannerV2'));
const AdvancedScreenerPage = lazy(() => import('./pages/AdvancedScreenerPage'));
const ScreenerV3FMP = lazy(() => import('./pages/ScreenerV3FMP'));
const InstitutionalScreener = lazy(() => import('./pages/InstitutionalScreener'));
const MarketOverviewPage = lazy(() => import('./pages/MarketOverviewPage'));
const MarketHoursPage = lazy(() => import('./pages/MarketHoursPage'));
const ResearchPage = lazy(() => import('./pages/ResearchPage'));
const OpenMarketRadar = lazy(() => import('./pages/OpenMarketRadar'));
const PostMarketReview = lazy(() => import('./pages/PostMarketReview'));
const Charts = lazy(() => import('./pages/Charts'));
const LiveCockpit = lazy(() => import('./pages/LiveCockpit'));
const IntelligencePage = lazy(() => import('./pages/IntelligencePage'));
const IntelligenceFrameworkPage = lazy(() => import('./pages/IntelligenceFrameworkPage'));

export default function App() {
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
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/screeners" element={<Navigate to="/screener" replace />} />
                  <Route path="/watchlists" element={<WatchlistPage />} />
                  <Route path="/pre-market-command" element={<PreMarketCommandCenter />} />
                  <Route path="/open-market-radar" element={<OpenMarketRadar />} />
                  <Route path="/post-market-review" element={<PostMarketReview />} />
                  <Route path="/pre-market" element={<Navigate to="/pre-market-command" replace />} />
                  <Route path="/open-market" element={<Navigate to="/open-market-radar" replace />} />
                  <Route path="/post-market" element={<Navigate to="/post-market-review" replace />} />
                  <Route path="/market-overview" element={<MarketOverviewPage />} />
                  <Route path="/market-hours" element={<MarketHoursPage />} />
                  <Route path="/screener" element={<InstitutionalScreener />} />
                  <Route path="/screener-v2" element={<Navigate to="/screener" replace />} />
                  <Route path="/screener-v3" element={<Navigate to="/screener" replace />} />
                  <Route path="/screener-v3-fmp" element={<ScreenerV3FMP />} />
                  <Route path="/advanced-screener" element={<AdvancedScreenerPage />} />
                  <Route path="/news-scanner" element={<NewsScannerV2 />} />
                  <Route path="/news-v2" element={<NewsScannerV2 />} />
                  <Route path="/earnings" element={<EarningsPage />} />
                  <Route path="/research" element={<ResearchPage />} />
                  <Route path="/charts" element={<SymbolDataProvider><Charts /></SymbolDataProvider>} />
                  <Route path="/live" element={<LiveCockpit />} />
                  <Route path="/intelligence" element={<Navigate to="/open-market-radar" replace />} />
                  <Route path="/intelligence-engine" element={<Navigate to="/open-market-radar" replace />} />
                  <Route path="/intelligence-inbox" element={<IntelligencePage />} />
                  <Route path="/intelligence-framework" element={<IntelligenceFrameworkPage />} />
                  <Route path="/expected-move" element={<Navigate to="/post-market-review" replace />} />
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
