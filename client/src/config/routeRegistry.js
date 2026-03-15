import appSource from '../App.jsx?raw';

const WRAPPER_COMPONENTS = new Set([
  'PublicRoute',
  'ProtectedRoute',
  'FeatureGateRoute',
  'RequireAdmin',
  'ErrorBoundary',
  'SymbolDataProvider',
  'MarketShell',
  'DiscoveryShell',
  'BeaconShell',
  'TradingShell',
  'LearningShell',
  'SystemShell',
]);

const DEPRECATED_ROUTES = new Set([
  '/screener-v2',
  '/screener-v3',
  '/news-v2',
  '/screener-v3-fmp',
]);

const NOTES_OVERRIDES = {
  '/': 'Public landing route.',
  '/landing': 'Public landing alias retained for compatibility.',
  '/watchlist': 'Legacy trading watchlist route kept while /trading/watchlists is canonical.',
  '/setup/:symbol': 'Legacy trade setup route; canonical route is /trading/setup/:symbol.',
  '/news-v2': 'Legacy news page retained; canonical market news lives under /market/news.',
  '/admin-control': 'Legacy admin shell route retained for compatibility.',
  '*': 'Fallback route for unknown paths.',
};

const CANONICAL_OVERRIDES = {
  '/watchlist': '/trading/watchlists',
  '/setup/:symbol': '/trading/setup/:symbol',
  '/news-v2': '/market/news',
  '/admin-control': '/system/admin',
  '/admin/system': '/system/diagnostics',
  '/admin/system-monitor': '/system/diagnostics',
  '/admin/learning': '/learning/dashboard',
  '/admin/signals': '/beacon/signals',
  '/admin/validation': '/learning/missed',
  '/dashboard': '/dashboard',
  '/mobile-dashboard': '/mobile-dashboard',
  '/pre-market-command': '/pre-market-command',
  '/open-market-radar': '/open-market-radar',
  '/post-market-review': '/post-market-review',
  '/research': '/research',
  '/live': '/live',
  '/access-denied': '/access-denied',
};

const PILLAR_PREFIXES = [
  '/market/',
  '/discovery/',
  '/beacon/',
  '/trading/',
  '/learning/',
  '/system/',
];

function inferPillar(route, canonicalRoute) {
  const target = canonicalRoute || route;
  if (target.startsWith('/market/')) return 'market';
  if (target.startsWith('/discovery/')) return 'discovery';
  if (target.startsWith('/beacon/')) return 'beacon';
  if (target.startsWith('/trading/')) return 'trading';
  if (target.startsWith('/learning/')) return 'learning';
  if (target.startsWith('/system/')) return 'system';
  if (target === '/' || target.startsWith('/landing') || target.startsWith('/login') || target.startsWith('/register') || target.startsWith('/forgot-password') || target.startsWith('/reset-password')) return 'public';
  return 'core';
}

function inferCanonicalRoute(route, replacement) {
  if (CANONICAL_OVERRIDES[route]) return CANONICAL_OVERRIDES[route];
  if (replacement) return replacement;
  if (PILLAR_PREFIXES.some((prefix) => route.startsWith(prefix))) return route;
  return route;
}

function inferStatus(route, replacement) {
  if (DEPRECATED_ROUTES.has(route)) return 'deprecated';
  if (replacement) return 'compatibility';
  return 'active';
}

function inferNotes(route, replacement, status) {
  if (NOTES_OVERRIDES[route]) return NOTES_OVERRIDES[route];
  if (status === 'deprecated') return 'Legacy route marked for removal after migration telemetry confirms no traffic.';
  if (replacement) return `Compatibility redirect to ${replacement}.`;
  return 'Canonical route.';
}

function extractPageComponent(routeLine) {
  const tags = [...routeLine.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)].map((match) => match[1]);
  const candidates = tags.filter((name) => !WRAPPER_COMPONENTS.has(name) && name !== 'Navigate');
  if (candidates.length > 0) return candidates[candidates.length - 1];
  if (routeLine.includes('<Navigate ')) return 'Navigate';
  return null;
}

function parseRoutesFromAppSource(source) {
  const lines = source.split('\n').map((line) => line.trim());
  const routeLines = lines.filter((line) => line.startsWith('<Route path='));

  return routeLines
    .map((routeLine) => {
      const pathMatch = routeLine.match(/path="([^"]+)"/);
      if (!pathMatch) return null;

      const route = pathMatch[1];
      const replacementMatch = routeLine.match(/<Navigate\s+to="([^"]+)"/);
      const replacement = replacementMatch ? replacementMatch[1] : null;
      const canonicalRoute = inferCanonicalRoute(route, replacement);
      const status = inferStatus(route, replacement);

      return {
        route,
        pillar: inferPillar(route, canonicalRoute),
        canonicalRoute,
        pageComponent: extractPageComponent(routeLine),
        status,
        replacement,
        notes: inferNotes(route, replacement, status),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.route.localeCompare(b.route));
}

function normalizePath(route) {
  if (!route) return '/';
  const normalized = String(route).trim();
  if (!normalized) return '/';
  if (normalized === '*') return '*';
  if (!normalized.startsWith('/')) return `/${normalized}`;
  return normalized;
}

function routePatternToRegex(pattern) {
  if (pattern === '*') return /^.*$/;

  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\/:([A-Za-z0-9_]+)/g, '/[^/]+')
    .replace(/\*/g, '.*');

  return new RegExp(`^${escaped}$`);
}

function findRouteEntry(route) {
  const normalized = normalizePath(route);

  let exact = routeRegistry.find((entry) => entry.route === normalized);
  if (exact) return exact;

  exact = routeRegistry.find((entry) => entry.route !== '*' && routePatternToRegex(entry.route).test(normalized));
  if (exact) return exact;

  return routeRegistry.find((entry) => entry.route === '*') || null;
}

export const routeRegistry = parseRoutesFromAppSource(appSource);

export function getRouteStatus(route) {
  const entry = findRouteEntry(route);
  return entry ? entry.status : null;
}

export function getRouteRegistryEntry(route) {
  return findRouteEntry(route);
}
