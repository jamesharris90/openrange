export const FEATURE_CATEGORIES = {
  CORE: 'core',
  INTEL: 'intel',
  WORKFLOW: 'workflow',
  SCANNER: 'scanner',
  ANALYSIS: 'analysis',
  EXECUTION: 'execution',
  ADMIN: 'admin',
};

export const FEATURE_KEYS = {
  DASHBOARD: 'dashboard',
  SCANNER_PAGE: 'scanner_page',
  INTEL_INBOX: 'intel_inbox',
  SECTOR_HEATMAP: 'sector_heatmap',
  PREMARKET_COMMAND: 'premarket_command',
  OPEN_MARKET_RADAR: 'open_market_radar',
  POST_MARKET_REVIEW: 'post_market_review',
  FULL_SCREENER: 'full_screener',
  ALERTS: 'alerts',
  EXPECTED_MOVE: 'expected_move',
  EARNINGS_CALENDAR: 'earnings_calendar',
  TRADING_COCKPIT: 'trading_cockpit',
  SIGNAL_INTELLIGENCE_ADMIN: 'signal_intelligence_admin',
  STRATEGY_EVALUATION: 'strategy_evaluation',
  ADMIN_PANEL: 'admin_panel',
  NEWSLETTER_ADMIN: 'newsletter_admin',
};

export const FEATURE_REGISTRY = [
  { key: FEATURE_KEYS.DASHBOARD, category: FEATURE_CATEGORIES.CORE, label: 'Dashboard' },
  { key: FEATURE_KEYS.SCANNER_PAGE, category: FEATURE_CATEGORIES.SCANNER, label: 'Scanner Page' },
  { key: FEATURE_KEYS.FULL_SCREENER, category: FEATURE_CATEGORIES.SCANNER, label: 'Full Screener' },
  { key: FEATURE_KEYS.INTEL_INBOX, category: FEATURE_CATEGORIES.INTEL, label: 'Intel Inbox' },
  { key: FEATURE_KEYS.SECTOR_HEATMAP, category: FEATURE_CATEGORIES.ANALYSIS, label: 'Sector Heatmap' },
  { key: FEATURE_KEYS.PREMARKET_COMMAND, category: FEATURE_CATEGORIES.WORKFLOW, label: 'Pre-Market Command' },
  { key: FEATURE_KEYS.OPEN_MARKET_RADAR, category: FEATURE_CATEGORIES.WORKFLOW, label: 'Open Market Radar' },
  { key: FEATURE_KEYS.POST_MARKET_REVIEW, category: FEATURE_CATEGORIES.WORKFLOW, label: 'Post-Market Review' },
  { key: FEATURE_KEYS.ALERTS, category: FEATURE_CATEGORIES.WORKFLOW, label: 'Alerts' },
  { key: FEATURE_KEYS.EXPECTED_MOVE, category: FEATURE_CATEGORIES.ANALYSIS, label: 'Expected Move' },
  { key: FEATURE_KEYS.EARNINGS_CALENDAR, category: FEATURE_CATEGORIES.INTEL, label: 'Earnings Calendar' },
  { key: FEATURE_KEYS.TRADING_COCKPIT, category: FEATURE_CATEGORIES.EXECUTION, label: 'Trading Cockpit' },
  { key: FEATURE_KEYS.SIGNAL_INTELLIGENCE_ADMIN, category: FEATURE_CATEGORIES.ADMIN, label: 'Signal Intelligence Admin' },
  { key: FEATURE_KEYS.STRATEGY_EVALUATION, category: FEATURE_CATEGORIES.ANALYSIS, label: 'Strategy Evaluation' },
  { key: FEATURE_KEYS.ADMIN_PANEL, category: FEATURE_CATEGORIES.ADMIN, label: 'Admin Panel' },
  { key: FEATURE_KEYS.NEWSLETTER_ADMIN, category: FEATURE_CATEGORIES.ADMIN, label: 'Newsletter Admin' },
];

export const ALL_FEATURE_KEYS = FEATURE_REGISTRY.map((item) => item.key);
