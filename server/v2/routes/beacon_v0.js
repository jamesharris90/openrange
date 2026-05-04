const express = require('express');
const jwt = require('jsonwebtoken');
const { SIGNALS } = require('../../beacon-v0/orchestrator/run');
const { generatePickNarrative } = require('../../beacon-v0/narrative/generateNarrative');
const { queryWithTimeout } = require('../../db/pg');
const { getLatestScreenerPayload } = require('../services/snapshotService');
const userModel = require('../../users/model');
const { JWT_SECRET } = require('../../utils/config');

const router = express.Router();

const forwardLookingMap = new Map();
SIGNALS.forEach((signal) => {
  if (signal && signal.SIGNAL_NAME) {
    forwardLookingMap.set(signal.SIGNAL_NAME, Boolean(signal.FORWARD_LOOKING));
  }
});

function enrichPickDirectionCounts(pick) {
  const signalsAligned = Array.isArray(pick.signals_aligned) ? pick.signals_aligned : [];
  const forwardCount = signalsAligned.filter((signalName) => forwardLookingMap.get(signalName) === true).length;

  return {
    ...pick,
    forward_count: forwardCount,
    backward_count: signalsAligned.length - forwardCount,
  };
}

function groupPickOutcomes(pick) {
  const {
    outcome_t1_price: t1Price,
    outcome_t1_pct_change: t1PctChange,
    outcome_t1_volume_ratio: t1VolumeRatio,
    outcome_t1_captured_at: t1CapturedAt,
    outcome_t2_price: t2Price,
    outcome_t2_pct_change: t2PctChange,
    outcome_t2_volume_ratio: t2VolumeRatio,
    outcome_t2_captured_at: t2CapturedAt,
    outcome_t3_price: t3Price,
    outcome_t3_pct_change: t3PctChange,
    outcome_t3_volume_ratio: t3VolumeRatio,
    outcome_t3_captured_at: t3CapturedAt,
    outcome_t4_price: t4Price,
    outcome_t4_pct_change: t4PctChange,
    outcome_t4_volume_ratio: t4VolumeRatio,
    outcome_t4_captured_at: t4CapturedAt,
    outcome_complete: outcomeComplete,
    ...rest
  } = pick;

  return {
    ...rest,
    outcomes: {
      t1: { price: t1Price ?? null, pct_change: t1PctChange ?? null, volume_ratio: t1VolumeRatio ?? null, captured_at: t1CapturedAt ?? null },
      t2: { price: t2Price ?? null, pct_change: t2PctChange ?? null, volume_ratio: t2VolumeRatio ?? null, captured_at: t2CapturedAt ?? null },
      t3: { price: t3Price ?? null, pct_change: t3PctChange ?? null, volume_ratio: t3VolumeRatio ?? null, captured_at: t3CapturedAt ?? null },
      t4: { price: t4Price ?? null, pct_change: t4PctChange ?? null, volume_ratio: t4VolumeRatio ?? null, captured_at: t4CapturedAt ?? null },
      complete: Boolean(outcomeComplete),
    },
  };
}

async function requireAuth(req, res, next) {
  if (!JWT_SECRET) return res.status(500).json({ error: 'Authentication service unavailable' });

  const token = req.get('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const dbUser = await userModel.findById(decoded.id).catch(() => null);
    if (!dbUser) return res.status(401).json({ error: 'Invalid token' });

    const isAdmin = dbUser.is_admin === 1 || dbUser.is_admin === true || dbUser.is_admin === '1';
    req.user = {
      id: dbUser.id,
      username: dbUser.username,
      email: dbUser.email,
      is_admin: isAdmin ? 1 : 0,
      plan: String(dbUser.plan || (isAdmin ? 'admin' : 'free')).toLowerCase(),
    };

    return next();
  } catch (_error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

async function fetchLatestPicks({ limit = 20, asOfDate = null } = {}) {
  const boundedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const result = await queryWithTimeout(
    `
      WITH ranked_runs AS (
        SELECT run_id, MAX(created_at) AS latest_created_at
        FROM beacon_v0_picks
        WHERE ($1::date IS NULL OR (created_at AT TIME ZONE 'America/New_York')::date = $1::date)
        GROUP BY run_id
      ),
      latest_run AS (
        SELECT run_id
        FROM ranked_runs
        ORDER BY latest_created_at DESC
        LIMIT 1
      )
      SELECT
        id::text AS pick_id,
        symbol,
        pattern,
        confidence,
        reasoning,
        signals_aligned,
        metadata,
        narrative_thesis,
        narrative_watch_for,
        narrative_generated_at,
        narrative_model,
        narrative_input_tokens,
        narrative_output_tokens,
        narrative_error,
        top_catalyst_tier,
        top_catalyst_rank,
        top_catalyst_reasons,
        top_catalyst_computed_at,
        pick_price,
        outcome_t1_price,
        outcome_t1_pct_change,
        outcome_t1_volume_ratio,
        outcome_t1_captured_at,
        outcome_t2_price,
        outcome_t2_pct_change,
        outcome_t2_volume_ratio,
        outcome_t2_captured_at,
        outcome_t3_price,
        outcome_t3_pct_change,
        outcome_t3_volume_ratio,
        outcome_t3_captured_at,
        outcome_t4_price,
        outcome_t4_pct_change,
        outcome_t4_volume_ratio,
        outcome_t4_captured_at,
        outcome_complete,
        (created_at AT TIME ZONE 'America/New_York')::date::text AS as_of_date,
        run_id,
        created_at
      FROM beacon_v0_picks
      WHERE run_id = (SELECT run_id FROM latest_run)
      ORDER BY symbol ASC
      LIMIT $2
    `,
    [asOfDate, boundedLimit],
    {
      label: 'beacon_v0.route.latest',
      timeoutMs: 8000,
      slowQueryMs: 1000,
      poolType: 'read',
      maxRetries: 1,
    },
  );

  return result.rows;
}

async function fetchPickPriceData(symbols) {
  const uniqueSymbols = [...new Set((symbols || []).filter(Boolean).map((symbol) => String(symbol).trim().toUpperCase()))];
  if (uniqueSymbols.length === 0) return new Map();

  const priceResult = await queryWithTimeout(
    `
      WITH latest_session AS (
        SELECT MAX(date) AS d
        FROM daily_ohlc
        WHERE symbol = ANY($1::text[])
      ),
      ranked AS (
        SELECT
          symbol,
          date,
          close,
          ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS days_back
        FROM daily_ohlc
        WHERE symbol = ANY($1::text[])
          AND date <= (SELECT d FROM latest_session)
          AND date > (SELECT d FROM latest_session) - INTERVAL '30 days'
      )
      SELECT symbol, date, close, days_back
      FROM ranked
      WHERE days_back <= 20
      ORDER BY symbol, days_back ASC
    `,
    [uniqueSymbols],
    {
      label: 'beacon_v0.price_enrichment',
      timeoutMs: 8000,
      slowQueryMs: 1000,
      poolType: 'read',
      maxRetries: 1,
    },
  );

  const priceMap = new Map();
  priceResult.rows.forEach((row) => {
    if (!priceMap.has(row.symbol)) {
      priceMap.set(row.symbol, { closes: [] });
    }

    const close = parseFloat(row.close);
    if (Number.isFinite(close)) {
      priceMap.get(row.symbol).closes.push({
        date: row.date,
        close,
        days_back: parseInt(row.days_back, 10),
      });
    }
  });

  priceMap.forEach((data) => {
    const closes = data.closes.sort((a, b) => a.days_back - b.days_back);
    const latest = closes[0];
    const prior = closes[1];

    data.latest_close = latest ? latest.close : null;
    data.prior_close = prior ? prior.close : null;
    data.change_pct = latest && prior && prior.close > 0
      ? ((latest.close - prior.close) / prior.close) * 100
      : null;
    data.sparkline = closes.slice().reverse().map((item) => item.close);
  });

  return priceMap;
}

function enrichPickPriceData(pick, priceMap) {
  const priceData = priceMap.get(pick.symbol) || {};
  return {
    ...pick,
    latest_close: priceData.latest_close ?? null,
    prior_close: priceData.prior_close ?? null,
    change_pct: priceData.change_pct ?? null,
    sparkline: priceData.sparkline || [],
  };
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeDirection(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'up' || normalized === 'bullish' || normalized === 'long') {
    return 'up';
  }
  if (normalized === 'down' || normalized === 'bearish' || normalized === 'short') {
    return 'down';
  }
  if (normalized === 'neutral') {
    return 'neutral';
  }
  return null;
}

function parseOptionalNumber(value) {
  if (value == null || value === '') {
    return null;
  }
  return toFiniteNumber(value);
}

function getSignalEvidence(pick) {
  return Array.isArray(pick?.metadata?.signal_evidence) ? pick.metadata.signal_evidence : [];
}

function findSignalByName(pick, signalName) {
  return getSignalEvidence(pick).find((entry) => entry && entry.signal === signalName) || null;
}

function collectCatalystLabels(pick, screenerRow) {
  const labels = new Set();
  const patternLabel = normalizeText(pick?.metadata?.pattern_label || pick?.pattern);
  if (patternLabel) {
    labels.add(patternLabel.toLowerCase());
  }

  const screenerCatalyst = normalizeText(screenerRow?.catalyst_type);
  if (screenerCatalyst && screenerCatalyst.toLowerCase() !== 'none') {
    labels.add(screenerCatalyst.toLowerCase());
  }

  getSignalEvidence(pick).forEach((entry) => {
    const signal = normalizeText(entry?.signal);
    const category = normalizeText(entry?.category);
    if (signal) {
      labels.add(signal.toLowerCase());
    }
    if (category) {
      labels.add(category.toLowerCase());
    }
  });

  return Array.from(labels);
}

async function fetchScreenerEnrichment(symbols) {
  const screenerPayload = await getLatestScreenerPayload().catch(() => null);
  const rows = Array.isArray(screenerPayload?.data) ? screenerPayload.data : [];
  const wantedSymbols = new Set((symbols || []).map((symbol) => String(symbol || '').trim().toUpperCase()).filter(Boolean));
  const screenerMap = new Map();

  rows.forEach((row) => {
    const symbol = String(row?.symbol || '').trim().toUpperCase();
    if (!symbol || !wantedSymbols.has(symbol)) {
      return;
    }

    screenerMap.set(symbol, {
      symbol,
      price: toFiniteNumber(row.price),
      market_cap: toFiniteNumber(row.market_cap),
      rvol: toFiniteNumber(row.rvol),
      gap_percent: toFiniteNumber(row.gap_percent ?? row.gapPercent),
      catalyst_type: normalizeText(row.catalyst_type),
      sector: normalizeText(row.sector),
      company_name: normalizeText(row.company_name || row.name),
    });
  });

  return screenerMap;
}

function enrichPickMarketData(pick, screenerMap) {
  const screenerRow = screenerMap.get(pick.symbol) || null;
  const gapSignal = findSignalByName(pick, 'top_gap_today');
  const rvolSignal = findSignalByName(pick, 'top_rvol_today');
  const alignmentCount = toFiniteNumber(pick?.metadata?.alignment?.alignmentCount) ?? pick.signals_aligned.length;
  const resolvedDirection = normalizeDirection(
    pick?.metadata?.direction || gapSignal?.metadata?.direction || null
  ) || 'neutral';

  return {
    ...pick,
    display_price: pick.latest_close ?? screenerRow?.price ?? toFiniteNumber(pick.pick_price) ?? null,
    market_cap: screenerRow?.market_cap ?? null,
    rvol: screenerRow?.rvol ?? toFiniteNumber(rvolSignal?.metadata?.rvol) ?? null,
    gap_percent: screenerRow?.gap_percent ?? toFiniteNumber(gapSignal?.metadata?.gap_pct) ?? null,
    catalyst_type: screenerRow?.catalyst_type ?? null,
    sector: screenerRow?.sector ?? null,
    company_name: screenerRow?.company_name ?? null,
    direction: resolvedDirection,
    alignment_count: alignmentCount,
    is_top_catalyst: Number(pick.top_catalyst_tier || 0) > 0 && Number(pick.top_catalyst_rank || 0) > 0,
    catalyst_labels: collectCatalystLabels(pick, screenerRow),
  };
}

function matchesFilters(pick, filters) {
  const price = toFiniteNumber(pick.display_price);
  const marketCap = toFiniteNumber(pick.market_cap);
  const rvol = toFiniteNumber(pick.rvol);
  const gapPercent = toFiniteNumber(pick.gap_percent);

  if (filters.tier != null && Number(pick.top_catalyst_tier || 0) !== filters.tier) {
    return false;
  }
  if (filters.minPrice != null && (price == null || price < filters.minPrice)) {
    return false;
  }
  if (filters.maxPrice != null && (price == null || price > filters.maxPrice)) {
    return false;
  }
  if (filters.minMarketCap != null && (marketCap == null || marketCap < filters.minMarketCap)) {
    return false;
  }
  if (filters.maxMarketCap != null && (marketCap == null || marketCap > filters.maxMarketCap)) {
    return false;
  }
  if (filters.minRvol != null && (rvol == null || rvol < filters.minRvol)) {
    return false;
  }
  if (filters.minGap != null && (gapPercent == null || Math.abs(gapPercent) < filters.minGap)) {
    return false;
  }
  if (filters.direction && pick.direction !== filters.direction) {
    return false;
  }
  if (filters.catalyst && !pick.catalyst_labels.includes(filters.catalyst)) {
    return false;
  }
  if (filters.topScope === 'only' && !pick.is_top_catalyst) {
    return false;
  }
  if (filters.topScope === 'exclude' && pick.is_top_catalyst) {
    return false;
  }
  return true;
}

router.get('/picks', async (req, res) => {
  try {
    const asOfDate = req.query.date ? String(req.query.date).trim() : null;
    if (asOfDate && !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
      return res.status(400).json({ error: 'invalid date format, expected YYYY-MM-DD' });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const tier = parseOptionalNumber(req.query.tier);
    const topScope = ['all', 'only', 'exclude'].includes(String(req.query.topScope || 'all'))
      ? String(req.query.topScope || 'all')
      : 'all';
    const filters = {
      tier: tier == null ? null : Number(tier),
      minPrice: parseOptionalNumber(req.query.minPrice),
      maxPrice: parseOptionalNumber(req.query.maxPrice),
      minMarketCap: parseOptionalNumber(req.query.minMarketCap),
      maxMarketCap: parseOptionalNumber(req.query.maxMarketCap),
      minRvol: parseOptionalNumber(req.query.minRvol),
      minGap: parseOptionalNumber(req.query.minGap),
      direction: normalizeDirection(req.query.direction),
      catalyst: normalizeText(req.query.catalyst)?.toLowerCase() || null,
      topScope,
    };

    const picks = (await fetchLatestPicks({ limit: 100, asOfDate })).map(enrichPickDirectionCounts);
    const priceMap = await fetchPickPriceData(picks.map((pick) => pick.symbol));
    const screenerMap = await fetchScreenerEnrichment(picks.map((pick) => pick.symbol));
    const enrichedPicks = picks
      .map((pick) => enrichPickMarketData(groupPickOutcomes(enrichPickPriceData(pick, priceMap)), screenerMap))
      .filter((pick) => matchesFilters(pick, filters))
      .slice(0, limit);

    return res.json({
      picks: enrichedPicks,
      count: enrichedPicks.length,
      version: 'v0',
      generated_at: enrichedPicks[0]?.created_at || null,
      run_id: enrichedPicks[0]?.run_id || null,
      as_of_date: enrichedPicks[0]?.as_of_date || asOfDate,
      filters,
    });
  } catch (error) {
    console.error('beacon_v0_picks_failed:', error.message);
    return res.status(500).json({
      error: 'beacon_v0_picks_failed',
      message: error.message,
    });
  }
});

router.post('/regenerate-narrative/:pick_id', requireAuth, async (req, res) => {
  const { pick_id: pickId } = req.params;

  if (!pickId || !/^\d+$/.test(String(pickId))) {
    return res.status(400).json({ error: 'invalid pick_id' });
  }

  try {
    const result = await queryWithTimeout(
      `
        SELECT
          id::text AS pick_id,
          run_id,
          symbol,
          pattern,
          COALESCE(metadata->>'pattern_label', pattern) AS pattern_label,
          confidence,
          signals_aligned,
          reasoning,
          metadata,
          narrative_thesis,
          narrative_watch_for
        FROM beacon_v0_picks
        WHERE id = $1
        LIMIT 1
      `,
      [pickId],
      {
        label: 'beacon_v0.regenerate.fetch',
        timeoutMs: 5000,
        slowQueryMs: 1000,
        poolType: 'read',
        maxRetries: 1,
      },
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'pick not found' });
    }

    const pick = result.rows[0];
    const narrative = await generatePickNarrative(pick);

    if (narrative.error) {
      return res.status(502).json({
        error: 'narrative generation failed',
        detail: narrative.error,
      });
    }

    const updateResult = await queryWithTimeout(
      `
        UPDATE beacon_v0_picks
        SET narrative_thesis = $1,
            narrative_watch_for = $2,
            narrative_generated_at = NOW(),
            narrative_model = $3,
            narrative_input_tokens = $4,
            narrative_output_tokens = $5,
            narrative_error = NULL
        WHERE id = $6
        RETURNING narrative_generated_at
      `,
      [
        narrative.thesis,
        narrative.watch_for,
        narrative.model || 'claude-sonnet-4-5',
        narrative.input_tokens || 0,
        narrative.output_tokens || 0,
        pickId,
      ],
      {
        label: 'beacon_v0.regenerate.update',
        timeoutMs: 5000,
        slowQueryMs: 1000,
        poolType: 'write',
        maxRetries: 1,
      },
    );

    return res.json({
      pick_id: pickId,
      narrative_thesis: narrative.thesis,
      narrative_watch_for: narrative.watch_for,
      narrative_generated_at: updateResult.rows[0]?.narrative_generated_at || new Date().toISOString(),
      input_tokens: narrative.input_tokens || 0,
      output_tokens: narrative.output_tokens || 0,
    });
  } catch (error) {
    console.error('[beacon-v0] regenerate-narrative error:', error);
    return res.status(500).json({
      error: 'internal error',
      detail: String(error.message || error),
    });
  }
});

module.exports = router;