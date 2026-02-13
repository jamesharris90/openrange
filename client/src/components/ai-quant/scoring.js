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

// Data quality: fraction of non-null fields
export function computeDataQuality(fields) {
  if (!fields.length) return 'Low';
  const valid = fields.filter(f => f != null && f !== '' && f !== 0).length;
  const ratio = valid / fields.length;
  if (ratio >= 0.85) return 'High';
  if (ratio >= 0.5) return 'Medium';
  return 'Low';
}

// ── ORB Intraday Score (0–100) — returns { score, breakdown, dataQuality } ──
export function computeORBScore(row) {
  const breakdown = [];
  let score = 0;
  const rawGap = parsePct(row['Gap'] || row['Change']);
  const gap = rawGap != null ? Math.abs(rawGap) : 0;
  const rvol = parseFloat(row['Rel Volume']) || 0;
  const atr = parseFloat(row['ATR']) || 0;
  const price = parseFloat(row['Price']) || 0;
  const avgVol = parseVolume(row['Avg Volume']);
  const rsi = parseFloat(row['RSI']) || 50;

  // Gap Size (0–30)
  let pts = 0;
  if (gap >= 8) pts = 30; else if (gap >= 5) pts = 24; else if (gap >= 3) pts = 18; else if (gap >= 1) pts = 10;
  score += pts;
  breakdown.push({ factor: 'Gap%', value: rawGap != null ? `${gap.toFixed(1)}%` : '—', pts, max: 30, rule: '≥8→30 ≥5→24 ≥3→18 ≥1→10' });

  // Relative Volume (0–30)
  pts = 0;
  if (rvol >= 5) pts = 30; else if (rvol >= 3) pts = 24; else if (rvol >= 2) pts = 18; else if (rvol >= 1.5) pts = 12; else if (rvol >= 1) pts = 6;
  score += pts;
  breakdown.push({ factor: 'RVOL', value: rvol.toFixed(2), pts, max: 30, rule: '≥5→30 ≥3→24 ≥2→18 ≥1.5→12' });

  // ATR / Price % (0–15)
  const atrPct = price > 0 ? (atr / price) * 100 : 0;
  pts = 0;
  if (atrPct >= 4) pts = 15; else if (atrPct >= 3) pts = 12; else if (atrPct >= 2) pts = 8; else if (atrPct >= 1) pts = 4;
  score += pts;
  breakdown.push({ factor: 'ATR/Price', value: `${atrPct.toFixed(1)}%`, pts, max: 15, rule: '≥4%→15 ≥3%→12 ≥2%→8' });

  // Avg Volume / Liquidity (0–15)
  pts = 0;
  if (avgVol >= 5e6) pts = 15; else if (avgVol >= 2e6) pts = 12; else if (avgVol >= 1e6) pts = 8; else if (avgVol >= 500e3) pts = 5;
  score += pts;
  breakdown.push({ factor: 'Avg Vol', value: fmtVol(avgVol), pts, max: 15, rule: '≥5M→15 ≥2M→12 ≥1M→8' });

  // RSI proximity (0–10)
  pts = 0;
  if (rsi > 70 || rsi < 30) pts = 10; else if (rsi > 65 || rsi < 35) pts = 6; else pts = 3;
  score += pts;
  breakdown.push({ factor: 'RSI', value: rsi.toFixed(0), pts, max: 10, rule: '>70 or <30 → 10' });

  const total = Math.min(100, score);
  const dataQuality = computeDataQuality([rawGap, rvol || null, atr || null, price || null, avgVol, rsi !== 50 ? rsi : null]);
  return { score: total, breakdown, dataQuality };
}

// ── Earnings Momentum Score (0–100) — returns { score, breakdown, dataQuality } ──
export function computeEarningsMomentumScore(row) {
  const breakdown = [];
  let score = 0;

  // Expected Move (0–25)
  const em = parseFloat(row.expectedMovePercent) || 0;
  let pts = 0;
  if (em >= 10) pts = 25; else if (em >= 7) pts = 20; else if (em >= 5) pts = 15; else if (em >= 3) pts = 8;
  score += pts;
  breakdown.push({ factor: 'Exp Move%', value: em ? `±${em.toFixed(1)}%` : '—', pts, max: 25, rule: '≥10→25 ≥7→20 ≥5→15' });

  // Beat History (0–25)
  const beats = parseInt(row.beatsInLast4) || 0;
  pts = Math.min(25, beats * 7);
  score += pts;
  breakdown.push({ factor: 'Beats/4', value: `${beats}/4`, pts, max: 25, rule: '7 pts per beat' });

  // Average Volume (0–15)
  const avgVol = parseFloat(row.avgVolume) || 0;
  pts = 0;
  if (avgVol >= 5e6) pts = 15; else if (avgVol >= 2e6) pts = 12; else if (avgVol >= 1e6) pts = 8; else if (avgVol >= 500e3) pts = 5;
  score += pts;
  breakdown.push({ factor: 'Avg Vol', value: fmtVol(avgVol || null), pts, max: 15, rule: '≥5M→15 ≥2M→12' });

  // Earnings Surprise magnitude (0–20)
  const surprise = Math.abs(parseFloat(row.surprise) || 0);
  pts = 0;
  if (surprise >= 20) pts = 20; else if (surprise >= 10) pts = 15; else if (surprise >= 5) pts = 10; else if (surprise >= 2) pts = 5;
  score += pts;
  breakdown.push({ factor: 'Surprise', value: surprise ? `${surprise.toFixed(1)}%` : '—', pts, max: 20, rule: '≥20→20 ≥10→15 ≥5→10' });

  // IV level (0–15) — moderate IV = tradeable
  const iv = parseFloat(row.avgIV) || 0;
  pts = 0;
  if (iv > 0 && iv < 0.8) pts = 15; else if (iv >= 0.8 && iv < 1.2) pts = 10; else if (iv >= 1.2) pts = 5;
  score += pts;
  breakdown.push({ factor: 'IV', value: iv ? `${(iv * 100).toFixed(0)}%` : '—', pts, max: 15, rule: '<80%→15 80-120%→10' });

  const total = Math.min(100, score);
  const dataQuality = computeDataQuality([em || null, beats || null, avgVol || null, row.surprise, iv || null]);
  return { score: total, breakdown, dataQuality };
}

// ── Multi-Day Continuation Score (0–100) — returns { score, breakdown, dataQuality } ──
// Rebalanced: filters pre-guarantee price > 20 & 50 SMA, so MA weight is reduced.
// More emphasis on volume surge, proximity to highs, and trend quality.
export function computeContinuationScore(row) {
  const breakdown = [];
  let score = 0;
  const sma20 = parsePct(row['SMA20']);
  const sma50 = parsePct(row['SMA50']);
  const sma200 = parsePct(row['SMA200']);
  const rsi = parseFloat(row['RSI']) || 50;
  const rvol = parseFloat(row['Rel Volume']) || 0;
  const dist52wh = parsePct(row['52W High']);
  const change = parsePct(row['Change']);

  // MA Alignment (0–15) — reduced from 30; 20 & 50 are pre-filtered so only 200 truly differentiates
  let pts = 0;
  if (sma20 != null && sma20 > 0) pts += 3;
  if (sma50 != null && sma50 > 0) pts += 3;
  if (sma200 != null && sma200 > 0) pts += 9;
  score += pts;
  breakdown.push({ factor: 'MA Align', value: `20:${sma20 != null ? (sma20 > 0 ? '✓' : '✗') : '—'} 50:${sma50 != null ? (sma50 > 0 ? '✓' : '✗') : '—'} 200:${sma200 != null ? (sma200 > 0 ? '✓' : '✗') : '—'}`, pts, max: 15, rule: '200-SMA most weighted (9pts)' });

  // Trend Strength — how far above 20-SMA (0–15) — separates leaders from laggards
  pts = 0;
  if (sma20 != null) {
    if (sma20 >= 5) pts = 15; else if (sma20 >= 3) pts = 10; else if (sma20 >= 1) pts = 5;
  }
  score += pts;
  breakdown.push({ factor: 'Trend Str', value: sma20 != null ? `+${sma20.toFixed(1)}% above 20-SMA` : '—', pts, max: 15, rule: '≥5%→15 ≥3%→10 ≥1%→5' });

  // RSI Sweet Spot (0–15) — tighter band rewards controlled momentum
  pts = 0;
  if (rsi >= 55 && rsi <= 65) pts = 15; else if (rsi >= 50 && rsi <= 70) pts = 10; else if (rsi >= 45 && rsi <= 75) pts = 5;
  score += pts;
  breakdown.push({ factor: 'RSI', value: rsi.toFixed(0), pts, max: 15, rule: '55-65→15 50-70→10' });

  // Volume Surge (0–25) — now the most weighted factor; requires real volume participation
  pts = 0;
  if (rvol >= 3.0) pts = 25; else if (rvol >= 2.0) pts = 20; else if (rvol >= 1.5) pts = 14; else if (rvol >= 1.2) pts = 8; else if (rvol >= 1.0) pts = 3;
  score += pts;
  breakdown.push({ factor: 'RVOL', value: rvol.toFixed(2), pts, max: 25, rule: '≥3→25 ≥2→20 ≥1.5→14' });

  // Near 52W High (0–20) — tighter: must be within 3% for full points
  pts = 0;
  if (dist52wh != null) {
    const d = Math.abs(dist52wh);
    if (d <= 3) pts = 20; else if (d <= 7) pts = 14; else if (d <= 15) pts = 7;
  }
  score += pts;
  breakdown.push({ factor: '52W High', value: dist52wh != null ? `${dist52wh.toFixed(1)}%` : '—', pts, max: 20, rule: '≤3%→20 ≤7%→14 ≤15%→7' });

  // Daily Change (0–10)
  pts = 0;
  if (change != null && change > 3) pts = 10; else if (change != null && change > 1.5) pts = 7; else if (change != null && change > 0) pts = 3;
  score += pts;
  breakdown.push({ factor: 'Change', value: change != null ? `${change.toFixed(1)}%` : '—', pts, max: 10, rule: '>3%→10 >1.5%→7 >0→3' });

  const total = Math.min(100, score);
  const dataQuality = computeDataQuality([sma20, sma50, sma200, rsi !== 50 ? rsi : null, rvol || null, dist52wh, change]);
  return { score: total, breakdown, dataQuality };
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

// Risk flag detection
export function computeRiskFlags(data) {
  const flags = [];
  if (!data) return flags;

  const { earnings, expectedMove, company, technicals, sentiment } = data;

  // Earnings within 2 days
  if (earnings?.earningsDate) {
    const daysTo = Math.ceil((new Date(earnings.earningsDate) - Date.now()) / 86400000);
    if (daysTo >= 0 && daysTo <= 2) flags.push({ level: 'high', text: `Earnings in ${daysTo} day${daysTo !== 1 ? 's' : ''}` });
  }

  // High IV
  if (expectedMove?.avgIV && expectedMove.avgIV > 0.8) {
    flags.push({ level: 'medium', text: `IV elevated (${(expectedMove.avgIV * 100).toFixed(0)}%)` });
  }

  // Low float
  if (company?.floatShares && company.floatShares < 10e6) {
    flags.push({ level: 'high', text: `Low float (${(company.floatShares / 1e6).toFixed(1)}M)` });
  }

  // High short interest
  if (company?.shortPercentOfFloat && company.shortPercentOfFloat > 20) {
    flags.push({ level: 'high', text: `High short interest (${company.shortPercentOfFloat.toFixed(1)}%)` });
  } else if (company?.shortPercentOfFloat && company.shortPercentOfFloat > 10) {
    flags.push({ level: 'medium', text: `Elevated short interest (${company.shortPercentOfFloat.toFixed(1)}%)` });
  }

  // Near 52W high
  if (technicals?.distHigh52w != null && Math.abs(technicals.distHigh52w) < 3) {
    flags.push({ level: 'medium', text: `Near 52W high (${technicals.distHigh52w.toFixed(1)}%)` });
  }

  // Extended from SMAs
  if (technicals?.distSMA20 != null && technicals.distSMA20 > 10) {
    flags.push({ level: 'medium', text: `Extended from 20-SMA (+${technicals.distSMA20.toFixed(1)}%)` });
  }

  // RSI overbought/oversold
  if (technicals?.rsi && technicals.rsi > 75) {
    flags.push({ level: 'high', text: `RSI overbought (${technicals.rsi})` });
  } else if (technicals?.rsi && technicals.rsi < 25) {
    flags.push({ level: 'medium', text: `RSI oversold (${technicals.rsi})` });
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
