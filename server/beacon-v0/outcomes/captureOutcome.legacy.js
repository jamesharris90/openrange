const { queryWithTimeout } = require('../../db/pg');
const { fetchQuotesForSymbols } = require('../../services/quoteService');

const CHECKPOINT_COLUMNS = {
  1: {
    price: 'outcome_t1_price',
    pctChange: 'outcome_t1_pct_change',
    volumeRatio: 'outcome_t1_volume_ratio',
    capturedAt: 'outcome_t1_captured_at',
  },
  2: {
    price: 'outcome_t2_price',
    pctChange: 'outcome_t2_pct_change',
    volumeRatio: 'outcome_t2_volume_ratio',
    capturedAt: 'outcome_t2_captured_at',
  },
  3: {
    price: 'outcome_t3_price',
    pctChange: 'outcome_t3_pct_change',
    volumeRatio: 'outcome_t3_volume_ratio',
    capturedAt: 'outcome_t3_captured_at',
  },
  4: {
    price: 'outcome_t4_price',
    pctChange: 'outcome_t4_pct_change',
    volumeRatio: 'outcome_t4_volume_ratio',
    capturedAt: 'outcome_t4_captured_at',
  },
};

function assertCheckpoint(checkpointNumber) {
  const columns = CHECKPOINT_COLUMNS[Number(checkpointNumber)];
  if (!columns) {
    throw new Error(`invalid checkpoint number: ${checkpointNumber}`);
  }
  return columns;
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getCheckpointWindowClause(checkpointNumber) {
  switch (Number(checkpointNumber)) {
    case 1:
      return `
        created_at BETWEEN NOW() - INTERVAL '75 minutes'
          AND NOW() - INTERVAL '55 minutes'
      `;
    case 2:
      return `
        created_at <= ((created_at AT TIME ZONE 'UTC')::date + TIME '15:00') AT TIME ZONE 'UTC'
        AND NOW() >= ((created_at AT TIME ZONE 'UTC')::date + TIME '15:00') AT TIME ZONE 'UTC'
      `;
    case 3:
      return `
        created_at <= ((created_at AT TIME ZONE 'UTC')::date + TIME '21:00') AT TIME ZONE 'UTC'
        AND NOW() >= ((created_at AT TIME ZONE 'UTC')::date + TIME '21:00') AT TIME ZONE 'UTC'
      `;
    case 4:
      return `
        created_at <= (
          (created_at AT TIME ZONE 'UTC')::date
          + CASE
              WHEN EXTRACT(ISODOW FROM created_at AT TIME ZONE 'UTC') = 5 THEN 3
              WHEN EXTRACT(ISODOW FROM created_at AT TIME ZONE 'UTC') = 6 THEN 2
              ELSE 1
            END
          + TIME '13:30'
        ) AT TIME ZONE 'UTC'
        AND NOW() >= (
          (created_at AT TIME ZONE 'UTC')::date
          + CASE
              WHEN EXTRACT(ISODOW FROM created_at AT TIME ZONE 'UTC') = 5 THEN 3
              WHEN EXTRACT(ISODOW FROM created_at AT TIME ZONE 'UTC') = 6 THEN 2
              ELSE 1
            END
          + TIME '13:30'
        ) AT TIME ZONE 'UTC'
      `;
    default:
      throw new Error(`invalid checkpoint number: ${checkpointNumber}`);
  }
}

async function expireStaleOutcomePicks() {
  return runExpirySweep();
}

async function runExpirySweep() {
  const result = await queryWithTimeout(
    `
      UPDATE beacon_v0_picks
      SET outcome_complete = true
      WHERE outcome_complete = false
        AND NOW() > created_at + INTERVAL '30 hours'
      RETURNING id
    `,
    [],
    {
      label: 'beacon_v0_outcomes.expiry_sweep',
      timeoutMs: 15000,
      poolType: 'write',
    },
  );

  return { rows_marked_complete: result.rowCount };
}

async function findPicksNeedingCapture(checkpointNumber) {
  const columns = assertCheckpoint(checkpointNumber);
  const windowClause = getCheckpointWindowClause(checkpointNumber);

  await expireStaleOutcomePicks();

  const result = await queryWithTimeout(
    `
      SELECT
        id::text AS id,
        symbol,
        pick_price,
        pick_volume_baseline,
        baseline_source,
        created_at,
        ${columns.capturedAt} AS checkpoint_captured_at
      FROM beacon_v0_picks
      WHERE outcome_complete = false
        AND baseline_source != 'unavailable'
        AND pick_price IS NOT NULL
        AND pick_price > 0
        AND ${columns.capturedAt} IS NULL
        AND (${windowClause})
      ORDER BY created_at ASC, id ASC
      LIMIT 100
    `,
    [],
    {
      label: `beacon_v0.outcomes.find_t${Number(checkpointNumber)}`,
      timeoutMs: 8000,
      slowQueryMs: 1000,
      poolType: 'read',
      maxRetries: 1,
    },
  );

  return result.rows;
}

function readQuotePrice(quote) {
  return toFiniteNumber(quote?.price ?? quote?.c ?? quote?.close ?? quote?.previousClose);
}

function readQuoteVolume(quote) {
  return toFiniteNumber(quote?.volume ?? quote?.volAvg ?? quote?.avgVolume);
}

async function capturePickOutcome(pick, checkpointNumber) {
  const columns = assertCheckpoint(checkpointNumber);
  const pickId = String(pick?.id || pick?.pick_id || '').trim();
  const symbol = String(pick?.symbol || '').trim().toUpperCase();
  if (!pickId || !symbol) {
    throw new Error('pick id and symbol are required for outcome capture');
  }

  const currentResult = await queryWithTimeout(
    `
      SELECT
        id::text AS id,
        symbol,
        pick_price,
        pick_volume_baseline,
        baseline_source,
        ${columns.capturedAt} AS checkpoint_captured_at
      FROM beacon_v0_picks
      WHERE id = $1
      LIMIT 1
    `,
    [pickId],
    {
      label: `beacon_v0.outcomes.current_t${Number(checkpointNumber)}`,
      timeoutMs: 5000,
      slowQueryMs: 1000,
      poolType: 'read',
      maxRetries: 1,
    },
  );

  const current = currentResult.rows[0];
  if (!current) {
    throw new Error(`beacon_v0 pick not found for outcome capture: ${pickId}`);
  }
  if (current.checkpoint_captured_at) {
    return { captured: false, skipped: 'already_captured', pickId };
  }
  if (current.baseline_source === 'unavailable') {
    return { captured: false, skipped: 'unavailable_baseline', pickId };
  }

  const pickPrice = toFiniteNumber(current.pick_price ?? pick.pick_price);
  if (!pickPrice || pickPrice <= 0) {
    throw new Error(`beacon_v0 pick_price invalid for ${symbol}; cannot compute outcome`);
  }

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    throw new Error('FMP_API_KEY missing');
  }

  const quotes = await fetchQuotesForSymbols([symbol], apiKey, console, false);
  const quote = quotes.get(symbol);
  const price = readQuotePrice(quote);
  if (price == null) {
    throw new Error(`FMP quote price unavailable for ${symbol}`);
  }

  const currentVolume = readQuoteVolume(quote);
  const volumeBaseline = toFiniteNumber(current.pick_volume_baseline ?? pick.pick_volume_baseline);
  const pctChange = ((price - pickPrice) / pickPrice) * 100;
  const volumeRatio = volumeBaseline && volumeBaseline > 0 && currentVolume != null
    ? currentVolume / volumeBaseline
    : null;

  const updateResult = await queryWithTimeout(
    `
      UPDATE beacon_v0_picks
      SET ${columns.price} = $1,
          ${columns.pctChange} = $2,
          ${columns.volumeRatio} = $3,
          ${columns.capturedAt} = NOW()
      WHERE id = $4
        AND ${columns.capturedAt} IS NULL
      RETURNING id::text AS id, ${columns.capturedAt} AS captured_at
    `,
    [price, pctChange, volumeRatio, pickId],
    {
      label: `beacon_v0.outcomes.capture_t${Number(checkpointNumber)}`,
      timeoutMs: 8000,
      slowQueryMs: 1000,
      poolType: 'write',
      maxRetries: 1,
    },
  );

  if (updateResult.rows.length === 0) {
    return { captured: false, skipped: 'already_captured', pickId };
  }

  return {
    captured: true,
    pickId,
    symbol,
    price,
    pct_change: pctChange,
    volume_ratio: volumeRatio,
    captured_at: updateResult.rows[0].captured_at,
  };
}

async function markOutcomeCompleteIfDone(pickId) {
  const result = await queryWithTimeout(
    `
      UPDATE beacon_v0_picks
      SET outcome_complete = true
      WHERE id = $1
        AND outcome_complete = false
        AND (
          (
            outcome_t1_captured_at IS NOT NULL
            AND outcome_t2_captured_at IS NOT NULL
            AND outcome_t3_captured_at IS NOT NULL
            AND outcome_t4_captured_at IS NOT NULL
          )
          OR NOW() > created_at + INTERVAL '30 hours'
        )
      RETURNING id::text AS id, outcome_complete
    `,
    [pickId],
    {
      label: 'beacon_v0.outcomes.mark_complete',
      timeoutMs: 8000,
      slowQueryMs: 1000,
      poolType: 'write',
      maxRetries: 1,
    },
  );

  return { completed: result.rows.length > 0, pickId: String(pickId) };
}

module.exports = {
  findPicksNeedingCapture,
  capturePickOutcome,
  markOutcomeCompleteIfDone,
  runExpirySweep,
};