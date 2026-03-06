import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { SymbolDataProvider } from './context/symbol/SymbolDataContext';
import ErrorBoundary from './components/shared/ErrorBoundary';
import AppLayout from './components/layout/AppLayout';
import SkeletonCard from './components/ui/SkeletonCard';
import ProtectedRoute from './components/auth/ProtectedRoute';
import PublicRoute from './components/auth/PublicRoute';
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const LandingPage = lazy(() => import('./pages/LandingPage'));
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
const AlertsPage = lazy(() => import('./pages/AlertsPage'));
const OpenMarketRadar = lazy(() => import('./pages/OpenMarketRadar'));
const PostMarketReview = lazy(() => import('./pages/PostMarketReview'));
const Charts = lazy(() => import('./pages/Charts'));
const LiveCockpit = lazy(() => import('./pages/LiveCockpit'));
const CockpitPage = lazy(() => import('./pages/CockpitPage'));
const IntelligenceFrameworkPage = lazy(() => import('./pages/IntelligenceFrameworkPage'));
const EarningsCalendar = lazy(() => import('./pages/EarningsCalendar'));
const ExpectedMove = lazy(() => import('./pages/ExpectedMove'));
const IntelInbox = lazy(() => import('./pages/IntelInbox'));
const IntelligenceEngine = lazy(() => import('./pages/IntelligenceEngine'));
const SectorHeatmap = lazy(() => import('./pages/SectorHeatmap'));
const ScreenerFull = lazy(() => import('./pages/ScreenerFull'));
const TradeSetup = lazy(() => import('./pages/TradeSetup'));
const MobileDashboard = lazy(() => import('./pages/MobileDashboard'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <Suspense fallback={<div className="grid gap-2 p-4 md:grid-cols-2"><SkeletonCard lines={4} /><SkeletonCard lines={4} /></div>}>
              <Routes>
                <Route path="/" element={<PublicRoute><LandingPage /></PublicRoute>} />
                <Route path="/landing" element={<PublicRoute><LandingPage /></PublicRoute>} />
                <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
                <Route path="/register" element={<PublicRoute><RegisterPage /></PublicRoute>} />
                <Route path="/forgot-password" element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />
                <Route path="/reset-password" element={<PublicRoute><ResetPasswordPage /></PublicRoute>} />

                <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/mobile-dashboard" element={<MobileDashboard />} />
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
                  <Route path="/screener-full" element={<ScreenerFull />} />
                  <Route path="/screener-v2" element={<Navigate to="/screener" replace />} />
                  <Route path="/screener-v3" element={<Navigate to="/screener" replace />} />
                  <Route path="/screener-v3-fmp" element={<ScreenerV3FMP />} />
                  <Route path="/advanced-screener" element={<AdvancedScreenerPage />} />
                  <Route path="/news-scanner" element={<NewsScannerV2 />} />
                  <Route path="/news-feed" element={<NewsScannerV2 />} />
                  <Route path="/news-v2" element={<NewsScannerV2 />} />
                  <Route path="/earnings" element={<EarningsPage />} />
                  <Route path="/earnings-calendar" element={<EarningsCalendar />} />
                  <Route path="/research" element={<ResearchPage />} />
                  <Route path="/alerts" element={<AlertsPage />} />
                  <Route path="/charts" element={<SymbolDataProvider><Charts /></SymbolDataProvider>} />
                  <Route path="/setup/:symbol" element={<TradeSetup />} />
                  <Route path="/live" element={<LiveCockpit />} />
                  <Route path="/cockpit" element={<SymbolDataProvider><CockpitPage /></SymbolDataProvider>} />
                  <Route path="/intelligence" element={<IntelligenceEngine />} />
                  <Route path="/intelligence-engine" element={<IntelligenceEngine />} />
                  <Route path="/intelligence-inbox" element={<IntelInbox />} />
                  <Route path="/intelligence-framework" element={<IntelligenceFrameworkPage />} />
                  <Route path="/expected-move" element={<ExpectedMove />} />
                  <Route path="/sector-heatmap" element={<SectorHeatmap />} />
                  <Route path="/profile" element={<ProfilePage />} />
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
