// ─── AI Quant Scoring Engine (Rule-Based, No Fake Probabilities) ───
// Every compute function now returns { score, breakdown[], dataQuality }

// ── Finviz Field-Name Normalisation ──
// The Finviz CSV export returns full-length header names (e.g. "Relative Volume").
// The rest of the codebase references short aliases (e.g. "Rel Volume").
// normalizeFinvizRow() copies every value under a short alias so downstream code
// works regardless of which view / column set the API returned.
const FIELD_ALIASES = {
  'Relative Volume':                'Rel Volume',
  'Average True Range':             'ATR',
  'Relative Strength Index (14)':   'RSI',
  'Average Volume':                 'Avg Volume',
  '20-Day Simple Moving Average':   'SMA20',
  '50-Day Simple Moving Average':   'SMA50',
  '200-Day Simple Moving Average':  'SMA200',
  '52-Week High':                   '52W High',
  '52-Week Low':                    '52W Low',
  'Shares Float':                   'Float',
  'Shares Outstanding':             'Shares Out',
  'Change from Open':               'Change Open',
  'Volatility (Week)':              'Volatility W',
  'Volatility (Month)':             'Volatility M',
  'Insider Ownership':              'Insider Own',
  'Institutional Ownership':        'Inst Own',
  'Short Ratio':                    'Short Ratio',
  'Earnings Date':                  'Earnings',
  'Analyst Recom':                  'Recom',
  'Target Price':                   'Target Price',
  'Performance (Week)':             'Perf Week',
  'Performance (Month)':            'Perf Month',
  'Performance (Quarter)':          'Perf Quarter',
  'Performance (Half Year)':        'Perf Half Y',
  'Performance (Year)':             'Perf Year',
  'Performance (YTD)':              'Perf YTD',
};

export function normalizeFinvizRow(row) {
  if (!row) return row;
  const out = { ...row };
  for (const [long, short] of Object.entries(FIELD_ALIASES)) {
    if (row[long] !== undefined && out[short] === undefined) {
      out[short] = row[long];
    }
  }
  return out;
}

// Parse Finviz volume strings like "52.30M" → 52300000, null if missing
export function parseVolume(str) {
  if (!str) return null;
  const s = String(str).replace(/,/g, '').trim();
  const num = parseFloat(s);
  if (isNaN(num)) return null;
  if (s.endsWith('B')) return num * 1e9;
  if (s.endsWith('M')) return num * 1e6;
  if (s.endsWith('K')) return num * 1e3;
  return num;
}

// Parse percent strings like "5.30%" → 5.3, null if missing
export function parsePct(str) {
  if (str == null || str === '' || str === '-') return null;
  const v = parseFloat(String(str).replace('%', ''));
  return isNaN(v) ? null : v;
}

// Formatting helpers
export function fmtVol(n) {
  if (n == null) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}
export function fmt(v, dec = 2) { return v != null ? Number(v).toFixed(dec) : '—'; }
export function fmtPct(v, dec = 2) { return v != null ? `${v >= 0 ? '+' : ''}${Number(v).toFixed(dec)}%` : '—'; }

// Data quality: derived from available factor count
export function computeDataQuality(availableCount, totalCount) {
  if (!totalCount) return 'Low';
  const ratio = availableCount / totalCount;
  if (ratio >= 0.85) return 'High';
  if (ratio >= 0.5) return 'Medium';
  return 'Low';
}

// Normalize raw score when some factors have missing data
// If availableMax < 40% of totalMax, cap at raw score (don't inflate sparse data)
function normalizeScore(rawScore, availableMax, totalMax) {
  if (availableMax <= 0) return 0;
  if (availableMax >= totalMax) return Math.min(100, rawScore);
  if (availableMax < totalMax * 0.4) return Math.min(100, rawScore);
  return Math.min(100, Math.round((rawScore / availableMax) * 100));
}

// ── ORB Intraday Score (0–100) — returns { score, breakdown, dataQuality, availableMax } ──
export function computeORBScore(row) {
  const breakdown = [];
  let rawScore = 0;
  const TOTAL_MAX = 100;

  const rawGap = parsePct(row['Gap'] || row['Change']);
  const hasGap = rawGap != null;
  const gap = hasGap ? Math.abs(rawGap) : 0;
  const rawRvol = parseFloat(row['Rel Volume']);
  const hasRvol = isFinite(rawRvol) && rawRvol > 0;
  const rvol = hasRvol ? rawRvol : 0;
  const rawAtr = parseFloat(row['ATR']);
  const rawPrice = parseFloat(row['Price']);
  const hasAtr = isFinite(rawAtr) && rawAtr > 0 && isFinite(rawPrice) && rawPrice > 0;
  const atr = hasAtr ? rawAtr : 0;
  const price = hasAtr ? rawPrice : 0;
  const avgVol = parseVolume(row['Avg Volume']);
  const hasAvgVol = avgVol != null && avgVol > 0;
  const rawRsi = parseFloat(row['RSI']);
  const hasRsi = isFinite(rawRsi);
  const rsi = hasRsi ? rawRsi : 50;

  // Gap Size (0–30)
  let pts = 0;
  if (hasGap) { if (gap >= 8) pts = 30; else if (gap >= 5) pts = 24; else if (gap >= 3) pts = 18; else if (gap >= 1) pts = 10; }
  rawScore += pts;
  breakdown.push({ factor: 'Gap%', value: hasGap ? `${gap.toFixed(1)}%` : '—', pts, max: 30, rule: '≥8→30 ≥5→24 ≥3→18 ≥1→10', available: hasGap });

  // Relative Volume (0–30)
  pts = 0;
  if (hasRvol) { if (rvol >= 5) pts = 30; else if (rvol >= 3) pts = 24; else if (rvol >= 2) pts = 18; else if (rvol >= 1.5) pts = 12; else if (rvol >= 1) pts = 6; }
  rawScore += pts;
  breakdown.push({ factor: 'RVOL', value: hasRvol ? rvol.toFixed(2) : '—', pts, max: 30, rule: '≥5→30 ≥3→24 ≥2→18 ≥1.5→12', available: hasRvol });

  // ATR / Price % (0–15)
  const atrPct = hasAtr ? (atr / price) * 100 : 0;
  pts = 0;
  if (hasAtr) { if (atrPct >= 4) pts = 15; else if (atrPct >= 3) pts = 12; else if (atrPct >= 2) pts = 8; else if (atrPct >= 1) pts = 4; }
  rawScore += pts;
  breakdown.push({ factor: 'ATR/Price', value: hasAtr ? `${atrPct.toFixed(1)}%` : '—', pts, max: 15, rule: '≥4%→15 ≥3%→12 ≥2%→8', available: hasAtr });

  // Avg Volume / Liquidity (0–15)
  pts = 0;
  if (hasAvgVol) { if (avgVol >= 5e6) pts = 15; else if (avgVol >= 2e6) pts = 12; else if (avgVol >= 1e6) pts = 8; else if (avgVol >= 500e3) pts = 5; }
  rawScore += pts;
  breakdown.push({ factor: 'Avg Vol', value: hasAvgVol ? fmtVol(avgVol) : '—', pts, max: 15, rule: '≥5M→15 ≥2M→12 ≥1M→8', available: hasAvgVol });

  // RSI proximity (0–10)
  pts = 0;
  if (hasRsi) { if (rsi > 70 || rsi < 30) pts = 10; else if (rsi > 65 || rsi < 35) pts = 6; else pts = 3; }
  rawScore += pts;
  breakdown.push({ factor: 'RSI', value: hasRsi ? rsi.toFixed(0) : '—', pts, max: 10, rule: '>70 or <30 → 10', available: hasRsi });

  const availableMax = breakdown.filter(b => b.available).reduce((s, b) => s + b.max, 0);
  const availableCount = breakdown.filter(b => b.available).length;
  const score = normalizeScore(rawScore, availableMax, TOTAL_MAX);
  const dataQuality = computeDataQuality(availableCount, breakdown.length);
  return { score, breakdown, dataQuality, availableMax };
}

// ── Earnings Momentum Score (0–100) — returns { score, breakdown, dataQuality, availableMax } ──
export function computeEarningsMomentumScore(row) {
  const breakdown = [];
  let rawScore = 0;
  const TOTAL_MAX = 100;

  // Expected Move (0–25)
  const rawEm = parseFloat(row.expectedMovePercent);
  const hasEm = isFinite(rawEm) && rawEm > 0;
  const em = hasEm ? rawEm : 0;
  let pts = 0;
  if (hasEm) { if (em >= 10) pts = 25; else if (em >= 7) pts = 20; else if (em >= 5) pts = 15; else if (em >= 3) pts = 8; }
  rawScore += pts;
  breakdown.push({ factor: 'Exp Move%', value: hasEm ? `±${em.toFixed(1)}%` : '—', pts, max: 25, rule: '≥10→25 ≥7→20 ≥5→15', available: hasEm });

  // Beat History (0–25)
  const rawBeats = parseInt(row.beatsInLast4);
  const hasBeats = isFinite(rawBeats);
  const beats = hasBeats ? rawBeats : 0;
  pts = hasBeats ? Math.min(25, beats * 7) : 0;
  rawScore += pts;
  breakdown.push({ factor: 'Beats/4', value: hasBeats ? `${beats}/4` : '—', pts, max: 25, rule: '7 pts per beat', available: hasBeats });

  // Average Volume (0–15)
  const rawAvgVol = parseFloat(row.avgVolume);
  const hasAvgVol = isFinite(rawAvgVol) && rawAvgVol > 0;
  const avgVol = hasAvgVol ? rawAvgVol : 0;
  pts = 0;
  if (hasAvgVol) { if (avgVol >= 5e6) pts = 15; else if (avgVol >= 2e6) pts = 12; else if (avgVol >= 1e6) pts = 8; else if (avgVol >= 500e3) pts = 5; }
  rawScore += pts;
  breakdown.push({ factor: 'Avg Vol', value: hasAvgVol ? fmtVol(avgVol) : '—', pts, max: 15, rule: '≥5M→15 ≥2M→12', available: hasAvgVol });

  // Earnings Surprise magnitude (0–20)
  const rawSurprise = parseFloat(row.surprise);
  const hasSurprise = isFinite(rawSurprise);
  const surprise = hasSurprise ? Math.abs(rawSurprise) : 0;
  pts = 0;
  if (hasSurprise) { if (surprise >= 20) pts = 20; else if (surprise >= 10) pts = 15; else if (surprise >= 5) pts = 10; else if (surprise >= 2) pts = 5; }
  rawScore += pts;
  breakdown.push({ factor: 'Surprise', value: hasSurprise ? `${surprise.toFixed(1)}%` : '—', pts, max: 20, rule: '≥20→20 ≥10→15 ≥5→10', available: hasSurprise });

  // IV level (0–15) — moderate IV = tradeable
  const rawIv = parseFloat(row.avgIV);
  const hasIv = isFinite(rawIv) && rawIv > 0;
  const iv = hasIv ? rawIv : 0;
  pts = 0;
  if (hasIv) { if (iv < 0.8) pts = 15; else if (iv < 1.2) pts = 10; else pts = 5; }
  rawScore += pts;
  breakdown.push({ factor: 'IV', value: hasIv ? `${(iv * 100).toFixed(0)}%` : '—', pts, max: 15, rule: '<80%→15 80-120%→10', available: hasIv });

  const availableMax = breakdown.filter(b => b.available).reduce((s, b) => s + b.max, 0);
  const availableCount = breakdown.filter(b => b.available).length;
  const score = normalizeScore(rawScore, availableMax, TOTAL_MAX);
  const dataQuality = computeDataQuality(availableCount, breakdown.length);
  return { score, breakdown, dataQuality, availableMax };
}

// ── Multi-Day Continuation Score (0–100) — returns { score, breakdown, dataQuality, availableMax } ──
// Rebalanced: filters pre-guarantee price > 20 & 50 SMA, so MA weight is reduced.
// More emphasis on volume surge, proximity to highs, and trend quality.
export function computeContinuationScore(row) {
  const breakdown = [];
  let rawScore = 0;
  const TOTAL_MAX = 100;

  const sma20 = parsePct(row['SMA20']);
  const sma50 = parsePct(row['SMA50']);
  const sma200 = parsePct(row['SMA200']);
  const hasMa = sma20 != null || sma50 != null || sma200 != null;
  const rawRsi = parseFloat(row['RSI']);
  const hasRsi = isFinite(rawRsi);
  const rsi = hasRsi ? rawRsi : 50;
  const rawRvol = parseFloat(row['Rel Volume']);
  const hasRvol = isFinite(rawRvol) && rawRvol > 0;
  const rvol = hasRvol ? rawRvol : 0;
  const dist52wh = parsePct(row['52W High']);
  const has52wh = dist52wh != null;
  const change = parsePct(row['Change']);
  const hasChange = change != null;

  // MA Alignment (0–15)
  let pts = 0;
  if (hasMa) {
    if (sma20 != null && sma20 > 0) pts += 3;
    if (sma50 != null && sma50 > 0) pts += 3;
    if (sma200 != null && sma200 > 0) pts += 9;
  }
  rawScore += pts;
  breakdown.push({ factor: 'MA Align', value: `20:${sma20 != null ? (sma20 > 0 ? '✓' : '✗') : '—'} 50:${sma50 != null ? (sma50 > 0 ? '✓' : '✗') : '—'} 200:${sma200 != null ? (sma200 > 0 ? '✓' : '✗') : '—'}`, pts, max: 15, rule: '200-SMA most weighted (9pts)', available: hasMa });

  // Trend Strength — how far above 20-SMA (0–15)
  const hasTrendStr = sma20 != null;
  pts = 0;
  if (hasTrendStr) { if (sma20 >= 5) pts = 15; else if (sma20 >= 3) pts = 10; else if (sma20 >= 1) pts = 5; }
  rawScore += pts;
  breakdown.push({ factor: 'Trend Str', value: hasTrendStr ? `+${sma20.toFixed(1)}% above 20-SMA` : '—', pts, max: 15, rule: '≥5%→15 ≥3%→10 ≥1%→5', available: hasTrendStr });

  // RSI Sweet Spot (0–15)
  pts = 0;
  if (hasRsi) { if (rsi >= 55 && rsi <= 65) pts = 15; else if (rsi >= 50 && rsi <= 70) pts = 10; else if (rsi >= 45 && rsi <= 75) pts = 5; }
  rawScore += pts;
  breakdown.push({ factor: 'RSI', value: hasRsi ? rsi.toFixed(0) : '—', pts, max: 15, rule: '55-65→15 50-70→10', available: hasRsi });

  // Volume Surge (0–25)
  pts = 0;
  if (hasRvol) { if (rvol >= 3.0) pts = 25; else if (rvol >= 2.0) pts = 20; else if (rvol >= 1.5) pts = 14; else if (rvol >= 1.2) pts = 8; else if (rvol >= 1.0) pts = 3; }
  rawScore += pts;
  breakdown.push({ factor: 'RVOL', value: hasRvol ? rvol.toFixed(2) : '—', pts, max: 25, rule: '≥3→25 ≥2→20 ≥1.5→14', available: hasRvol });

  // Near 52W High (0–20)
  pts = 0;
  if (has52wh) { const d = Math.abs(dist52wh); if (d <= 3) pts = 20; else if (d <= 7) pts = 14; else if (d <= 15) pts = 7; }
  rawScore += pts;
  breakdown.push({ factor: '52W High', value: has52wh ? `${dist52wh.toFixed(1)}%` : '—', pts, max: 20, rule: '≤3%→20 ≤7%→14 ≤15%→7', available: has52wh });

  // Daily Change (0–10)
  pts = 0;
  if (hasChange) { if (change > 3) pts = 10; else if (change > 1.5) pts = 7; else if (change > 0) pts = 3; }
  rawScore += pts;
  breakdown.push({ factor: 'Change', value: hasChange ? `${change.toFixed(1)}%` : '—', pts, max: 10, rule: '>3%→10 >1.5%→7 >0→3', available: hasChange });

  const availableMax = breakdown.filter(b => b.available).reduce((s, b) => s + b.max, 0);
  const availableCount = breakdown.filter(b => b.available).length;
  const score = normalizeScore(rawScore, availableMax, TOTAL_MAX);
  const dataQuality = computeDataQuality(availableCount, breakdown.length);
  return { score, breakdown, dataQuality, availableMax };
}

// Score color/label
export function getScoreColor(score) {
  if (score >= 75) return 'var(--accent-green)';
  if (score >= 50) return 'var(--accent-blue)';
  if (score >= 30) return 'var(--accent-orange)';
  return 'var(--accent-red)';
}

export function getScoreLabel(score) {
  if (score >= 75) return 'Strong';
  if (score >= 50) return 'Moderate';
  if (score >= 30) return 'Weak';
  return 'Poor';
}

// Risk flag detection — strategy-contextual
// Levels: 'high' (red), 'medium' (orange), 'low' (blue), 'positive' (green bullish signal)
export function computeRiskFlags(data, strategy = 'orb') {
  const flags = [];
  if (!data) return flags;

  const { earnings, expectedMove, company, technicals, sentiment } = data;

  // Earnings within 2 days
  if (earnings?.earningsDate) {
    const daysTo = Math.ceil((new Date(earnings.earningsDate) - Date.now()) / 86400000);
    if (daysTo >= 0 && daysTo <= 2) {
      if (strategy === 'earnings') {
        flags.push({ level: 'positive', text: `Earnings catalyst in ${daysTo} day${daysTo !== 1 ? 's' : ''}` });
      } else {
        flags.push({ level: 'high', text: `Earnings in ${daysTo} day${daysTo !== 1 ? 's' : ''} — binary event risk` });
      }
    }
  }

  // High IV
  if (expectedMove?.avgIV && expectedMove.avgIV > 0.8) {
    if (strategy === 'earnings') {
      flags.push({ level: 'high', text: `IV elevated (${(expectedMove.avgIV * 100).toFixed(0)}%) — crush risk` });
    } else if (strategy === 'continuation') {
      // IV is less relevant for continuation trades
    } else {
      flags.push({ level: 'medium', text: `IV elevated (${(expectedMove.avgIV * 100).toFixed(0)}%)` });
    }
  }

  // Low float
  if (company?.floatShares && company.floatShares < 10e6) {
    flags.push({ level: 'high', text: `Low float (${(company.floatShares / 1e6).toFixed(1)}M)` });
  }

  // High short interest
  if (company?.shortPercentOfFloat && company.shortPercentOfFloat > 20) {
    if (strategy === 'orb') {
      flags.push({ level: 'medium', text: `High short interest (${company.shortPercentOfFloat.toFixed(1)}%) — squeeze potential` });
    } else {
      flags.push({ level: 'high', text: `High short interest (${company.shortPercentOfFloat.toFixed(1)}%)` });
    }
  } else if (company?.shortPercentOfFloat && company.shortPercentOfFloat > 10) {
    flags.push({ level: 'medium', text: `Elevated short interest (${company.shortPercentOfFloat.toFixed(1)}%)` });
  }

  // Near 52W high
  if (technicals?.distHigh52w != null && Math.abs(technicals.distHigh52w) < 3) {
    if (strategy === 'continuation') {
      flags.push({ level: 'positive', text: `Near 52W high (${technicals.distHigh52w.toFixed(1)}%) — breakout zone` });
    } else {
      flags.push({ level: 'high', text: `Near 52W high (${technicals.distHigh52w.toFixed(1)}%) — extended` });
    }
  }

  // Extended from SMAs
  if (technicals?.distSMA20 != null && technicals.distSMA20 > 10) {
    if (strategy === 'continuation') {
      flags.push({ level: 'low', text: `Extended from 20-SMA (+${technicals.distSMA20.toFixed(1)}%)` });
    } else {
      flags.push({ level: 'medium', text: `Extended from 20-SMA (+${technicals.distSMA20.toFixed(1)}%)` });
    }
  }

  // RSI overbought/oversold
  if (technicals?.rsi && technicals.rsi > 75) {
    if (strategy === 'continuation') {
      flags.push({ level: 'medium', text: `RSI overbought (${technicals.rsi}) — momentum expected` });
    } else {
      flags.push({ level: 'high', text: `RSI overbought (${technicals.rsi})` });
    }
  } else if (technicals?.rsi && technicals.rsi < 25) {
    if (strategy === 'orb') {
      flags.push({ level: 'positive', text: `RSI oversold (${technicals.rsi}) — bounce potential` });
    } else if (strategy === 'continuation') {
      flags.push({ level: 'high', text: `RSI oversold (${technicals.rsi}) — trend broken` });
    } else {
      flags.push({ level: 'medium', text: `RSI oversold (${technicals.rsi})` });
    }
  }

  // Low analyst coverage
  if (sentiment?.numberOfAnalysts != null && sentiment.numberOfAnalysts < 3) {
    flags.push({ level: 'low', text: 'Low analyst coverage' });
  }

  // Low volume
  if (company?.avgVolume && company.avgVolume < 300000) {
    flags.push({ level: 'high', text: 'Low average volume — liquidity risk' });
  }

  return flags;
}

// ── Catalyst Detail Score — detailed breakdown for Deep Dive panel ──
// Returns { score, max, breakdown: [{ factor, value, pts, max, note }] }
export function computeCatalystDetail(researchData, strategy = 'orb', rowData = null) {
  const MAX = 20;
  const d = researchData || {};
  const n = Array.isArray(d.news) ? d.news : [];
  const s = d.sentiment || {};
  const e = d.earnings || {};
  const breakdown = [];
  let rawPts = 0;

  // 1. News Recency (0-5) — freshness of most recent headline
  const now = Date.now() / 1000;
  const freshest = n.length > 0 ? Math.min(...n.filter(i => i.datetime > 0).map(i => now - i.datetime)) : Infinity;
  let pts = 0;
  let note = 'No recent news';
  const hasNews = n.length > 0 && freshest < Infinity;
  if (hasNews) {
    if (freshest < 6 * 3600) { pts = 5; note = 'Breaking news (< 6h)'; }
    else if (freshest < 24 * 3600) { pts = 3; note = 'Fresh news (< 24h)'; }
    else if (freshest < 48 * 3600) { pts = 1; note = 'Recent news (< 48h)'; }
    else { note = 'Stale news (> 48h)'; }
  }
  rawPts += pts;
  breakdown.push({ factor: 'News Recency', value: hasNews ? formatTimeDelta(freshest) : '—', pts, max: 5, note });

  // 2. News Volume (0-3) — density of fresh headlines
  const fresh48h = n.filter(i => i.datetime > 0 && (now - i.datetime) < 48 * 3600);
  pts = 0;
  if (fresh48h.length >= 5) { pts = 3; note = `${fresh48h.length} headlines in 48h — high activity`; }
  else if (fresh48h.length >= 2) { pts = 2; note = `${fresh48h.length} headlines in 48h`; }
  else if (fresh48h.length >= 1) { pts = 1; note = '1 headline in 48h'; }
  else { note = 'No headlines in 48h'; }
  rawPts += pts;
  breakdown.push({ factor: 'News Volume', value: `${fresh48h.length}`, pts, max: 3, note });

  // 3. Earnings Proximity (0-5) — strategy-contextual
  const hasEarnings = !!e.earningsDate;
  let daysTo = Infinity;
  if (hasEarnings) daysTo = Math.ceil((new Date(e.earningsDate) - Date.now()) / 86400000);
  pts = 0;
  if (hasEarnings && daysTo >= 0 && daysTo <= 14) {
    if (strategy === 'earnings') {
      // For earnings strategy, proximity is a catalyst
      if (daysTo <= 2) { pts = 5; note = `Earnings in ${daysTo}d — imminent catalyst`; }
      else if (daysTo <= 5) { pts = 3; note = `Earnings in ${daysTo}d — near-term`; }
      else { pts = 1; note = `Earnings in ${daysTo}d — approaching`; }
    } else {
      // For ORB/continuation, proximity is caution but still informative
      if (daysTo <= 2) { pts = 2; note = `Earnings in ${daysTo}d — binary event risk`; }
      else if (daysTo <= 5) { pts = 1; note = `Earnings in ${daysTo}d — IV may be elevated`; }
      else { pts = 0; note = `Earnings in ${daysTo}d — watch for IV ramp`; }
    }
  } else {
    note = hasEarnings ? `Earnings ${daysTo}d away` : 'No upcoming earnings';
  }
  rawPts += pts;
  breakdown.push({ factor: 'Earnings Proximity', value: hasEarnings && daysTo >= 0 ? `${daysTo}d` : '—', pts, max: 5, note });

  // 4. Analyst Momentum (0-4) — recommendation + target upside
  const hasAnalyst = s.recommendationMean != null || s.targetVsPrice != null;
  pts = 0;
  if (hasAnalyst) {
    if (s.recommendationMean && s.recommendationMean <= 2.0) pts += 2;
    else if (s.recommendationMean && s.recommendationMean <= 2.5) pts += 1;
    if (s.targetVsPrice > 20) pts += 2;
    else if (s.targetVsPrice > 10) pts += 1;
    pts = Math.min(4, pts);
    note = `Rating: ${s.recommendationMean?.toFixed(1) || '—'}, Upside: ${s.targetVsPrice != null ? s.targetVsPrice + '%' : '—'}`;
  } else { note = 'No analyst data'; }
  rawPts += pts;
  breakdown.push({ factor: 'Analyst Momentum', value: s.numberOfAnalysts ? `${s.numberOfAnalysts} analysts` : '—', pts, max: 4, note });

  // 5. Volume Confirmation (0-3) — relative volume from row data
  const rvol = rowData?.rvol ?? (rowData?.['Rel Volume'] ? parseFloat(rowData['Rel Volume']) : null);
  const hasRvol = rvol != null && isFinite(rvol) && rvol > 0;
  pts = 0;
  if (hasRvol) {
    if (rvol >= 3) { pts = 3; note = `RVOL ${rvol.toFixed(1)}x — extreme volume`; }
    else if (rvol >= 2) { pts = 2; note = `RVOL ${rvol.toFixed(1)}x — elevated`; }
    else if (rvol >= 1.5) { pts = 1; note = `RVOL ${rvol.toFixed(1)}x — above average`; }
    else { note = `RVOL ${rvol.toFixed(1)}x — normal`; }
  } else { note = 'No relative volume data'; }
  rawPts += pts;
  breakdown.push({ factor: 'Volume Confirmation', value: hasRvol ? `${rvol.toFixed(2)}x` : '—', pts, max: 3, note });

  const score = Math.min(MAX, rawPts);
  return { score, max: MAX, breakdown };
}

function formatTimeDelta(seconds) {
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

// ── Custom Strategy Scoring ──
// Scores a Finviz row (already normalized) using user-defined weights.
// weights: { gapChange: 0-100, volume: 0-100, technical: 0-100, proximity: 0-100 } (must sum to 100)
export function computeCustomScore(row, weights = { gapChange: 25, volume: 25, technical: 25, proximity: 25 }) {
  const breakdown = [];
  let rawPts = 0;
  let availMax = 0;
  const TOTAL = 100;

  // 1. Gap/Change score (scaled to weight)
  const gap = parsePct(row['Gap']) ?? parsePct(row['Change']);
  const gapMax = weights.gapChange;
  let gapPts = 0;
  const hasGap = gap != null;
  if (hasGap) {
    if (gap >= 8) gapPts = gapMax;
    else if (gap >= 5) gapPts = Math.round(gapMax * 0.8);
    else if (gap >= 3) gapPts = Math.round(gapMax * 0.6);
    else if (gap >= 1) gapPts = Math.round(gapMax * 0.3);
    availMax += gapMax;
  }
  rawPts += gapPts;
  breakdown.push({ factor: 'Gap/Change', value: hasGap ? `${gap.toFixed(1)}%` : '—', pts: gapPts, max: gapMax, available: hasGap });

  // 2. Volume score
  const rvol = parseFloat(row['Rel Volume']) || null;
  const avgVol = parseVolume(row['Avg Volume']);
  const volMax = weights.volume;
  let volPts = 0;
  const hasVol = rvol != null || avgVol > 0;
  if (rvol != null) {
    if (rvol >= 3) volPts += Math.round(volMax * 0.6);
    else if (rvol >= 2) volPts += Math.round(volMax * 0.4);
    else if (rvol >= 1.5) volPts += Math.round(volMax * 0.2);
  }
  if (avgVol >= 2e6) volPts += Math.round(volMax * 0.4);
  else if (avgVol >= 1e6) volPts += Math.round(volMax * 0.3);
  else if (avgVol >= 500000) volPts += Math.round(volMax * 0.2);
  volPts = Math.min(volMax, volPts);
  if (hasVol) availMax += volMax;
  rawPts += volPts;
  breakdown.push({ factor: 'Volume', value: rvol != null ? `RVOL ${rvol.toFixed(1)}x` : '—', pts: volPts, max: volMax, available: hasVol });

  // 3. Technical score (RSI + SMA alignment)
  const rsi = parseFloat(row['RSI']) || null;
  const sma20 = row['SMA20'];
  const sma50 = row['SMA50'];
  const sma200 = row['SMA200'];
  const techMax = weights.technical;
  let techPts = 0;
  const price = parseFloat(row['Price']) || 0;
  let hasTech = false;
  if (rsi != null) {
    hasTech = true;
    if (rsi >= 50 && rsi <= 70) techPts += Math.round(techMax * 0.4);
    else if (rsi > 70) techPts += Math.round(techMax * 0.2); // overbought = partial credit
    else if (rsi >= 30) techPts += Math.round(techMax * 0.3);
  }
  // SMA alignment
  let smaAbove = 0;
  if (sma20 && price > parseFloat(sma20)) smaAbove++;
  if (sma50 && price > parseFloat(sma50)) smaAbove++;
  if (sma200 && price > parseFloat(sma200)) smaAbove++;
  if (smaAbove > 0) { hasTech = true; techPts += Math.round(techMax * (smaAbove / 3) * 0.6); }
  techPts = Math.min(techMax, techPts);
  if (hasTech) availMax += techMax;
  rawPts += techPts;
  breakdown.push({ factor: 'Technical', value: `RSI ${rsi?.toFixed(0) || '—'} | SMA ${smaAbove}/3`, pts: techPts, max: techMax, available: hasTech });

  // 4. Proximity (52W high, trend strength)
  const high52w = parseFloat(row['52W High']) || null;
  const low52w = parseFloat(row['52W Low']) || null;
  const proxMax = weights.proximity;
  let proxPts = 0;
  const hasProx = high52w != null && low52w != null && price > 0;
  if (hasProx) {
    const range = high52w - low52w;
    if (range > 0) {
      const pctInRange = (price - low52w) / range;
      if (pctInRange >= 0.9) proxPts = Math.round(proxMax * 0.8); // near high
      else if (pctInRange >= 0.7) proxPts = proxMax; // sweet spot
      else if (pctInRange >= 0.5) proxPts = Math.round(proxMax * 0.7);
      else proxPts = Math.round(proxMax * 0.3);
    }
    availMax += proxMax;
  }
  rawPts += proxPts;
  breakdown.push({ factor: 'Proximity', value: hasProx ? `${((price - low52w) / (high52w - low52w) * 100).toFixed(0)}th %ile` : '—', pts: proxPts, max: proxMax, available: hasProx });

  // Normalize
  const score = availMax > 0 ? Math.round((rawPts / availMax) * TOTAL) : 0;
  const clamped = Math.min(100, Math.max(0, score));
  return { score: clamped, breakdown, dataQuality: computeDataQuality(breakdown.filter(b => b.available).length, 4), availableMax: availMax };
}

// ── Unified Deep Dive Score — blends strategy score with research data ──
// Returns { score, breakdown: [{ category, pts, max, details }], dataQuality }
const UNIFIED_WEIGHTS = {
  orb:          { strategyCore: 50, technicalFit: 15, volumeQuality: 10, catalystQuality: 15, riskAdj: 10 },
  earnings:     { strategyCore: 50, technicalFit: 10, volumeQuality: 10, catalystQuality: 20, riskAdj: 10 },
  continuation: { strategyCore: 50, technicalFit: 20, volumeQuality: 15, catalystQuality:  5, riskAdj: 10 },
};

export function computeUnifiedScore(rowData, researchData, strategy = 'orb') {
  const w = UNIFIED_WEIGHTS[strategy] || UNIFIED_WEIGHTS.orb;
  const breakdown = [];
  let rawScore = 0;
  let availableMax = 0;
  const d = researchData || {};
  const c = d.company || {};
  const t = d.technicals || {};
  const s = d.sentiment || {};
  const n = Array.isArray(d.news) ? d.news : [];

  // 1. Strategy Core — scale the module's score into this weight bucket
  const hasStrategyCore = rowData && rowData.score != null;
  let pts = 0;
  if (hasStrategyCore) {
    pts = Math.round((rowData.score / 100) * w.strategyCore);
  }
  if (hasStrategyCore) availableMax += w.strategyCore;
  rawScore += pts;
  breakdown.push({ category: 'Strategy Core', pts, max: w.strategyCore, available: hasStrategyCore,
    details: hasStrategyCore ? `Module score ${rowData.score}/100 → ${pts}/${w.strategyCore}` : 'No module data' });

  // 2. Technical Fit — strategy-aware ideal ranges
  const hasTech = t.available === true;
  pts = 0;
  if (hasTech) {
    const techMax = w.technicalFit;
    // Trend alignment
    if (strategy === 'continuation') {
      if (t.trend === 'bullish') pts += Math.round(techMax * 0.4);
      else if (t.trend === 'mixed') pts += Math.round(techMax * 0.15);
    } else {
      if (t.trend === 'bullish') pts += Math.round(techMax * 0.3);
      else if (t.trend === 'mixed') pts += Math.round(techMax * 0.15);
    }
    // RSI in strategy-appropriate range
    if (strategy === 'continuation') {
      if (t.rsi >= 50 && t.rsi <= 70) pts += Math.round(techMax * 0.3);
    } else if (strategy === 'orb') {
      if (t.rsi > 70 || t.rsi < 30) pts += Math.round(techMax * 0.3); // extremes = movement
      else if (t.rsi > 60 || t.rsi < 40) pts += Math.round(techMax * 0.15);
    } else {
      if (t.rsi >= 30 && t.rsi <= 70) pts += Math.round(techMax * 0.3);
    }
    // SMA positioning
    if (t.aboveSMA20 && t.aboveSMA50) pts += Math.round(techMax * 0.3);
    else if (t.aboveSMA20) pts += Math.round(techMax * 0.15);
    pts = Math.min(techMax, pts);
    availableMax += techMax;
  }
  rawScore += pts;
  breakdown.push({ category: 'Technical Fit', pts, max: w.technicalFit, available: hasTech,
    details: hasTech ? `Trend: ${t.trend || '—'}, RSI: ${t.rsi || '—'}` : 'No technical data' });

  // 3. Volume Quality — avg volume, institutional %, float
  const hasVol = c.avgVolume > 0 || c.institutionalPercent != null;
  pts = 0;
  if (hasVol) {
    const volMax = w.volumeQuality;
    if (c.avgVolume >= 5e6) pts += Math.round(volMax * 0.4);
    else if (c.avgVolume >= 1e6) pts += Math.round(volMax * 0.25);
    else if (c.avgVolume >= 500e3) pts += Math.round(volMax * 0.1);
    if (c.institutionalPercent > 50) pts += Math.round(volMax * 0.3);
    else if (c.institutionalPercent > 20) pts += Math.round(volMax * 0.15);
    if (c.floatShares && c.floatShares > 20e6 && c.floatShares < 500e6) pts += Math.round(volMax * 0.3);
    else if (c.floatShares && c.floatShares >= 500e6) pts += Math.round(volMax * 0.15);
    pts = Math.min(volMax, pts);
    availableMax += volMax;
  }
  rawScore += pts;
  breakdown.push({ category: 'Volume Quality', pts, max: w.volumeQuality, available: hasVol,
    details: hasVol ? `Avg Vol: ${fmtVol(c.avgVolume)}, Inst: ${c.institutionalPercent ?? '—'}%` : 'No volume data' });

  // 4. Catalyst Quality — news freshness, earnings proximity, analyst momentum
  const hasCatalyst = n.length > 0 || s.numberOfAnalysts > 0 || d.earnings?.earningsDate;
  pts = 0;
  if (hasCatalyst) {
    const catMax = w.catalystQuality;
    // Fresh news
    const freshNews = n.filter(item => item.datetime && (Date.now() / 1000 - item.datetime) < 2 * 86400);
    if (freshNews.length >= 3) pts += Math.round(catMax * 0.3);
    else if (freshNews.length > 0) pts += Math.round(catMax * 0.15);
    else if (n.length > 0) pts += Math.round(catMax * 0.05);
    // Analyst sentiment
    if (s.recommendationMean && s.recommendationMean <= 2.0) pts += Math.round(catMax * 0.3);
    else if (s.recommendationMean && s.recommendationMean <= 2.5) pts += Math.round(catMax * 0.15);
    // Target upside
    if (s.targetVsPrice > 20) pts += Math.round(catMax * 0.2);
    else if (s.targetVsPrice > 10) pts += Math.round(catMax * 0.1);
    // Earnings proximity (positive for earnings strategy)
    if (d.earnings?.earningsDate) {
      const daysTo = Math.ceil((new Date(d.earnings.earningsDate) - Date.now()) / 86400000);
      if (strategy === 'earnings' && daysTo >= 0 && daysTo <= 5) pts += Math.round(catMax * 0.2);
    }
    pts = Math.min(catMax, pts);
    availableMax += catMax;
  }
  rawScore += pts;
  breakdown.push({ category: 'Catalyst Quality', pts, max: w.catalystQuality, available: hasCatalyst,
    details: hasCatalyst ? `${n.length} news, ${s.numberOfAnalysts ?? 0} analysts` : 'No catalyst data' });

  // 5. Risk Adjustment — starts at max, deducts for strategy-contextual risk flags
  const riskFlags = computeRiskFlags(d, strategy);
  const hasRiskData = Object.keys(d).length > 0;
  pts = w.riskAdj;
  if (hasRiskData) {
    const highFlags = riskFlags.filter(f => f.level === 'high').length;
    const medFlags = riskFlags.filter(f => f.level === 'medium').length;
    const posFlags = riskFlags.filter(f => f.level === 'positive').length;
    pts -= highFlags * 4;
    pts -= medFlags * 2;
    pts += posFlags * 1; // positive flags slightly boost
    pts = Math.max(0, Math.min(w.riskAdj, pts));
    availableMax += w.riskAdj;
  }
  rawScore += pts;
  breakdown.push({ category: 'Risk Adjustment', pts, max: w.riskAdj, available: hasRiskData,
    details: hasRiskData ? `${riskFlags.filter(f => f.level === 'high').length} high, ${riskFlags.filter(f => f.level === 'medium').length} med, ${riskFlags.filter(f => f.level === 'positive').length} positive` : 'No data' });

  const totalMax = Object.values(w).reduce((a, v) => a + v, 0);
  const score = normalizeScore(rawScore, availableMax, totalMax);
  const availableCount = breakdown.filter(b => b.available).length;
  const dataQuality = computeDataQuality(availableCount, breakdown.length);
  return { score, breakdown, dataQuality, riskFlags };
}

// ── Confidence Tier (A+/A/B/C) based purely on score ──
export function getConfidenceTier(score, confirmations = 0) {
  // Cross-scanner confirmation can bump up one tier
  const bonus = confirmations >= 2 ? 10 : confirmations >= 1 ? 5 : 0;
  const effective = Math.min(100, score + bonus);
  if (effective >= 85) return { tier: 'A+', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' };
  if (effective >= 70) return { tier: 'A',  color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' };
  if (effective >= 50) return { tier: 'B',  color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' };
  return { tier: 'C', color: '#ef4444', bg: 'rgba(239,68,68,0.10)' };
}

// ── Build "Why Is This Ranked?" reasons for deep-dive panel ──
export function buildRankExplanation(row, strategy) {
  const reasons = [];
  if (!row) return reasons;
  if (row.breakdown) {
    for (const b of row.breakdown) {
      if (b.pts > 0) reasons.push(`${b.factor}: ${b.value} → +${b.pts}/${b.max} pts (${b.rule})`);
      else reasons.push(`${b.factor}: ${b.value} → 0/${b.max} pts`);
    }
  }
  if (row.confirmations > 0) reasons.push(`Cross-scanner: confirmed by ${row.confirmations} other scanner(s)`);
  if (row.confidenceTier) reasons.push(`Confidence tier: ${row.confidenceTier.tier}`);
  return reasons;
}

// ── Apply global filters to a rows array ──
export function applyGlobalFilters(rows, filters) {
  if (!filters || Object.keys(filters).length === 0) return rows;
  return rows.filter(r => {
    if (filters.priceMin && (r.price == null || r.price < Number(filters.priceMin))) return false;
    if (filters.priceMax && (r.price == null || r.price > Number(filters.priceMax))) return false;
    if (filters.gapMin && (r.gap == null || Math.abs(r.gap) < Number(filters.gapMin))) return false;
    if (filters.rvolMin && (r.rvol == null || r.rvol < Number(filters.rvolMin))) return false;
    if (filters.avgVolMin && (r.avgVolume == null || r.avgVolume < Number(filters.avgVolMin))) return false;
    if (filters.emMin && (r.expectedMovePercent == null || r.expectedMovePercent < Number(filters.emMin))) return false;
    if (filters.minConfirmations && (r.confirmations == null || r.confirmations < Number(filters.minConfirmations))) return false;
    // Validation mode: require ≥2 confirmations, complete data, and liquidity
    if (filters.validationMode) {
      if ((r.confirmations || 0) < 1) return false;
      if (r.dataQuality === 'Low') return false;
      if (r.avgVolume != null && r.avgVolume < 500000) return false;
    }
    return true;
  });
}

// ── Export rows as CSV download ──
export function exportToCSV(rows, filename, strategy) {
  if (!rows.length) return;
  // Build columns from first row keys plus score breakdown
  const cols = ['ticker', 'score', 'dataQuality', 'confirmations', 'price'];
  if (strategy === 'orb') cols.push('gap', 'change', 'rvol', 'atr', 'rsi', 'avgVolume');
  else if (strategy === 'earnings') cols.push('date', 'expectedMovePercent', 'beatsInLast4', 'surprise', 'avgIV');
  else cols.push('change', 'sma20', 'sma50', 'sma200', 'rvol', 'rsi', 'dist52wh');
  // Add breakdown columns
  const maxBreakdown = Math.max(...rows.map(r => r.breakdown?.length || 0));
  for (let i = 0; i < maxBreakdown; i++) cols.push(`factor_${i + 1}`, `pts_${i + 1}`, `max_${i + 1}`);

  const header = cols.join(',');
  const lines = rows.map(r => {
    const vals = cols.map(c => {
      if (c.startsWith('factor_')) { const i = parseInt(c.split('_')[1]) - 1; return r.breakdown?.[i]?.factor || ''; }
      if (c.startsWith('pts_'))    { const i = parseInt(c.split('_')[1]) - 1; return r.breakdown?.[i]?.pts ?? ''; }
      if (c.startsWith('max_'))    { const i = parseInt(c.split('_')[1]) - 1; return r.breakdown?.[i]?.max ?? ''; }
      const v = r[c];
      return v != null ? String(v).replace(/,/g, '') : '';
    });
    return vals.join(',');
  });
  const csv = [header, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename || 'aiq-export.csv';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
