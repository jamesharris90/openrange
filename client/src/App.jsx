import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import ErrorBoundary from './components/shared/ErrorBoundary';
import ProtectedRoute from './components/auth/ProtectedRoute';
import PublicRoute from './components/auth/PublicRoute';
import AppShell from './components/layout/AppShell';

// Auth pages (no sidebar)
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';

// App pages
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
import ProfilePage from './pages/ProfilePage';
import AdminPage from './pages/AdminPage';

const AIQuantPage = lazy(() => import('./components/ai-quant/AIQuantPage'));

const AIQuantSuspense = (
  <Suspense fallback={<div className="page-loading">Loading Intelligence Engine…</div>}>
    <AIQuantPage />
  </Suspense>
);

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <Routes>
              {/* Public auth pages — NO sidebar/topbar */}
              <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
              <Route path="/register" element={<PublicRoute><RegisterPage /></PublicRoute>} />
              <Route path="/forgot-password" element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />
              <Route path="/reset-password" element={<PublicRoute><ResetPasswordPage /></PublicRoute>} />

              {/* Protected app pages — WITH sidebar/topbar */}
              <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
                <Route path="/watchlist" element={<WatchlistPage />} />
                <Route path="/screeners" element={<ScreenersPage />} />
                <Route path="/premarket" element={<PreMarketPage />} />
                <Route path="/open-market" element={<OpenMarketPage />} />
                <Route path="/postmarket" element={<PostMarketPage />} />
                <Route path="/market-overview" element={<MarketOverviewPage />} />
                <Route path="/market-hours" element={<MarketHoursPage />} />
                <Route path="/research" element={<ResearchPage />} />
                <Route path="/news-scanner" element={<NewsScannerPage />} />
                <Route path="/advanced-screener" element={<AdvancedScreenerPage />} />
                <Route path="/expected-move" element={<ExpectedMovePage />} />
                <Route path="/gappers" element={<GappersPage />} />
                <Route path="/earnings" element={<EarningsPage />} />
                <Route path="/ai-quant" element={AIQuantSuspense} />
                <Route path="/intelligence-engine" element={AIQuantSuspense} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/admin" element={<ProtectedRoute adminOnly><AdminPage /></ProtectedRoute>} />
              </Route>

              {/* Catch-all redirect */}
              <Route path="*" element={<Navigate to="/watchlist" replace />} />
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
