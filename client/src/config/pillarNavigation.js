import {
  Activity,
  BarChart2,
  Bell,
  CandlestickChart,
  Compass,
  Gauge,
  Inbox,
  LayoutDashboard,
  LineChart,
  Newspaper,
  Radar,
  Shield,
  SlidersHorizontal,
  TrendingUp,
  UserCircle,
} from 'lucide-react';

export const pillarNavigation = [
  {
    label: 'MARKET',
    items: [
      { to: '/market/radar', label: 'Radar', icon: Radar },
      { to: '/market/sector-rotation', label: 'Sector Rotation', icon: TrendingUp },
      { to: '/market/overview', label: 'Market Overview', icon: BarChart2 },
      { to: '/market/news', label: 'News', icon: Newspaper },
      { to: '/market/regime', label: 'Market Regime', icon: Gauge },
      { to: '/market/hours', label: 'Market Hours', icon: Activity },
    ],
  },
  {
    label: 'DISCOVERY',
    items: [
      { to: '/discovery/scanner', label: 'Scanner', icon: Compass },
      { to: '/discovery/full-screener', label: 'Full Screener', icon: Compass, feature: 'full_screener' },
      { to: '/discovery/advanced-screener', label: 'Advanced Screener', icon: SlidersHorizontal },
      { to: '/discovery/expected-move', label: 'Expected Move', icon: LineChart },
      { to: '/discovery/earnings', label: 'Earnings', icon: Activity },
    ],
  },
  {
    label: 'BEACON',
    items: [
      { to: '/beacon/hub', label: 'Intelligence Feed', icon: Inbox },
      { to: '/beacon/opportunities', label: 'Opportunity Stream', icon: TrendingUp },
      { to: '/beacon/signals', label: 'Signal Engine', icon: Activity },
      { to: '/beacon/narratives', label: 'Trade Narratives', icon: Newspaper },
    ],
  },
  {
    label: 'TRADING',
    items: [
      { to: '/trading/charts', label: 'Charts', icon: CandlestickChart },
      { to: '/trading/setup', label: 'Trade Setup', icon: Activity },
      { to: '/trading/cockpit', label: 'Cockpit', icon: LayoutDashboard, feature: 'trading_cockpit' },
      { to: '/trading/watchlists', label: 'Watchlists', icon: Compass },
      { to: '/trading/alerts', label: 'Alerts', icon: Bell, feature: 'alerts' },
    ],
  },
  {
    label: 'LEARNING',
    items: [
      { to: '/learning/strategy', label: 'Strategy Evaluation', icon: LineChart },
      { to: '/learning/calibration', label: 'Calibration', icon: SlidersHorizontal },
      { to: '/learning/edge', label: 'Strategy Edge', icon: TrendingUp },
      { to: '/learning/missed', label: 'Missed Opportunities', icon: Activity },
      { to: '/learning/dashboard', label: 'Learning Dashboard', icon: Gauge },
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      { to: '/system/admin', label: 'Admin', icon: Shield, feature: 'admin_panel' },
      { to: '/system/diagnostics', label: 'Diagnostics', icon: Activity, feature: 'admin_panel' },
      { to: '/system/intelligence-monitor', label: 'Intelligence Monitor', icon: Radar, feature: 'admin_panel' },
      { to: '/system/features', label: 'Feature Flags', icon: SlidersHorizontal, feature: 'admin_panel' },
      { to: '/system/users', label: 'Users', icon: UserCircle, feature: 'admin_panel' },
      { to: '/system/audit', label: 'Audit Logs', icon: Shield, feature: 'admin_panel' },
      { to: '/system/profile', label: 'Profile', icon: UserCircle },
    ],
  },
];
