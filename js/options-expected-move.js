/**
 * Market-Adjusted Expected Move Engine — Frontend
 *
 * Consumes /api/expected-move-enhanced to display composite confidence scoring,
 * probability containment/breach, 7-category breakdowns, and a scored watchlist.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'emEngineWatchlist';
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
    try { watchlist = JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch (e) { watchlist = []; }
    // Migrate from old key
    if (!watchlist.length) {
      try {
        const old = JSON.parse(localStorage.getItem('emWatchlist'));
        if (Array.isArray(old) && old.length) { watchlist = old; saveWatchlist(); }
      } catch (e) { /* ignore */ }
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
      var t = watchlist[i];
      await fetchTickerData(t);
      renderWatchlistRow(t);
      if (i < watchlist.length - 1) {
        await new Promise(function (r) { setTimeout(r, FETCH_DELAY_MS); });
      }
    }
  }

  // ── Utilities ────────────────────────────────────────
  function fmtNum(n, dec) {
    if (dec === undefined) dec = 2;
    if (n == null || isNaN(n)) return '--';
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  function fmtInt(n) {
    if (n == null || isNaN(n)) return '--';
    return Number(n).toLocaleString('en-US');
  }
  function tierCssClass(k) {
    return { high: 'em-tier-high', conditional: 'em-tier-conditional', low: 'em-tier-low', avoid: 'em-tier-avoid' }[k] || 'em-tier-avoid';
  }
  function scoreCssClass(k) {
    return { high: 'em-score-high', conditional: 'em-score-conditional', low: 'em-score-low', avoid: 'em-score-avoid' }[k] || 'em-score-avoid';
  }
  function catBarColor(pct) {
    if (pct >= 70) return '#22c55e';
    if (pct >= 40) return '#f59e0b';
    return '#ef4444';
  }
  function ivCellClass(hvRank) {
    if (hvRank == null) return '';
    if (hvRank < 25) return 'em-iv-low';
    if (hvRank < 50) return 'em-iv-normal';
    if (hvRank < 75) return 'em-iv-elevated';
    return 'em-iv-high';
  }

  function getEarningsInfo(d) {
    var earn = d && d.earnings ? d.earnings : {};
    var opts = d && d.options ? d.options : {};
    var nextInDays = earn.nextInDays;
    if (nextInDays == null && opts.earningsInDays != null) nextInDays = opts.earningsInDays;
    var nextDate = earn.nextDate || opts.earningsDate || null;
    var surprise = earn.lastSurprisePercent != null ? earn.lastSurprisePercent : null;
    var beats = earn.beatsInLast4 != null ? earn.beatsInLast4 : null;
    var lastPeriod = earn.lastPeriod || null;
    var lastActual = earn.lastActualEPS != null ? earn.lastActualEPS : null;
    var lastEstimate = earn.lastEstimateEPS != null ? earn.lastEstimateEPS : null;
    return { nextInDays, nextDate, surprise, beats, lastPeriod, lastActual, lastEstimate };
  }

  // ── Rendering: Price Card ────────────────────────────
  function renderPriceCard(d) {
    var el = document.getElementById('emPriceCard');
    if (!el) return;
    var changeClass = (d.change || 0) >= 0 ? 'positive' : 'negative';
    var changeSign = (d.change || 0) >= 0 ? '+' : '';
    var prob = d.probability || {};
    var opts = d.options || {};
    var earnInfo = getEarningsInfo(d);

    var earningsFlag = '';
    if (earnInfo.nextInDays != null && earnInfo.nextInDays > 0 && earnInfo.nextInDays <= 21) {
      var cls = earnInfo.nextInDays <= 7 ? 'danger' : 'warning';
      earningsFlag = '<div class="em-earnings-flag"><span class="em-earnings-badge ' + cls + '">&#9889; Earnings in ' + earnInfo.nextInDays + ' day' + (earnInfo.nextInDays !== 1 ? 's' : '') + (earnInfo.nextDate ? ' (' + earnInfo.nextDate + ')' : '') + '</span></div>';
    }

    var earningsMeta = '';
    if (earnInfo.nextDate || earnInfo.surprise != null) {
      var surpriseText = earnInfo.surprise != null ? ' · Last surprise ' + (earnInfo.surprise >= 0 ? '+' : '') + fmtNum(earnInfo.surprise, 1) + '%' : '';
      var beatsText = earnInfo.beats != null ? ' · Beats: ' + earnInfo.beats + '/4' : '';
      var dateText = earnInfo.nextDate ? earnInfo.nextDate : 'TBD';
      var dteText = earnInfo.nextInDays != null ? ' (' + earnInfo.nextInDays + 'd)' : '';
      earningsMeta = '<div class="em-range-text">Earnings: ' + dateText + dteText + surpriseText + beatsText + '</div>';
    }

    el.innerHTML =
      '<div class="em-price-header">' +
        '<span class="em-ticker-name">' + d.ticker + '</span>' +
        (d.sector ? '<span class="em-sector-tag">' + d.sector + (d.sectorETF ? ' &middot; ' + d.sectorETF : '') + '</span>' : '') +
      '</div>' +
      '<div class="em-price-large">$' + fmtNum(d.price) + '</div>' +
      '<div class="em-change ' + changeClass + '">' + changeSign + fmtNum(d.change) + ' (' + changeSign + fmtNum(d.changePercent) + '%)</div>' +
      earningsFlag +
      '<div class="em-move-section">' +
        '<div class="em-move-label">Expected Move (' + (opts.expirationDate || 'nearest expiry') + ')</div>' +
        '<div>' +
          '<span class="em-move-value">&plusmn;$' + fmtNum(d.expectedMove) + '</span>' +
          '<span class="em-move-pct">&plusmn;' + fmtNum(d.expectedMovePercent) + '%</span>' +
          '<span class="em-method-tag">' + (prob.method || 'ATM Straddle') + '</span>' +
        '</div>' +
        '<div class="em-range-text">Range: <strong>$' + fmtNum(d.rangeLow) + '</strong> &mdash; <strong>$' + fmtNum(d.rangeHigh) + '</strong></div>' +
        earningsMeta +
        renderRangeBar(d.price, d.rangeLow, d.rangeHigh) +
        '<div class="em-probability-row">' +
          '<div class="em-prob-badge"><span class="label">1SD Containment</span><span class="value clr-green">' + fmtNum(prob.containment, 1) + '%</span></div>' +
          '<div class="em-prob-badge"><span class="label">Breach Probability</span><span class="value clr-red">' + fmtNum(prob.breach, 1) + '%</span></div>' +
        '</div>' +
        '<div class="em-expiry-badge">' +
          (opts.daysToExpiry || 0) + ' day' + ((opts.daysToExpiry || 0) !== 1 ? 's' : '') + ' to expiry' +
          ' &middot; ' + (opts.callsCount || 0) + ' calls &middot; ' + (opts.putsCount || 0) + ' puts' +
          (d.beta != null ? ' &middot; &beta;=' + fmtNum(d.beta) : '') +
        '</div>' +
      '</div>';
  }

  function renderRangeBar(price, low, high) {
    if (!price || !low || !high || high <= low) return '';
    var margin = (high - low) * 0.25;
    var barLow = low - margin, barHigh = high + margin;
    var range = barHigh - barLow;
    if (range <= 0) return '';
    var pL = ((low - barLow) / range) * 100;
    var pP = ((price - barLow) / range) * 100;
    var pH = ((high - barLow) / range) * 100;
    return '<div class="em-range-bar-wrap"><div class="em-range-bar">' +
      '<div class="em-range-marker" style="left:' + pL + '%;background:var(--accent-red);"></div>' +
      '<div class="em-range-dot" style="left:' + pP + '%;"></div>' +
      '<div class="em-range-marker" style="left:' + pH + '%;background:var(--accent-green);"></div>' +
      '<div class="em-range-label low" style="left:' + pL + '%;">$' + fmtNum(low) + '</div>' +
      '<div class="em-range-label mid" style="left:' + pP + '%;">$' + fmtNum(price) + '</div>' +
      '<div class="em-range-label high" style="left:' + pH + '%;">$' + fmtNum(high) + '</div>' +
    '</div></div>';
  }

  // ── Rendering: Composite Score Card ──────────────────
  function renderScoreCard(d) {
    var el = document.getElementById('emScoreCard');
    if (!el) return;
    var scoring = d.scoring || {};
    var composite = scoring.composite || 0;
    var tier = scoring.tier || { label: '--', tier: 'avoid', color: '#6b7280' };
    var categories = scoring.categories || {};

    var circumference = 2 * Math.PI * 52;
    var dashOffset = circumference - (composite / 100) * circumference;

    var catBarsHtml = '';
    var keys = Object.keys(categories);
    for (var i = 0; i < keys.length; i++) {
      var cat = categories[keys[i]];
      catBarsHtml +=
        '<div class="em-cat-row">' +
          '<span class="em-cat-label">' + cat.label + '</span>' +
          '<div class="em-cat-bar-wrap"><div class="em-cat-bar-fill" style="width:' + cat.pct + '%;background:' + catBarColor(cat.pct) + ';"></div></div>' +
          '<span class="em-cat-score">' + cat.score + '/' + cat.max + '</span>' +
        '</div>';
    }

    el.innerHTML =
      '<div class="em-score-header"><span class="em-score-title">Composite Confidence Score</span></div>' +
      '<div class="em-composite-ring">' +
        '<svg width="120" height="120" viewBox="0 0 120 120">' +
          '<circle class="ring-bg" cx="60" cy="60" r="52" />' +
          '<circle class="ring-fill" cx="60" cy="60" r="52" stroke="' + tier.color + '" stroke-dasharray="' + circumference + '" stroke-dashoffset="' + dashOffset + '" />' +
        '</svg>' +
        '<span class="em-composite-number">' + composite + '</span>' +
      '</div>' +
      '<div class="em-tier-label ' + tierCssClass(tier.tier) + '">' + tier.label + '</div>' +
      '<div class="em-category-bars">' + catBarsHtml + '</div>';
  }

  // ── Rendering: ATM Options Card ──────────────────────
  function renderATMCard(d) {
    var el = document.getElementById('emATMCard');
    if (!el) return;
    var opts = d.options || {};
    var liqCat = d.scoring && d.scoring.categories && d.scoring.categories.liquidity;
    var pillHtml = liqCat ? '<span class="em-cat-pill" style="background:' + catBarColor(liqCat.pct) + '22;color:' + catBarColor(liqCat.pct) + '">' + liqCat.score + '/' + liqCat.max + '</span>' : '';

    el.innerHTML =
      '<h3>ATM Options ' + pillHtml + '</h3>' +
      '<div class="em-atm-grid">' +
        renderATMSide('ATM Call', opts.atmCall) +
        renderATMSide('ATM Put', opts.atmPut) +
      '</div>' +
      '<div style="margin-top:14px;">' +
        '<div class="em-atm-row"><span class="label">Straddle Mid</span><span class="value">$' + fmtNum(d.straddleMid) + '</span></div>' +
        '<div class="em-atm-row"><span class="label">IV-Derived EM</span><span class="value">$' + fmtNum(d.ivExpectedMove) + '</span></div>' +
        '<div class="em-atm-row"><span class="label">ATM Strike</span><span class="value">$' + fmtNum(opts.atmStrike) + '</span></div>' +
      '</div>';
  }

  function renderATMSide(title, data) {
    if (!data) return '<div class="em-atm-card"><h4>' + title + '</h4><div style="color:var(--text-muted);">Not available</div></div>';
    var iv = data.iv != null ? (data.iv * 100).toFixed(1) + '%' : '--';
    var bidAskZero = (data.bid === 0 && data.ask === 0);
    var lastRow = (bidAskZero && data.lastPrice) ?
      '<div class="em-atm-row"><span class="label">Last Price</span><span class="value" style="color:var(--accent-orange);">$' + fmtNum(data.lastPrice) + '</span></div>' : '';
    return '<div class="em-atm-card">' +
      '<h4>' + title + ' &mdash; $' + fmtNum(data.strike) + '</h4>' +
      '<div class="em-atm-row"><span class="label">Bid / Ask</span><span class="value">$' + fmtNum(data.bid) + ' / $' + fmtNum(data.ask) + '</span></div>' +
      lastRow +
      '<div class="em-atm-row"><span class="label">Mid</span><span class="value">$' + fmtNum(data.mid) + '</span></div>' +
      '<div class="em-atm-row"><span class="label">IV</span><span class="value">' + iv + '</span></div>' +
      '<div class="em-atm-row"><span class="label">Volume</span><span class="value">' + fmtInt(data.volume) + '</span></div>' +
      '<div class="em-atm-row"><span class="label">Open Interest</span><span class="value">' + fmtInt(data.openInterest) + '</span></div>' +
    '</div>';
  }

  // ── Rendering: Volatility Context Card ───────────────
  function renderVolCard(d) {
    var el = document.getElementById('emVolCard');
    if (!el) return;
    var vol = d.volatility || {};
    var volCat = d.scoring && d.scoring.categories && d.scoring.categories.volatility;
    var pillHtml = volCat ? '<span class="em-cat-pill" style="background:' + catBarColor(volCat.pct) + '22;color:' + catBarColor(volCat.pct) + '">' + volCat.score + '/' + volCat.max + '</span>' : '';

    var rank = vol.hvRank;
    var gaugeColor = rank == null ? 'var(--text-muted)' : rank < 25 ? 'var(--accent-blue)' : rank < 50 ? 'var(--accent-green)' : rank < 75 ? 'var(--accent-orange)' : 'var(--accent-red)';
    var rankLabel = rank == null ? '--' : rank < 25 ? 'Low' : rank < 50 ? 'Normal' : rank < 75 ? 'Elevated' : 'High';
    var spreadColor = vol.ivHvSpread != null ? (vol.ivHvSpread > 0 ? 'var(--accent-orange)' : 'var(--accent-green)') : 'var(--text-primary)';
    var spreadLabel = vol.ivHvSpread != null ? (vol.ivHvSpread > 0 ? '(IV premium)' : '(IV discount)') : '';

    el.innerHTML =
      '<h3>Volatility Context ' + pillHtml + '</h3>' +
      '<div style="margin-bottom:8px;font-weight:700;color:var(--text-primary);">HV Rank: <span style="color:' + gaugeColor + ';">' + (rank != null ? fmtNum(rank, 1) : '--') + ' &mdash; ' + rankLabel + '</span></div>' +
      '<div class="em-iv-gauge"><div class="em-iv-gauge-fill" style="width:' + Math.max(rank || 0, 3) + '%;background:' + gaugeColor + ';"></div></div>' +
      '<div class="em-iv-labels"><span>0 &mdash; Low</span><span>50 &mdash; Normal</span><span>100 &mdash; High</span></div>' +
      '<div style="margin-top:14px;">' +
        '<div class="em-iv-stat"><span class="label">ATM Implied Volatility</span><span class="value">' + (vol.avgIV != null ? vol.avgIV + '%' : '--') + '</span></div>' +
        '<div class="em-iv-stat"><span class="label">20-day HV (annualized)</span><span class="value">' + (vol.hvCurrent20 != null ? vol.hvCurrent20 + '%' : '--') + '</span></div>' +
        '<div class="em-iv-stat"><span class="label">IV vs HV Spread</span><span class="value" style="color:' + spreadColor + ';">' + (vol.ivHvSpread != null ? (vol.ivHvSpread > 0 ? '+' : '') + vol.ivHvSpread + '% ' + spreadLabel : '--') + '</span></div>' +
        '<div class="em-iv-stat"><span class="label">52W HV Range</span><span class="value">' + (vol.hvLow52w != null ? vol.hvLow52w + '% &mdash; ' + vol.hvHigh52w + '%' : '--') + '</span></div>' +
      '</div>';
  }

  // ── Rendering: Market Regime Card ────────────────────
  function renderMarketCard(d) {
    var el = document.getElementById('emMarketCard');
    if (!el) return;
    var mkt = d.market || {};
    var ba = d.betaAdjusted || {};
    var mktCat = d.scoring && d.scoring.categories && d.scoring.categories.marketRegime;
    var pillHtml = mktCat ? '<span class="em-cat-pill" style="background:' + catBarColor(mktCat.pct) + '22;color:' + catBarColor(mktCat.pct) + '">' + mktCat.score + '/' + mktCat.max + '</span>' : '';
    var biasClass = mkt.bias === 'bullish' ? 'em-bias-bullish' : mkt.bias === 'bearish' ? 'em-bias-bearish' : 'em-bias-neutral';

    var betaHtml = '';
    if (ba.beta != null) {
      betaHtml =
        '<div class="em-context-row"><span class="label">Beta</span><span class="value">' + fmtNum(ba.beta) + '</span></div>' +
        '<div class="em-context-row"><span class="label">Beta-Adj Market Move</span><span class="value">' + fmtNum(ba.betaAdjustedMove) + '%</span></div>' +
        (ba.alphaComponent != null ? '<div class="em-context-row"><span class="label">Alpha Component</span><span class="value">' + (ba.alphaComponent > 0 ? '+' : '') + fmtNum(ba.alphaComponent) + '%</span></div>' : '');
    }

    el.innerHTML =
      '<h3>Market Regime ' + pillHtml + '</h3>' +
      '<div class="em-context-row"><span class="label">Market Bias</span><span class="value ' + biasClass + '" style="text-transform:capitalize;">' + (mkt.bias || '--') + '</span></div>' +
      '<div class="em-context-row"><span class="label">VIX</span><span class="value">' + (mkt.vix != null ? fmtNum(mkt.vix, 1) : '--') + '</span></div>' +
      '<div class="em-context-row"><span class="label">SPY Change</span><span class="value" style="color:' + ((mkt.spyChange || 0) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)') + ';">' + (mkt.spyChange != null ? (mkt.spyChange >= 0 ? '+' : '') + fmtNum(mkt.spyChange) + '%' : '--') + '</span></div>' +
      betaHtml +
      (mkt.biasReasons && mkt.biasReasons.length ? '<div style="margin-top:10px;font-size:0.78rem;color:var(--text-muted);">' + mkt.biasReasons.join(' &middot; ') + '</div>' : '');
  }

  // ── Rendering: Technical Alignment Card ──────────────
  function renderTechCard(d) {
    var el = document.getElementById('emTechCard');
    if (!el) return;
    var tech = d.technicals || {};
    var techCat = d.scoring && d.scoring.categories && d.scoring.categories.technical;
    var pillHtml = techCat ? '<span class="em-cat-pill" style="background:' + catBarColor(techCat.pct) + '22;color:' + catBarColor(techCat.pct) + '">' + techCat.score + '/' + techCat.max + '</span>' : '';

    function smaRow(label, value, above) {
      var dot = above === true ? '🟢' : above === false ? '🔴' : '⚪';
      return '<div class="em-context-row"><span class="label">' + label + '</span><span class="value">' + dot + ' $' + (value != null ? fmtNum(value) : '--') + '</span></div>';
    }

    el.innerHTML =
      '<h3>Technical Alignment ' + pillHtml + '</h3>' +
      smaRow('SMA 20', tech.sma20, tech.aboveSMA20) +
      smaRow('SMA 50', tech.sma50, tech.aboveSMA50) +
      smaRow('SMA 200', tech.sma200, tech.aboveSMA200) +
      '<div class="em-context-row"><span class="label">ATR (14)</span><span class="value">$' + (tech.atr14 != null ? fmtNum(tech.atr14) : '--') + '</span></div>' +
      '<div class="em-context-row"><span class="label">EM / ATR Ratio</span><span class="value">' + (tech.emAtrRatio != null ? tech.emAtrRatio + 'x' : '--') + '</span></div>' +
      '<div class="em-context-row"><span class="label">52W High</span><span class="value">$' + (tech.high52w != null ? fmtNum(tech.high52w) : '--') + '</span></div>' +
      '<div class="em-context-row"><span class="label">52W Low</span><span class="value">$' + (tech.low52w != null ? fmtNum(tech.low52w) : '--') + '</span></div>';
  }

  // ── Rendering: Sector Context Card ───────────────────
  function renderSectorCard(d) {
    var el = document.getElementById('emSectorCard');
    if (!el) return;
    var sec = d.sectorContext || {};
    var secCat = d.scoring && d.scoring.categories && d.scoring.categories.sector;
    var pillHtml = secCat ? '<span class="em-cat-pill" style="background:' + catBarColor(secCat.pct) + '22;color:' + catBarColor(secCat.pct) + '">' + secCat.score + '/' + secCat.max + '</span>' : '';
    var news = d.newsSummary || {};

    el.innerHTML =
      '<h3>Sector &amp; Context ' + pillHtml + '</h3>' +
      '<div class="em-context-row"><span class="label">Sector</span><span class="value">' + (d.sector || '--') + '</span></div>' +
      '<div class="em-context-row"><span class="label">Sector ETF</span><span class="value">' + (sec.etf || '--') + '</span></div>' +
      '<div class="em-context-row"><span class="label">Sector Change</span><span class="value" style="color:' + ((sec.sectorChange || 0) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)') + ';">' + (sec.sectorChange != null ? (sec.sectorChange >= 0 ? '+' : '') + fmtNum(sec.sectorChange) + '%' : '--') + '</span></div>' +
      '<div class="em-context-row"><span class="label">Relative Strength</span><span class="value" style="color:' + ((sec.relativeStrength || 0) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)') + ';">' + (sec.relativeStrength != null ? (sec.relativeStrength >= 0 ? '+' : '') + fmtNum(sec.relativeStrength) + '%' : '--') + '</span></div>' +
      '<div style="margin-top:14px;padding-top:10px;border-top:1px solid var(--border-color);">' +
        '<div class="em-context-row"><span class="label">News (24h)</span><span class="value">' + (news.recent24h || 0) + ' articles</span></div>' +
        '<div class="em-context-row"><span class="label">Breaking News</span><span class="value">' + (news.hasBreaking ? '<span class="clr-red">&#9889; Yes</span>' : '<span class="clr-muted">No</span>') + '</span></div>' +
      '</div>';
  }

  // ── Rendering: Full Scoring Breakdown ────────────────
  function renderBreakdown(d) {
    var el = document.getElementById('emBreakdownCard');
    if (!el) return;
    var scoring = d.scoring || {};
    var categories = scoring.categories || {};

    var gridHtml = '';
    var keys = Object.keys(categories);
    for (var i = 0; i < keys.length; i++) {
      var cat = categories[keys[i]];
      var pct = cat.pct || 0;
      var color = catBarColor(pct);
      var factorsHtml = '';
      var bd = cat.breakdown || [];
      for (var j = 0; j < bd.length; j++) {
        var f = bd[j];
        factorsHtml +=
          '<div class="em-bd-factor">' +
            '<span class="em-bd-factor-name">' + f.factor + '</span>' +
            '<span class="em-bd-factor-note">' + f.note + '</span>' +
            '<span class="em-bd-factor-pts" style="color:' + (f.points > 0 ? 'var(--accent-green)' : 'var(--text-muted)') + ';">+' + f.points + '</span>' +
          '</div>';
      }
      gridHtml +=
        '<div class="em-bd-category">' +
          '<div class="em-bd-header">' +
            '<span class="em-bd-title">' + cat.label + '</span>' +
            '<span class="em-bd-score" style="background:' + color + '22;color:' + color + ';">' + cat.score + '/' + cat.max + '</span>' +
          '</div>' +
          factorsHtml +
        '</div>';
    }

    el.innerHTML =
      '<h3>Scoring Breakdown &mdash; ' + (scoring.composite || 0) + '/100 (' + (scoring.tier && scoring.tier.label || '--') + ')</h3>' +
      '<div class="em-breakdown-grid">' + gridHtml + '</div>';
  }

  // ── Rendering: Main Analysis Display ─────────────────
  function renderAnalysis(ticker) {
    var d = tickerData[ticker];
    console.log('[EM-Engine] renderAnalysis:', ticker, d ? (d.loading ? 'loading' : d._error ? 'error:'+d._error : 'ready') : 'no-data');
    var heroGrid = document.getElementById('emHeroGrid');
    var analysisGrid = document.getElementById('emAnalysisGrid');
    var contextGrid = document.getElementById('emContextGrid');
    var breakdownPanel = document.getElementById('emBreakdownPanel');

    if (!d || d.loading) {
      if (heroGrid) heroGrid.style.display = '';
      document.getElementById('emPriceCard').innerHTML = '<div class="em-skeleton em-skeleton-block"></div>';
      document.getElementById('emScoreCard').innerHTML = '<div class="em-skeleton em-skeleton-block"></div>';
      if (analysisGrid) analysisGrid.style.display = 'none';
      if (contextGrid) contextGrid.style.display = 'none';
      if (breakdownPanel) breakdownPanel.style.display = 'none';
      return;
    }

    if (d._error) {
      if (heroGrid) heroGrid.style.display = '';
      document.getElementById('emPriceCard').innerHTML = '<div class="em-error-msg">' + d._error + '</div>';
      document.getElementById('emScoreCard').innerHTML = '';
      if (analysisGrid) analysisGrid.style.display = 'none';
      if (contextGrid) contextGrid.style.display = 'none';
      if (breakdownPanel) breakdownPanel.style.display = 'none';
      return;
    }

    if (heroGrid) heroGrid.style.display = '';
    if (analysisGrid) analysisGrid.style.display = '';
    if (contextGrid) contextGrid.style.display = '';
    if (breakdownPanel) breakdownPanel.style.display = '';

    try { renderPriceCard(d); } catch (e) { console.error('[EM-Engine] renderPriceCard error:', e); }
    try { renderScoreCard(d); } catch (e) { console.error('[EM-Engine] renderScoreCard error:', e); }
    try { renderATMCard(d); } catch (e) { console.error('[EM-Engine] renderATMCard error:', e); }
    try { renderVolCard(d); } catch (e) { console.error('[EM-Engine] renderVolCard error:', e); }
    try { renderMarketCard(d); } catch (e) { console.error('[EM-Engine] renderMarketCard error:', e); }
    try { renderTechCard(d); } catch (e) { console.error('[EM-Engine] renderTechCard error:', e); }
    try { renderSectorCard(d); } catch (e) { console.error('[EM-Engine] renderSectorCard error:', e); }
    try { renderBreakdown(d); } catch (e) { console.error('[EM-Engine] renderBreakdown error:', e); }
  }

  // ── Rendering: Watchlist Table ───────────────────────
  function renderWatchlistTable() {
    var tbody = document.getElementById('emWatchlistBody');
    var emptyEl = document.getElementById('emWatchlistEmpty');
    if (!tbody) return;
    if (!watchlist.length) {
      tbody.innerHTML = '';
      if (emptyEl) emptyEl.style.display = '';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    tbody.innerHTML = watchlist.map(function (t) {
      var d = tickerData[t];
      if (!d || d.loading) {
        return '<tr id="em-row-' + t + '"><td><strong>' + t + '</strong></td><td colspan="11"><div class="em-skeleton em-skeleton-line" style="width:80%;height:14px;"></div></td><td><button class="em-remove-btn" onclick="event.stopPropagation();ExpectedMove.removeTicker(\'' + t + '\')">Remove</button></td></tr>';
      }
      return buildWatchlistRow(t, d);
    }).join('');
  }

  function renderWatchlistRow(ticker) {
    var row = document.getElementById('em-row-' + ticker);
    var d = tickerData[ticker];
    if (!row || !d) return;
    var temp = document.createElement('tbody');
    temp.innerHTML = buildWatchlistRow(ticker, d);
    if (temp.firstChild) row.replaceWith(temp.firstChild);
  }

  function getUnifiedWatchlistSymbols() {
    var combined = Array.isArray(watchlist) ? watchlist.slice() : [];
    if (window.WATCHLIST && typeof WATCHLIST.getList === 'function') {
      try {
        combined = combined.concat((WATCHLIST.getList() || []).map(function (item) { return item.symbol; }));
      } catch (e) { /* ignore */ }
    }
    return Array.from(new Set(combined.filter(Boolean)));
  }

  function renderAllWatchlists() {
    var container = document.getElementById('emAllWatchlistList');
    var empty = document.getElementById('emAllWatchlistEmpty');
    var meta = document.getElementById('emAllWatchlistMeta');
    if (!container) return;
    var symbols = getUnifiedWatchlistSymbols();
    if (!symbols.length) {
      container.innerHTML = '';
      if (meta) meta.textContent = '';
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';
    if (meta) meta.textContent = symbols.length + ' symbols';
    symbols.sort();
    container.innerHTML = symbols.map(function (sym) {
      return '<button class="em-quick-btn" onclick="ExpectedMove.quickLookup(\'' + sym + '\')">' + sym + '</button>';
    }).join('');
  }

  function buildWatchlistRow(ticker, d) {
    if (d._error) {
      return '<tr id="em-row-' + ticker + '"><td><strong>' + ticker + '</strong></td><td colspan="11" style="color:var(--text-muted);font-size:0.85em;">' + d._error + '</td><td><button class="em-remove-btn" onclick="event.stopPropagation();ExpectedMove.removeTicker(\'' + ticker + '\')">Remove</button></td></tr>';
    }
    var price = d.price;
    var change = d.changePercent;
    var em = d.expectedMove;
    var emPct = d.expectedMovePercent;
    var avgIV = d.volatility ? d.volatility.avgIV : null;
    var hvRank = d.volatility ? d.volatility.hvRank : null;
    var expiry = (d.options && d.options.expirationDate) || '--';
    var earnInfo = getEarningsInfo(d);
    var earningsDays = earnInfo.nextInDays;
    var earningsDate = earnInfo.nextDate;
    var surprise = earnInfo.surprise;
    var scoring = d.scoring || {};
    var composite = scoring.composite || 0;
    var tier = scoring.tier || { tier: 'avoid', label: 'Avoid' };

    var ivClass = ivCellClass(hvRank);
    var hasEarnings = earningsDays != null && earningsDays > 0 && earningsDays <= 21;
    var rowClass = hasEarnings && earningsDays <= 7 ? 'em-row-highlight' : '';

    var changeHtml = '--';
    if (change != null) {
      var sign = change >= 0 ? '+' : '';
      var color = change >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
      changeHtml = '<span style="color:' + color + ';font-weight:600;">' + sign + fmtNum(change) + '%</span>';
    }

    var earningsHtml = '--';
    if (earningsDate || earningsDays != null) {
      var cls = earningsDays != null && earningsDays <= 7 ? 'danger' : 'warning';
      var badge = (earningsDays != null && earningsDays > 0 && earningsDays <= 60)
        ? '<span class="em-earnings-badge ' + cls + '">&#9889; ' + earningsDays + 'd</span>'
        : '';
      earningsHtml = '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">' +
        (badge || '') +
        '<span style="font-size:0.82rem;color:var(--text-secondary);">' + (earningsDate || 'TBD') + '</span>' +
      '</div>';
    }

    var surpriseHtml = '--';
    if (surprise != null) {
      var sSign = surprise >= 0 ? '+' : '';
      var sColor = surprise >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
      surpriseHtml = '<span style="color:' + sColor + ';font-weight:600;">' + sSign + fmtNum(surprise, 1) + '%</span>';
      if (earnInfo.lastPeriod) {
        surpriseHtml += '<div style="color:var(--text-muted);font-size:0.76rem;">' + earnInfo.lastPeriod + '</div>';
      }
    }

    var scoreHtml = '<span class="em-score-compact ' + scoreCssClass(tier.tier) + '">' + composite + '</span>';
    var tierHtml = '<span class="em-score-compact ' + scoreCssClass(tier.tier) + '" style="font-weight:500;font-size:0.78rem;">' + tier.label + '</span>';

    return '<tr id="em-row-' + ticker + '" class="' + rowClass + '" onclick="ExpectedMove.quickLookup(\'' + ticker + '\')">' +
      '<td><strong style="color:var(--accent-blue);">' + ticker + '</strong></td>' +
      '<td>' + (price != null ? '$' + fmtNum(price) : '--') + '</td>' +
      '<td>' + changeHtml + '</td>' +
      '<td>' + (em != null ? '&plusmn;$' + fmtNum(em) : '--') + '</td>' +
      '<td>' + (emPct != null ? '&plusmn;' + fmtNum(emPct) + '%' : '--') + '</td>' +
      '<td>' + (avgIV != null ? '<span class="em-iv-cell ' + ivClass + '">' + fmtNum(avgIV, 1) + '%</span>' : '--') + '</td>' +
      '<td>' + (hvRank != null ? '<span class="em-iv-cell ' + ivClass + '">' + fmtNum(hvRank, 0) + '</span>' : '--') + '</td>' +
      '<td style="font-size:0.85em;">' + expiry + '</td>' +
      '<td>' + earningsHtml + '</td>' +
      '<td>' + surpriseHtml + '</td>' +
      '<td>' + scoreHtml + '</td>' +
      '<td>' + tierHtml + '</td>' +
      '<td><button class="em-remove-btn" onclick="event.stopPropagation();ExpectedMove.removeTicker(\'' + ticker + '\')">Remove</button></td>' +
    '</tr>';
  }

  // ── Auto-Refresh ─────────────────────────────────────
  function startAutoRefresh() {
    stopAutoRefresh();
    nextRefreshAt = Date.now() + REFRESH_INTERVAL;
    refreshTimer = setTimeout(async function () {
      await doRefreshAll();
      startAutoRefresh();
    }, REFRESH_INTERVAL);
    countdownTimer = setInterval(updateCountdown, 1000);
    updateCountdown();
  }
  function stopAutoRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    if (countdownTimer) clearInterval(countdownTimer);
  }
  function updateCountdown() {
    var el = document.getElementById('emCountdownText');
    if (!el) return;
    var remaining = Math.max(0, nextRefreshAt - Date.now());
    var min = Math.floor(remaining / 60000);
    var sec = Math.floor((remaining % 60000) / 1000);
    el.textContent = 'Auto-refresh: ' + min + ':' + String(sec).padStart(2, '0');
  }

  // ── Actions ──────────────────────────────────────────
  async function lookupTicker() {
    var input = document.getElementById('emTickerInput');
    var raw = (input ? input.value : '').trim().toUpperCase();
    if (!raw) return;
    currentTicker = raw;
    localStorage.setItem(LAST_TICKER_KEY, raw);
    input.value = raw;
    renderAnalysis(raw);
    await fetchTickerData(raw);
    renderAnalysis(raw);
  }

  async function quickLookup(ticker) {
    console.log('[EM-Engine] quickLookup:', ticker);
    var t = ticker.toUpperCase();
    var input = document.getElementById('emTickerInput');
    if (input) input.value = t;
    currentTicker = t;
    localStorage.setItem(LAST_TICKER_KEY, t);
    renderAnalysis(t);
    await fetchTickerData(t);
    console.log('[EM-Engine] Data fetched, rendering:', t, tickerData[t] ? 'has data' : 'no data', tickerData[t] && tickerData[t]._error);
    renderAnalysis(t);
  }

  function addTicker() {
    var input = document.getElementById('emAddInput');
    var raw = (input ? input.value : '').trim().toUpperCase();
    if (!raw) return;
    if (watchlist.indexOf(raw) !== -1) { input.value = ''; return; }
    watchlist.push(raw);
    saveWatchlist();
    input.value = '';
    if (window.WATCHLIST) WATCHLIST.add(raw, 'expected-move');
    renderWatchlistTable();
    renderAllWatchlists();
    fetchTickerData(raw).then(function () { renderWatchlistRow(raw); });
  }

  function removeTicker(ticker) {
    watchlist = watchlist.filter(function (t) { return t !== ticker; });
    delete tickerData[ticker];
    saveWatchlist();
    if (window.WATCHLIST) WATCHLIST.remove(ticker);
    renderWatchlistTable();
    renderAllWatchlists();
  }

  async function doRefreshAll() {
    try {
      if (currentTicker) {
        await fetchTickerData(currentTicker);
        renderAnalysis(currentTicker);
      }
      await fetchAllWatchlistData();
    } catch (e) {
      console.error('[EM-Engine] refresh error:', e);
    }
  }

  async function refreshAll() {
    startAutoRefresh();
    await doRefreshAll();
  }

  // ── Sort ─────────────────────────────────────────────
  function getSortValue(ticker, column) {
    var d = tickerData[ticker];
    if (!d) return column === 'ticker' ? ticker : -Infinity;
    switch (column) {
      case 'ticker': return ticker;
      case 'price': return d.price != null ? d.price : -Infinity;
      case 'change': return d.changePercent != null ? d.changePercent : -Infinity;
      case 'em': return d.expectedMove != null ? d.expectedMove : -Infinity;
      case 'emPct': return d.expectedMovePercent != null ? d.expectedMovePercent : -Infinity;
      case 'iv': return (d.volatility && d.volatility.avgIV != null) ? d.volatility.avgIV : -Infinity;
      case 'hvRank': return (d.volatility && d.volatility.hvRank != null) ? d.volatility.hvRank : -Infinity;
      case 'expiry': return (d.options && d.options.expirationDate) || '';
      case 'earnings': {
        var earn = getEarningsInfo(d);
        return earn.nextInDays != null ? earn.nextInDays : Infinity;
      }
      case 'surprise': {
        var e2 = getEarningsInfo(d);
        return e2.surprise != null ? e2.surprise : -Infinity;
      }
      case 'composite': return (d.scoring && d.scoring.composite != null) ? d.scoring.composite : -Infinity;
      case 'tier': return (d.scoring && d.scoring.composite != null) ? d.scoring.composite : -Infinity;
      default: return 0;
    }
  }

  function sortWatchlist(column) {
    if (sortState.column === column) {
      sortState.direction = sortState.direction === 'desc' ? 'asc' : 'desc';
    } else {
      sortState.column = column;
      sortState.direction = 'desc';
    }
    watchlist.sort(function (a, b) {
      var va = getSortValue(a, column);
      var vb = getSortValue(b, column);
      var cmp;
      if (typeof va === 'string' && typeof vb === 'string') cmp = va.localeCompare(vb);
      else cmp = (va < vb ? -1 : va > vb ? 1 : 0);
      return sortState.direction === 'asc' ? cmp : -cmp;
    });
    saveWatchlist();
    renderWatchlistTable();
    updateSortIndicators();
  }

  function updateSortIndicators() {
    var table = document.getElementById('emWatchlistTable');
    if (!table) return;
    table.querySelectorAll('th[data-sort]').forEach(function (th) {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.sort === sortState.column) {
        th.classList.add(sortState.direction === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });
  }

  function initSortHeaders() {
    var table = document.getElementById('emWatchlistTable');
    if (!table) return;
    table.querySelectorAll('th[data-sort]').forEach(function (th) {
      th.addEventListener('click', function () { sortWatchlist(th.dataset.sort); });
    });
  }

  // ── Export ───────────────────────────────────────────
  function exportWatchlist() {
    if (!watchlist.length) return;
    var headers = ['Ticker', 'Price', 'Change %', 'Exp Move $', 'Exp Move %', 'ATM IV', 'HV Rank', 'Expiry', 'Earnings Date', 'Earnings Days', 'Surprise %', 'Composite', 'Tier'];
    var rows = watchlist.map(function (t) {
      var d = tickerData[t];
      if (!d || d._error) return [t, '', '', '', '', '', '', '', '', '', '', '', ''].join(',');
      var earn = getEarningsInfo(d);
      return [
        t,
        d.price != null ? d.price : '',
        d.changePercent != null ? d.changePercent.toFixed(2) : '',
        d.expectedMove != null ? d.expectedMove : '',
        d.expectedMovePercent != null ? d.expectedMovePercent : '',
        d.volatility && d.volatility.avgIV != null ? d.volatility.avgIV.toFixed(1) : '',
        d.volatility && d.volatility.hvRank != null ? d.volatility.hvRank.toFixed(0) : '',
        (d.options && d.options.expirationDate) || '',
        earn.nextDate || '',
        earn.nextInDays != null ? earn.nextInDays : '',
        earn.surprise != null ? earn.surprise.toFixed(1) : '',
        d.scoring ? d.scoring.composite : '',
        d.scoring && d.scoring.tier ? d.scoring.tier.label : ''
      ].join(',');
    });
    var csv = [headers.join(',')].concat(rows).join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'expected-move-engine-' + new Date().toISOString().split('T')[0] + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Initialization ───────────────────────────────────
  async function init() {
    console.log('[EM-Engine] init() called');
    loadWatchlist();
    console.log('[EM-Engine] Watchlist loaded:', watchlist);
    if (window.WATCHLIST && watchlist.length) {
      watchlist.forEach(function (t) { WATCHLIST.add(t, 'expected-move'); });
    }
    renderWatchlistTable();
    renderAllWatchlists();
    initSortHeaders();
    startAutoRefresh();
    if (window.lucide) lucide.createIcons();

    if (window.WATCHLIST && typeof WATCHLIST.onChange === 'function') {
      WATCHLIST.onChange(function () { renderAllWatchlists(); });
    }

    var saved = localStorage.getItem(LAST_TICKER_KEY) || DEFAULT_TICKER;
    var input = document.getElementById('emTickerInput');
    if (input) input.value = saved;
    currentTicker = saved;
    renderAnalysis(saved);
    try {
      await fetchTickerData(saved);
      renderAnalysis(saved);
    } catch (e) {
      console.error('[EM-Engine] init fetch error:', e);
    }
    if (watchlist.length) {
      try { await fetchAllWatchlistData(); } catch (e) { console.error('[EM-Engine] watchlist fetch error:', e); }
    }
  }

  // ── Public API ───────────────────────────────────────
  window.ExpectedMove = {
    init: init,
    lookupTicker: lookupTicker,
    quickLookup: quickLookup,
    addTicker: addTicker,
    removeTicker: removeTicker,
    refreshAll: refreshAll,
    sortWatchlist: sortWatchlist,
    exportWatchlist: exportWatchlist
  };

  window.addEventListener('DOMContentLoaded', init);
})();
