/**
 * Market-Adjusted Expected Move Engine — Frontend
 *
 * Consumes /api/expected-move-enhanced to display composite confidence scoring,
 * probability containment/breach, 7-category breakdowns, and a scored watchlist.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'userWatchlist';
  const LAST_TICKER_KEY = 'emEngineLastTicker';
  const REFRESH_INTERVAL = 5 * 60 * 1000;
  const FETCH_DELAY_MS = 400;

  let watchlist = [];
  let tickerData = {};
  let currentTicker = null;
  let refreshTimer = null;
  let countdownTimer = null;
  let nextRefreshAt = 0;
  let sortState = { column: 'composite', direction: 'desc' };
  const DEFAULT_TICKER = 'AAPL';

  // ── Persistence ──────────────────────────────────────
  function loadWatchlist() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      watchlist = Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      watchlist = [];
    }
  }
  function saveWatchlist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(watchlist));
  }

  // ── Data Fetching ────────────────────────────────────
  async function fetchEnhanced(ticker) {
    const base = (window.CONFIG && CONFIG.API_BASE) || '';
    const url = base + '/api/expected-move-enhanced?ticker=' + encodeURIComponent(ticker);
    console.log('[EM-Engine] Fetching:', url);
    const resp = await fetch(url);
    if (!resp.ok) {
      const err = await resp.json().catch(function () { return {}; });
      console.error('[EM-Engine] API error:', resp.status, err);
      throw new Error(err.error || err.detail || 'HTTP ' + resp.status);
    }
    var data = await resp.json();
    console.log('[EM-Engine] Received data for', ticker, '- composite:', data.scoring && data.scoring.composite);
    return data;
  }

  async function fetchTickerData(ticker) {
    if (!tickerData[ticker]) tickerData[ticker] = {};
    tickerData[ticker].loading = true;
    try {
      var data = await fetchEnhanced(ticker);
      tickerData[ticker] = data;
      tickerData[ticker].loading = false;
      tickerData[ticker]._error = null;
    } catch (err) {
      tickerData[ticker] = { loading: false, _error: err.message };
    }
    return tickerData[ticker];
  }

  async function fetchAllWatchlistData() {
    for (var i = 0; i < watchlist.length; i++) {
      var item = watchlist[i];
      var t = (item && typeof item === 'object' && 'symbol' in item) ? item.symbol : item;
      await fetchTickerData(t);
      renderWatchlistRow(t);
      if (i < watchlist.length - 1) {
        await new Promise(function (r) { setTimeout(r, FETCH_DELAY_MS); });
      }
    }
  }

  // ...existing code continues (full file content copied)...
})();
