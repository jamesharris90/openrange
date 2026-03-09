import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Suspense } from 'react';
import { ToastProvider } from './context/ToastContext';
import { SymbolDataProvider } from './context/symbol/SymbolDataContext';
import safeLazy from './utils/safeLazy';
import AppLayout from './components/layout/AppLayout';
import TickerTape from './components/TickerTape';
import SkeletonCard from './components/ui/SkeletonCard';
import ProtectedRoute from './components/auth/ProtectedRoute';
import PublicRoute from './components/auth/PublicRoute';
import FeatureGateRoute from './components/auth/FeatureGateRoute';
const LoginPage = safeLazy(() => import('./pages/LoginPage'));
const RegisterPage = safeLazy(() => import('./pages/RegisterPage'));
const LandingPage = safeLazy(() => import('./pages/LandingPage'));
const ForgotPasswordPage = safeLazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = safeLazy(() => import('./pages/ResetPasswordPage'));
const DashboardPage = safeLazy(() => import('./pages/DashboardPage'));
const WatchlistPage = safeLazy(() => import('./components/watchlist/WatchlistPage'));
const EarningsPage = safeLazy(() => import('./components/earnings/EarningsPage'));
const PreMarketCommandCenter = safeLazy(() => import('./pages/PreMarketCommandCenter'));
const NewsScannerV2 = safeLazy(() => import('./pages/NewsScannerV2'));
const AdvancedScreenerPage = safeLazy(() => import('./pages/AdvancedScreenerPage'));
const ScreenerV3FMP = safeLazy(() => import('./pages/ScreenerV3FMP'));
const InstitutionalScreener = safeLazy(() => import('./pages/InstitutionalScreener'));
const MarketOverviewPage = safeLazy(() => import('./pages/MarketOverviewPage'));
const MarketHoursPage = safeLazy(() => import('./pages/MarketHoursPage'));
const ResearchPage = safeLazy(() => import('./pages/ResearchPage'));
const AlertsPage = safeLazy(() => import('./pages/AlertsPage'));
const OpenMarketRadar = safeLazy(() => import('./pages/OpenMarketRadar'));
const PostMarketReview = safeLazy(() => import('./pages/PostMarketReview'));
const Charts = safeLazy(() => import('./pages/Charts'));
const LiveCockpit = safeLazy(() => import('./pages/LiveCockpit'));
const CockpitPage = safeLazy(() => import('./pages/CockpitPage'));
const IntelligenceFrameworkPage = safeLazy(() => import('./pages/IntelligenceFrameworkPage'));
const EarningsCalendar = safeLazy(() => import('./pages/EarningsCalendar'));
const ExpectedMove = safeLazy(() => import('./pages/ExpectedMove'));
const IntelInbox = safeLazy(() => import('./pages/IntelInbox'));
const IntelligenceEngine = safeLazy(() => import('./pages/IntelligenceEngine'));
const SectorHeatmap = safeLazy(() => import('./pages/SectorHeatmap'));
const StrategyEvaluationPage = safeLazy(() => import('./pages/StrategyEvaluationPage'));
const SignalIntelligenceAdmin = safeLazy(() => import('./pages/SignalIntelligenceAdmin'));
const ScreenerFull = safeLazy(() => import('./pages/ScreenerFull'));
const TradeSetup = safeLazy(() => import('./pages/TradeSetup'));
const MobileDashboard = safeLazy(() => import('./pages/MobileDashboard'));
const ProfilePage = safeLazy(() => import('./pages/ProfilePage'));
const AdminControlPanel = safeLazy(() => import('./pages/AdminControlPanel'));
const AccessDenied = safeLazy(() => import('./pages/AccessDenied'));

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <TickerTape />
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
                  <Route path="/scanner" element={<Navigate to="/screener" replace />} />
                  <Route path="/screeners" element={<Navigate to="/screener" replace />} />
                  <Route path="/watchlist" element={<WatchlistPage />} />
                  <Route path="/watchlists" element={<Navigate to="/watchlist" replace />} />
                  <Route path="/pre-market-command" element={<PreMarketCommandCenter />} />
                  <Route path="/open-market-radar" element={<OpenMarketRadar />} />
                  <Route path="/post-market-review" element={<PostMarketReview />} />
                  <Route path="/pre-market" element={<Navigate to="/pre-market-command" replace />} />
                  <Route path="/open-market" element={<Navigate to="/open-market-radar" replace />} />
                  <Route path="/post-market" element={<Navigate to="/post-market-review" replace />} />
                  <Route path="/market-overview" element={<MarketOverviewPage />} />
                  <Route path="/market" element={<Navigate to="/market-overview" replace />} />
                  <Route path="/market-hours" element={<MarketHoursPage />} />
                  <Route path="/screener" element={<InstitutionalScreener />} />
                  <Route path="/screener-full" element={<FeatureGateRoute featureKey="full_screener"><ScreenerFull /></FeatureGateRoute>} />
                  <Route path="/screener-v2" element={<Navigate to="/screener" replace />} />
                  <Route path="/screener-v3" element={<Navigate to="/screener" replace />} />
                  <Route path="/screener-v3-fmp" element={<ScreenerV3FMP />} />
                  <Route path="/advanced-screener" element={<AdvancedScreenerPage />} />
                  <Route path="/news-scanner" element={<NewsScannerV2 />} />
                  <Route path="/news" element={<Navigate to="/news-feed" replace />} />
                  <Route path="/news-feed" element={<NewsScannerV2 />} />
                  <Route path="/news-v2" element={<NewsScannerV2 />} />
                  <Route path="/earnings" element={<EarningsPage />} />
                  <Route path="/earnings-calendar" element={<EarningsCalendar />} />
                  <Route path="/research" element={<ResearchPage />} />
                  <Route path="/alerts" element={<FeatureGateRoute featureKey="alerts"><AlertsPage /></FeatureGateRoute>} />
                  <Route path="/charts" element={<SymbolDataProvider><Charts /></SymbolDataProvider>} />
                  <Route path="/setup/:symbol" element={<TradeSetup />} />
                  <Route path="/live" element={<LiveCockpit />} />
                  <Route path="/cockpit" element={<FeatureGateRoute featureKey="trading_cockpit"><SymbolDataProvider><CockpitPage /></SymbolDataProvider></FeatureGateRoute>} />
                  <Route path="/intelligence" element={<IntelligenceEngine />} />
                  <Route path="/intelligence-engine" element={<IntelligenceEngine />} />
                  <Route path="/intelligence-inbox" element={<IntelInbox />} />
                  <Route path="/intelligence-framework" element={<IntelligenceFrameworkPage />} />
                  <Route path="/expected-move" element={<ExpectedMove />} />
                  <Route path="/sector-heatmap" element={<SectorHeatmap />} />
                  <Route path="/strategy-evaluation" element={<StrategyEvaluationPage />} />
                  <Route path="/signal-intelligence-admin" element={<SignalIntelligenceAdmin />} />
                  <Route path="/admin" element={<FeatureGateRoute featureKey="admin_panel"><AdminControlPanel /></FeatureGateRoute>} />
                  <Route path="/admin-control" element={<FeatureGateRoute featureKey="admin_panel"><AdminControlPanel /></FeatureGateRoute>} />
                  <Route path="/admin/features" element={<FeatureGateRoute featureKey="admin_panel"><AdminControlPanel /></FeatureGateRoute>} />
                  <Route path="/access-denied" element={<AccessDenied />} />
                  <Route path="/profile" element={<ProfilePage />} />
                </Route>

                <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ToastProvider>
  );
}
