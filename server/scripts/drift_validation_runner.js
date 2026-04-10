const fs = require('fs');
const path = require('path');

const RUN_DURATION_MINUTES = 30;
const INTERVAL_SECONDS = 60;
const SYMBOL_TRACK_COUNT = 10;

const ENDPOINT = `http://localhost:3001/api/intelligence/top-opportunities?limit=${SYMBOL_TRACK_COUNT}`;
const ROOT = '/Users/jamesharris/Server';
const LOG_DIR = path.join(ROOT, 'logs');
const TIMESERIES_PATH = path.join(LOG_DIR, 'drift_timeseries.json');
const REPORT_PATH = path.join(ROOT, 'drift_validation_report.json');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function hasExecutionPlan(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return false;
}

function hasCatalyst(value) {
  const text = String(value || '').trim().toLowerCase();
  return Boolean(text) && text !== 'none' && text !== 'unknown' && text !== 'n/a';
}

function calcVariance(values) {
  if (!values.length) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sq = values.reduce((acc, v) => acc + ((v - mean) ** 2), 0) / values.length;
  return sq;
}

function londonMinutes(date) {
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  return hour * 60 + minute;
}

function londonStamp(date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    dateStyle: 'short',
    timeStyle: 'medium',
    hour12: false,
  }).format(date);
}

async function collectSnapshot(index) {
  const startedAt = new Date();
  const response = await fetch(ENDPOINT, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  const rows = Array.isArray(payload?.data) ? payload.data.slice(0, SYMBOL_TRACK_COUNT) : [];

  const normalizedRows = rows.map((row, i) => ({
    rank: i + 1,
    symbol: String(row.symbol || '').toUpperCase(),
    final_score: toNumber(row.final_score, 0),
    change_percent: toNumber(row.change_percent, 0),
    relative_volume: toNumber(row.relative_volume, 0),
    strategy: String(row.strategy || ''),
    catalyst_type: row.catalyst_type ?? null,
    execution_plan: row.execution_plan ?? null,
    earnings_flag: Boolean(row.earnings_flag),
    news_count: toNumber(row.news_count, 0),
  }));

  return {
    snapshot_index: index,
    timestamp: startedAt.toISOString(),
    status: response.status,
    ok: response.ok,
    count: normalizedRows.length,
    symbols: normalizedRows,
  };
}

function analyze(snapshots) {
  const validSnapshots = snapshots.filter((s) => s.ok && s.count > 0);
  const notes = [];

  if (!validSnapshots.length) {
    return {
      persistence_rate: 0,
      avg_churn: 1,
      rank_stability: 999,
      score_volatility: 999,
      quality_ratio: 0,
      top5_tradeable_count: 0,
      verdict: 'UNSTABLE',
      market_behavior: 'ANOMALY',
      notes: ['No valid snapshots collected from endpoint.'],
      finalTop5Classifications: [],
    };
  }

  const totalSnapshots = validSnapshots.length;
  const symbolToAppearances = new Map();
  const symbolToRanks = new Map();
  const symbolToScores = new Map();

  const qualityRatios = [];
  const churnRatios = [];

  for (let i = 0; i < validSnapshots.length; i += 1) {
    const current = validSnapshots[i];
    const rows = current.symbols;

    let qualityCount = 0;

    for (const row of rows) {
      const sym = row.symbol;
      if (!sym) continue;

      symbolToAppearances.set(sym, (symbolToAppearances.get(sym) || 0) + 1);

      const ranks = symbolToRanks.get(sym) || [];
      ranks.push(row.rank);
      symbolToRanks.set(sym, ranks);

      const scores = symbolToScores.get(sym) || [];
      scores.push(row.final_score);
      symbolToScores.set(sym, scores);

      if (hasCatalyst(row.catalyst_type) && row.relative_volume >= 1.5 && hasExecutionPlan(row.execution_plan)) {
        qualityCount += 1;
      }
    }

    qualityRatios.push(rows.length ? qualityCount / rows.length : 0);

    if (i > 0) {
      const prevSymbols = new Set(validSnapshots[i - 1].symbols.map((r) => r.symbol));
      const currentSymbols = new Set(rows.map((r) => r.symbol));
      let entered = 0;
      for (const sym of currentSymbols) {
        if (!prevSymbols.has(sym)) entered += 1;
      }
      churnRatios.push(rows.length ? entered / rows.length : 1);
    }
  }

  const uniqueSymbols = Array.from(symbolToAppearances.keys());
  const persistentSymbols = uniqueSymbols.filter((sym) => (symbolToAppearances.get(sym) || 0) > totalSnapshots * 0.5);
  const persistenceRate = uniqueSymbols.length ? persistentSymbols.length / uniqueSymbols.length : 0;

  const rankVariances = uniqueSymbols.map((sym) => calcVariance(symbolToRanks.get(sym) || []));
  const avgRankVariance = rankVariances.length
    ? rankVariances.reduce((a, b) => a + b, 0) / rankVariances.length
    : 999;

  const scoreDeltas = [];
  for (const sym of uniqueSymbols) {
    const scores = symbolToScores.get(sym) || [];
    for (let i = 1; i < scores.length; i += 1) {
      scoreDeltas.push(Math.abs(scores[i] - scores[i - 1]));
    }
  }
  const avgScoreDelta = scoreDeltas.length
    ? scoreDeltas.reduce((a, b) => a + b, 0) / scoreDeltas.length
    : 999;

  const avgChurn = churnRatios.length
    ? churnRatios.reduce((a, b) => a + b, 0) / churnRatios.length
    : 0;

  const qualityRatio = qualityRatios.length
    ? qualityRatios.reduce((a, b) => a + b, 0) / qualityRatios.length
    : 0;

  const finalSnapshot = validSnapshots[validSnapshots.length - 1];
  const finalTop5 = finalSnapshot.symbols.slice(0, 5);
  const finalTop5Classifications = finalTop5.map((row) => {
    const clearCatalyst = hasCatalyst(row.catalyst_type);
    const strongVolume = row.relative_volume >= 1.5;
    const cleanSetup = hasExecutionPlan(row.execution_plan);

    const score = [clearCatalyst, strongVolume, cleanSetup].filter(Boolean).length;
    const classification = score === 3 ? 'TRADEABLE' : score === 2 ? 'WATCHLIST' : 'AVOID';

    return {
      symbol: row.symbol,
      clear_catalyst: clearCatalyst,
      strong_volume: strongVolume,
      clean_setup: cleanSetup,
      classification,
    };
  });

  const top5TradeableCount = finalTop5Classifications.filter((x) => x.classification === 'TRADEABLE').length;

  const now = new Date();
  const londonNowMinutes = londonMinutes(now);
  const inPremarket = londonNowMinutes >= (13 * 60) && londonNowMinutes < (14 * 60 + 30);
  const inOpen = londonNowMinutes >= (14 * 60 + 30);

  let marketBehavior = 'EXPECTED';

  if (inPremarket) {
    const half = Math.max(1, Math.floor(validSnapshots.length / 2));
    const firstHalf = validSnapshots.slice(0, half);
    const secondHalf = validSnapshots.slice(half);

    const meanRvol = (arr) => {
      const vals = arr.flatMap((s) => s.symbols.map((r) => r.relative_volume));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    };

    const firstRvol = meanRvol(firstHalf);
    const secondRvol = meanRvol(secondHalf);

    const firstCatalystShare = (() => {
      const rows = firstHalf.flatMap((s) => s.symbols);
      const hits = rows.filter((r) => hasCatalyst(r.catalyst_type) && (String(r.catalyst_type).toLowerCase().includes('earnings') || String(r.catalyst_type).toLowerCase().includes('news'))).length;
      return rows.length ? hits / rows.length : 0;
    })();

    const secondCatalystShare = (() => {
      const rows = secondHalf.flatMap((s) => s.symbols);
      const hits = rows.filter((r) => hasCatalyst(r.catalyst_type) && (String(r.catalyst_type).toLowerCase().includes('earnings') || String(r.catalyst_type).toLowerCase().includes('news'))).length;
      return rows.length ? hits / rows.length : 0;
    })();

    const gradualEntries = avgChurn > 0 && avgChurn <= 0.5;

    if (!(secondRvol >= firstRvol && gradualEntries && secondCatalystShare >= firstCatalystShare)) {
      marketBehavior = 'ANOMALY';
      notes.push('Premarket expectation mismatch: RVOL/catalyst trend or entry cadence not as expected.');
    } else {
      notes.push('Premarket behavior aligned with expected RVOL/catalyst drift.');
    }
  } else if (inOpen) {
    const top5Overlaps = [];
    for (let i = 1; i < validSnapshots.length; i += 1) {
      const prev = new Set(validSnapshots[i - 1].symbols.slice(0, 5).map((r) => r.symbol));
      const curr = validSnapshots[i].symbols.slice(0, 5).map((r) => r.symbol);
      let overlap = 0;
      for (const s of curr) {
        if (prev.has(s)) overlap += 1;
      }
      top5Overlaps.push(overlap / 5);
    }

    const avgTop5Overlap = top5Overlaps.length ? top5Overlaps.reduce((a, b) => a + b, 0) / top5Overlaps.length : 0;
    const highRvolTop5 = finalTop5.filter((r) => r.relative_volume >= 1.5).length;
    const validExecutionTop5 = finalTop5.filter((r) => hasExecutionPlan(r.execution_plan)).length;

    if (!(avgTop5Overlap >= 0.6 && highRvolTop5 >= 4 && validExecutionTop5 >= 4)) {
      marketBehavior = 'ANOMALY';
      notes.push('Open-session expectation mismatch: top-5 stability/RVOL/execution validity below expected.');
    } else {
      notes.push('Open-session behavior aligned with expected top-5 stability and trade setup quality.');
    }
  } else {
    notes.push(`Live market behavior window not active at ${londonStamp(now)} Europe/London; marked EXPECTED by policy.`);
  }

  const rankStabilityLow = avgRankVariance <= 6;
  const verdict = (persistenceRate >= 0.4 && avgChurn <= 0.5 && rankStabilityLow && qualityRatio >= 0.7)
    ? 'STABLE'
    : 'UNSTABLE';

  if (persistenceRate < 0.4) notes.push('Persistence rate below threshold (0.4).');
  if (avgChurn > 0.5) notes.push('Average symbol churn above threshold (0.5).');
  if (!rankStabilityLow) notes.push('Average rank variance not low (threshold <= 6).');
  if (qualityRatio < 0.7) notes.push('Average quality ratio below threshold (0.7).');

  return {
    persistence_rate: Number(persistenceRate.toFixed(4)),
    avg_churn: Number(avgChurn.toFixed(4)),
    rank_stability: Number(avgRankVariance.toFixed(4)),
    score_volatility: Number(avgScoreDelta.toFixed(4)),
    quality_ratio: Number(qualityRatio.toFixed(4)),
    top5_tradeable_count: top5TradeableCount,
    verdict,
    market_behavior: marketBehavior,
    notes,
    finalTop5Classifications,
  };
}

async function main() {
  ensureDir(LOG_DIR);

  const snapshotsTarget = Math.max(1, Math.floor((RUN_DURATION_MINUTES * 60) / INTERVAL_SECONDS));
  const snapshots = [];

  for (let i = 0; i < snapshotsTarget; i += 1) {
    try {
      const snap = await collectSnapshot(i + 1);
      snapshots.push(snap);
      console.log(`[drift] snapshot ${i + 1}/${snapshotsTarget} status=${snap.status} rows=${snap.count}`);
    } catch (error) {
      const failed = {
        snapshot_index: i + 1,
        timestamp: new Date().toISOString(),
        status: 0,
        ok: false,
        count: 0,
        error: String(error?.message || error),
        symbols: [],
      };
      snapshots.push(failed);
      console.log(`[drift] snapshot ${i + 1}/${snapshotsTarget} status=0 rows=0 error=${failed.error}`);
    }

    fs.writeFileSync(TIMESERIES_PATH, JSON.stringify({
      run_duration_minutes: RUN_DURATION_MINUTES,
      interval_seconds: INTERVAL_SECONDS,
      symbol_track_count: SYMBOL_TRACK_COUNT,
      snapshots_collected: snapshots.length,
      snapshots,
    }, null, 2));

    if (i < snapshotsTarget - 1) {
      await sleep(INTERVAL_SECONDS * 1000);
    }
  }

  const analysis = analyze(snapshots);
  const report = {
    duration_minutes: RUN_DURATION_MINUTES,
    snapshots_collected: snapshots.length,
    persistence_rate: analysis.persistence_rate,
    avg_churn: analysis.avg_churn,
    rank_stability: analysis.rank_stability,
    score_volatility: analysis.score_volatility,
    quality_ratio: analysis.quality_ratio,
    top5_tradeable_count: analysis.top5_tradeable_count,
    verdict: analysis.verdict,
    market_behavior: analysis.market_behavior,
    notes: analysis.notes,
    final_top5_human_trade_check: analysis.finalTop5Classifications,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log('DRIFT TEST COMPLETE');
  if (report.verdict === 'STABLE' && report.quality_ratio >= 0.7) {
    console.log('SYSTEM STABLE — INTELLIGENCE TRUSTABLE');
  } else {
    console.log('SYSTEM UNSTABLE — REQUIRES CALIBRATION');
  }
}

main().catch((error) => {
  ensureDir(LOG_DIR);
  const failReport = {
    duration_minutes: RUN_DURATION_MINUTES,
    snapshots_collected: 0,
    persistence_rate: 0,
    avg_churn: 1,
    rank_stability: 999,
    score_volatility: 999,
    quality_ratio: 0,
    top5_tradeable_count: 0,
    verdict: 'UNSTABLE',
    market_behavior: 'ANOMALY',
    notes: [`Runner failure: ${String(error?.message || error)}`],
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(failReport, null, 2));
  console.log('DRIFT TEST COMPLETE');
  console.log('SYSTEM UNSTABLE — REQUIRES CALIBRATION');
  process.exit(1);
});
