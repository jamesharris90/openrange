// NOTE:
// All page modules referenced here must exist under src/pages with exact casing.
// Railway builds run on Linux and will fail on case mismatches.
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { ToastProvider } from './context/ToastContext';
import { SymbolDataProvider } from './context/symbol/SymbolDataContext';
import AppLayout from './layouts/AppLayout';
import SkeletonCard from './components/ui/SkeletonCard';
import ProtectedRoute from './components/auth/ProtectedRoute';
import PublicRoute from './components/auth/PublicRoute';
import FeatureGateRoute from './components/auth/FeatureGateRoute';
import RequireAdmin from './components/auth/RequireAdmin';
import ErrorBoundary from './components/ErrorBoundary';
import MarketShell from './layouts/MarketShell';
import DiscoveryShell from './layouts/DiscoveryShell';
import BeaconShell from './layouts/BeaconShell';
import TradingShell from './layouts/TradingShell';
import WatchlistPage from './components/watchlist/WatchlistPage';
import EarningsPage from './components/earnings/EarningsPage';
import LiveCockpit from './pages/LiveCockpit.tsx';

const pageModules = import.meta.glob('./pages/**/*.jsx');

function loadPage(path) {
  const importer = pageModules[`./pages/${path}.jsx`];
  if (!importer) {
    throw new Error(`Page not found: ${path}`);
  }
  return lazy(importer);
}

const LoginPage = loadPage('LoginPage');
const RegisterPage = loadPage('RegisterPage');
const LandingPage = loadPage('LandingPage');
const ForgotPasswordPage = loadPage('ForgotPasswordPage');
const ResetPasswordPage = loadPage('ResetPasswordPage');
const OpenRangeRadarPage = loadPage('OpenRangeRadar');
const OpenRangeTerminal = loadPage('terminal/OpenRangeTerminal');
const PreMarketCommandCenter = loadPage('PreMarketCommandCenter');
const NewsScannerV2 = loadPage('NewsScannerV2');
const AdvancedScreenerPage = loadPage('AdvancedScreenerPage');
const ScreenerV3FMP = loadPage('ScreenerV3FMP');
const InstitutionalScreener = loadPage('InstitutionalScreener');
const MarketOverviewPage = loadPage('MarketOverviewPage');
const MarketHoursPage = loadPage('MarketHoursPage');
const ResearchPage = loadPage('ResearchPage');
const AlertsPage = loadPage('AlertsPage');
const OpenMarketRadar = loadPage('OpenMarketRadar');
const PostMarketReview = loadPage('PostMarketReview');
const Charts = loadPage('Charts');
const CockpitPage = loadPage('CockpitPage');
const IntelligenceFrameworkPage = loadPage('IntelligenceFrameworkPage');
const EarningsCalendar = loadPage('EarningsCalendar');
const ExpectedMove = loadPage('ExpectedMove');
const IntelInbox = loadPage('IntelInbox');
const IntelligenceEngine = loadPage('IntelligenceEngine');
const SectorHeatmap = loadPage('SectorHeatmap');
const StrategyEvaluationPage = loadPage('StrategyEvaluationPage');
const ScreenerFull = loadPage('ScreenerFull');
const TradeSetup = loadPage('TradeSetup');
const MobileDashboard = loadPage('MobileDashboard');
const ProfilePage = loadPage('ProfilePage');
const AdminControlPanel = loadPage('AdminControlPanel');
const IntelligenceMonitorPage = loadPage('IntelligenceMonitorPage');
const AccessDenied = loadPage('AccessDenied');
const BeaconHub = loadPage('beacon/BeaconHub');
const OpportunityStream = loadPage('beacon/OpportunityStream');
const SignalFeed = loadPage('beacon/SignalFeed');
const TradeNarratives = loadPage('beacon/TradeNarratives');

const AdminHome = loadPage('Admin/AdminHome');
const SystemDiagnostics = loadPage('Admin/SystemDiagnostics');
const SystemMonitorPage = loadPage('Admin/SystemMonitorPage');
const CalibrationDashboard = loadPage('Admin/CalibrationDashboard');
const LearningDashboard = loadPage('Admin/LearningDashboard');
const MissedOpportunitiesPage = loadPage('Admin/MissedOpportunitiesPage');
const SignalIntelligenceAdmin = loadPage('Admin/SignalIntelligenceAdmin');
const StrategyEdgeDashboard = loadPage('Admin/StrategyEdgeDashboard');

function InlineRouteFallback({ title = 'Page temporarily unavailable' }) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-100">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-amber-50/90">A rendering error was isolated to this panel. The app shell is still running.</p>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <ErrorBoundary>
        <BrowserRouter>
          <Suspense fallback={<div className="grid gap-2 p-4 md:grid-cols-2"><SkeletonCard lines={4} /><SkeletonCard lines={4} /></div>}>
            <Routes>
                <Route path="/" element={<PublicRoute><LandingPage /></PublicRoute>} />
                <Route path="/landing" element={<PublicRoute><LandingPage /></PublicRoute>} />
                <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
                <Route path="/register" element={<PublicRoute><RegisterPage /></PublicRoute>} />
                <Route path="/forgot-password" element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />
                <Route path="/reset-password" element={<PublicRoute><ResetPasswordPage /></PublicRoute>} />

                <Route path="/market/radar" element={<ProtectedRoute><MarketShell title="Radar"><OpenRangeRadarPage /></MarketShell></ProtectedRoute>} />
                <Route path="/market/sector-rotation" element={<ProtectedRoute><MarketShell title="Sector Rotation"><SectorHeatmap /></MarketShell></ProtectedRoute>} />
                <Route path="/market/overview" element={<ProtectedRoute><MarketShell title="Market Overview"><MarketOverviewPage /></MarketShell></ProtectedRoute>} />
                <Route path="/market/news" element={<ProtectedRoute><MarketShell title="News Feed"><NewsScannerV2 /></MarketShell></ProtectedRoute>} />
                <Route path="/market/regime" element={<ProtectedRoute><MarketShell title="Market Regime"><IntelligenceFrameworkPage /></MarketShell></ProtectedRoute>} />
                <Route path="/market/hours" element={<ProtectedRoute><MarketShell title="Market Hours"><MarketHoursPage /></MarketShell></ProtectedRoute>} />

                <Route path="/discovery/scanner" element={<ProtectedRoute><DiscoveryShell title="Scanner"><InstitutionalScreener /></DiscoveryShell></ProtectedRoute>} />
                <Route path="/discovery/full-screener" element={<ProtectedRoute><DiscoveryShell title="Full Screener"><FeatureGateRoute featureKey="full_screener"><ScreenerFull /></FeatureGateRoute></DiscoveryShell></ProtectedRoute>} />
                <Route path="/discovery/advanced-screener" element={<ProtectedRoute><DiscoveryShell title="Advanced Screener"><AdvancedScreenerPage /></DiscoveryShell></ProtectedRoute>} />
                <Route path="/discovery/expected-move" element={<ProtectedRoute><DiscoveryShell title="Expected Move"><ExpectedMove /></DiscoveryShell></ProtectedRoute>} />
                <Route path="/discovery/earnings" element={<ProtectedRoute><DiscoveryShell title="Earnings Calendar"><EarningsCalendar /></DiscoveryShell></ProtectedRoute>} />

                <Route path="/beacon/hub" element={<ProtectedRoute><BeaconShell title="Beacon Hub"><BeaconHub /></BeaconShell></ProtectedRoute>} />
                <Route path="/beacon/opportunities" element={<ProtectedRoute><BeaconShell title="Opportunity Stream"><OpportunityStream /></BeaconShell></ProtectedRoute>} />
                <Route path="/beacon/signals" element={<ProtectedRoute><BeaconShell title="Signal Feed"><SignalFeed /></BeaconShell></ProtectedRoute>} />
                <Route path="/beacon/narratives" element={<ProtectedRoute><BeaconShell title="Trade Narratives"><TradeNarratives /></BeaconShell></ProtectedRoute>} />

                <Route path="/trading/charts" element={<ProtectedRoute><TradingShell title="Charts"><SymbolDataProvider><Charts /></SymbolDataProvider></TradingShell></ProtectedRoute>} />
                <Route path="/trading/setup/:symbol" element={<ProtectedRoute><TradingShell title="Trade Setup"><TradeSetup /></TradingShell></ProtectedRoute>} />
                <Route path="/trading/cockpit" element={<ProtectedRoute><TradingShell title="Cockpit"><FeatureGateRoute featureKey="trading_cockpit"><SymbolDataProvider><CockpitPage /></SymbolDataProvider></FeatureGateRoute></TradingShell></ProtectedRoute>} />
                <Route path="/trading/watchlists" element={<ProtectedRoute><TradingShell title="Watchlists"><WatchlistPage /></TradingShell></ProtectedRoute>} />
                <Route path="/trading/alerts" element={<ProtectedRoute><TradingShell title="Alerts"><FeatureGateRoute featureKey="alerts"><AlertsPage /></FeatureGateRoute></TradingShell></ProtectedRoute>} />

                <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                  <Route path="/terminal" element={<OpenRangeTerminal />} />
                  <Route path="/dashboard" element={<Navigate to="/terminal" replace />} />
                  <Route
                    path="/radar"
                    element={(
                      <ErrorBoundary inline fallback={<InlineRouteFallback title="Radar temporarily unavailable" />}>
                        <OpenRangeRadarPage />
                      </ErrorBoundary>
                    )}
                  />
                  <Route path="/mobile-dashboard" element={<MobileDashboard />} />
                  <Route path="/scanner" element={<InstitutionalScreener />} />
                  <Route path="/screeners" element={<Navigate to="/discovery/scanner" replace />} />
                  <Route path="/watchlist" element={<WatchlistPage />} />
                  <Route path="/watchlists" element={<Navigate to="/watchlist" replace />} />
                  <Route path="/pre-market-command" element={<PreMarketCommandCenter />} />
                  <Route path="/open-market-radar" element={<OpenMarketRadar />} />
                  <Route path="/post-market-review" element={<PostMarketReview />} />
                  <Route path="/pre-market" element={<Navigate to="/pre-market-command" replace />} />
                  <Route path="/open-market" element={<Navigate to="/open-market-radar" replace />} />
                  <Route path="/post-market" element={<Navigate to="/post-market-review" replace />} />
                  <Route path="/market-overview" element={<Navigate to="/market/overview" replace />} />
                  <Route path="/market" element={<Navigate to="/market/overview" replace />} />
                  <Route path="/market-hours" element={<Navigate to="/market/hours" replace />} />
                  <Route path="/screener" element={<Navigate to="/discovery/scanner" replace />} />
                  <Route path="/screener-full" element={<Navigate to="/discovery/full-screener" replace />} />
                  <Route path="/screener-v2" element={<Navigate to="/discovery/scanner" replace />} />
                  <Route path="/screener-v3" element={<Navigate to="/discovery/scanner" replace />} />
                  <Route path="/screener-v3-fmp" element={<Navigate to="/discovery/scanner" replace />} />
                  <Route path="/advanced-screener" element={<Navigate to="/discovery/advanced-screener" replace />} />
                  <Route path="/news-scanner" element={<Navigate to="/market/news" replace />} />
                  <Route path="/news" element={<Navigate to="/market/news" replace />} />
                  <Route path="/news-feed" element={<Navigate to="/market/news" replace />} />
                  <Route path="/news-v2" element={<NewsScannerV2 />} />
                  <Route path="/earnings" element={<Navigate to="/discovery/earnings" replace />} />
                  <Route path="/earnings-calendar" element={<Navigate to="/discovery/earnings" replace />} />
                  <Route path="/research" element={<ResearchPage />} />
                  <Route path="/alerts" element={<Navigate to="/trading/alerts" replace />} />
                  <Route path="/charts" element={<SymbolDataProvider><Charts /></SymbolDataProvider>} />
                  <Route path="/setup/:symbol" element={<TradeSetup />} />
                  <Route path="/live" element={<LiveCockpit />} />
                  <Route path="/cockpit" element={<FeatureGateRoute featureKey="trading_cockpit"><SymbolDataProvider><CockpitPage /></SymbolDataProvider></FeatureGateRoute>} />
                  <Route path="/intelligence" element={<Navigate to="/beacon/hub" replace />} />
                  <Route path="/intelligence-engine" element={<Navigate to="/beacon/signals" replace />} />
                  <Route path="/intelligence-inbox" element={<Navigate to="/beacon/hub" replace />} />
                  <Route path="/intelligence-framework" element={<IntelligenceFrameworkPage />} />
                  <Route path="/expected-move" element={<Navigate to="/discovery/expected-move" replace />} />
                  <Route path="/sector-heatmap" element={<Navigate to="/market/sector-rotation" replace />} />
                  <Route path="/learning/strategy" element={<StrategyEvaluationPage />} />
                  <Route path="/learning/calibration" element={<RequireAdmin><FeatureGateRoute featureKey="admin_panel"><ErrorBoundary inline fallback={<InlineRouteFallback title="Learning module unavailable" />}><CalibrationDashboard /></ErrorBoundary></FeatureGateRoute></RequireAdmin>} />
                  <Route path="/learning/edge" element={<RequireAdmin><FeatureGateRoute featureKey="admin_panel"><ErrorBoundary inline fallback={<InlineRouteFallback title="Learning module unavailable" />}><StrategyEdgeDashboard /></ErrorBoundary></FeatureGateRoute></RequireAdmin>} />
                  <Route path="/learning/missed" element={<RequireAdmin><FeatureGateRoute featureKey="admin_panel"><ErrorBoundary inline fallback={<InlineRouteFallback title="Learning module unavailable" />}><MissedOpportunitiesPage /></ErrorBoundary></FeatureGateRoute></RequireAdmin>} />
                  <Route path="/learning/dashboard" element={<RequireAdmin><FeatureGateRoute featureKey="admin_panel"><ErrorBoundary inline fallback={<InlineRouteFallback title="Learning module unavailable" />}><LearningDashboard /></ErrorBoundary></FeatureGateRoute></RequireAdmin>} />
                  <Route path="/strategy-evaluation" element={<Navigate to="/learning/strategy" replace />} />
                  <Route path="/signal-intelligence-admin" element={<Navigate to="/beacon/signals" replace />} />
                  <Route path="/system/admin" element={<RequireAdmin><FeatureGateRoute featureKey="admin_panel"><ErrorBoundary inline fallback={<InlineRouteFallback title="System panel unavailable" />}><AdminHome /></ErrorBoundary></FeatureGateRoute></RequireAdmin>} />
                  <Route path="/system/diagnostics" element={<RequireAdmin><FeatureGateRoute featureKey="admin_panel"><ErrorBoundary inline fallback={<InlineRouteFallback title="System panel unavailable" />}><SystemDiagnostics /></ErrorBoundary></FeatureGateRoute></RequireAdmin>} />
                  <Route path="/system/intelligence-monitor" element={<RequireAdmin><FeatureGateRoute featureKey="admin_panel"><ErrorBoundary inline fallback={<InlineRouteFallback title="System panel unavailable" />}><IntelligenceMonitorPage /></ErrorBoundary></FeatureGateRoute></RequireAdmin>} />
                  <Route path="/system/features" element={<RequireAdmin><FeatureGateRoute featureKey="admin_panel"><ErrorBoundary inline fallback={<InlineRouteFallback title="System panel unavailable" />}><AdminControlPanel /></ErrorBoundary></FeatureGateRoute></RequireAdmin>} />
                  <Route path="/system/users" element={<RequireAdmin><FeatureGateRoute featureKey="admin_panel"><ErrorBoundary inline fallback={<InlineRouteFallback title="System panel unavailable" />}><AdminControlPanel /></ErrorBoundary></FeatureGateRoute></RequireAdmin>} />
                  <Route path="/system/audit" element={<RequireAdmin><FeatureGateRoute featureKey="admin_panel"><ErrorBoundary inline fallback={<InlineRouteFallback title="System panel unavailable" />}><AdminControlPanel /></ErrorBoundary></FeatureGateRoute></RequireAdmin>} />
                  <Route path="/system/profile" element={<ProfilePage />} />
                  <Route path="/admin" element={<RequireAdmin><FeatureGateRoute featureKey="admin_panel"><ErrorBoundary inline fallback={<InlineRouteFallback title="System panel unavailable" />}><AdminHome /></ErrorBoundary></FeatureGateRoute></RequireAdmin>} />
                  <Route path="/admin-control" element={<RequireAdmin><FeatureGateRoute featureKey="admin_panel"><ErrorBoundary><AdminControlPanel /></ErrorBoundary></FeatureGateRoute></RequireAdmin>} />
                  <Route path="/admin/features" element={<Navigate to="/system/features" replace />} />
                  <Route path="/admin/users" element={<Navigate to="/system/users" replace />} />
                  <Route path="/admin/roles" element={<Navigate to="/system/users" replace />} />
                  <Route path="/admin/audit" element={<Navigate to="/system/audit" replace />} />
                  <Route path="/admin/home" element={<Navigate to="/system/admin" replace />} />
                  <Route path="/admin/diagnostics" element={<Navigate to="/system/diagnostics" replace />} />
                  <Route path="/admin/system-diagnostics" element={<Navigate to="/system/diagnostics" replace />} />
                  <Route path="/admin/system" element={<RequireAdmin><FeatureGateRoute featureKey="admin_panel"><ErrorBoundary><SystemDiagnostics /></ErrorBoundary></FeatureGateRoute></RequireAdmin>} />
                  <Route path="/admin/intelligence-monitor" element={<Navigate to="/system/intelligence-monitor" replace />} />
                  <Route path="/admin/system-monitor" element={<RequireAdmin><FeatureGateRoute featureKey="admin_panel"><ErrorBoundary><SystemMonitorPage /></ErrorBoundary></FeatureGateRoute></RequireAdmin>} />
                  <Route path="/admin/learning-dashboard" element={<Navigate to="/learning/dashboard" replace />} />
                  <Route path="/admin/learning" element={<RequireAdmin><FeatureGateRoute featureKey="admin_panel"><ErrorBoundary><LearningDashboard /></ErrorBoundary></FeatureGateRoute></RequireAdmin>} />
                  <Route path="/admin/strategy-edge" element={<Navigate to="/learning/edge" replace />} />
                  <Route path="/admin/signals" element={<RequireAdmin><FeatureGateRoute featureKey="admin_panel"><ErrorBoundary><SignalIntelligenceAdmin /></ErrorBoundary></FeatureGateRoute></RequireAdmin>} />
                  <Route path="/admin/calibration" element={<Navigate to="/learning/calibration" replace />} />
                  <Route path="/admin/missed-opportunities" element={<Navigate to="/learning/missed" replace />} />
                  <Route path="/admin/validation" element={<RequireAdmin><FeatureGateRoute featureKey="admin_panel"><ErrorBoundary><MissedOpportunitiesPage /></ErrorBoundary></FeatureGateRoute></RequireAdmin>} />
                  <Route path="/access-denied" element={<AccessDenied />} />
                  <Route path="/profile" element={<Navigate to="/system/profile" replace />} />
                </Route>

                <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ErrorBoundary>
    </ToastProvider>
  );
}
