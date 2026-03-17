const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const { clamp } = require('../config/catalystEngineConfig');

function safeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function classifyReactionType({ sentimentScore, currentMove, abnormalVolumeRatio, continuationProbability, shortInterest }) {
  if (abnormalVolumeRatio >= 2.2 && currentMove >= 1 && safeNumber(shortInterest) >= 12) {
    return 'squeeze';
  }

  if (continuationProbability >= 0.65 && currentMove >= 0.5) {
    return 'continuation';
  }

  if (sentimentScore >= 0.2 && currentMove < -0.4) {
    return 'sell_the_news';
  }

  if (sentimentScore <= -0.2 && currentMove > 0.4) {
    return 'fade';
  }

  return 'watch';
}

function computeExpectationGap({ epsSurprisePct, revSurprisePct, recentHeadline72h, recentHeadline7d, move1dPct, move3dPct }) {
  const epsComponent = clamp(safeNumber(epsSurprisePct) / 25, -1, 1);
  const revComponent = clamp(safeNumber(revSurprisePct) / 25, -1, 1);
  const cadencePenalty = clamp(((safeNumber(recentHeadline72h) * 0.1) + (safeNumber(recentHeadline7d) * 0.03)) / 5, 0, 1);
  const pricedInPenalty = clamp(Math.abs(safeNumber(move3dPct)) / 9, 0, 1);
  const moveBias = clamp((safeNumber(move1dPct) * 0.2) + (safeNumber(move3dPct) * 0.1), -1, 1);

  const score = clamp((epsComponent * 0.35) + (revComponent * 0.2) + (moveBias * 0.15) - (cadencePenalty * 0.15) - (pricedInPenalty * 0.15), -1, 1);
  const pricedInFlag = pricedInPenalty > 0.65 && Math.abs(score) < 0.2;

  return {
    expectationGapScore: Number(score.toFixed(4)),
    pricedInFlag,
  };
}

async function fetchPendingIntelligence(limit = 300) {
  const { rows } = await queryWithTimeout(
    `SELECT
       ci.news_id,
       ci.symbol,
       ci.sector,
       ci.sentiment_score,
       ci.confidence_score,
       ci.short_interest,
       ci.created_at,
       ce.published_at
     FROM catalyst_intelligence ci
     LEFT JOIN catalyst_events ce ON ce.news_id = ci.news_id
     WHERE NOT EXISTS (
       SELECT 1 FROM catalyst_reactions cr WHERE cr.news_id = ci.news_id
     )
     ORDER BY ci.created_at DESC
     LIMIT $1`,
    [limit],
    { timeoutMs: 12000, label: 'catalyst_reaction.fetch_pending', maxRetries: 1 }
  );

  return rows;
}

async function fetchMarketContext(symbol, sector) {
  const [quoteRes, indexRes, sectorRes] = await Promise.all([
    queryWithTimeout(
      `SELECT symbol, price, change_percent, relative_volume
       FROM market_quotes
       WHERE symbol = $1
       LIMIT 1`,
      [symbol],
      { timeoutMs: 5000, label: 'catalyst_reaction.quote', maxRetries: 0 }
    ),
    queryWithTimeout(
      `SELECT symbol, change_percent
       FROM market_quotes
       WHERE symbol IN ('QQQ', 'SPY')`,
      [],
      { timeoutMs: 5000, label: 'catalyst_reaction.indices', maxRetries: 0 }
    ),
    queryWithTimeout(
      `SELECT AVG(COALESCE(change_percent, 0))::numeric AS sector_avg_change
       FROM market_quotes
       WHERE COALESCE(sector, '') = COALESCE($1, '')`,
      [sector || ''],
      { timeoutMs: 5000, label: 'catalyst_reaction.sector', maxRetries: 0 }
    ),
  ]);

  const quote = quoteRes.rows[0] || {};
  const qqq = indexRes.rows.find((row) => row.symbol === 'QQQ') || {};
  const spy = indexRes.rows.find((row) => row.symbol === 'SPY') || {};
  const sectorAvg = safeNumber(sectorRes.rows[0]?.sector_avg_change, 0);
  const symbolChange = safeNumber(quote.change_percent, 0);

  return {
    quote,
    qqqTrend: safeNumber(qqq.change_percent, 0),
    spyTrend: safeNumber(spy.change_percent, 0),
    sectorAlignment: Number((symbolChange - sectorAvg).toFixed(4)),
  };
}

async function fetchIntradayReaction(symbol, eventTs) {
  const { rows } = await queryWithTimeout(
    `WITH latest AS (
       SELECT close, volume, timestamp
       FROM intraday_1m
       WHERE symbol = $1
       ORDER BY timestamp DESC
       LIMIT 1
     ),
     first_bar AS (
       SELECT close, timestamp
       FROM intraday_1m
       WHERE symbol = $1
         AND timestamp >= $2
       ORDER BY timestamp ASC
       LIMIT 1
     ),
     bar_5m AS (
       SELECT close
       FROM intraday_1m
       WHERE symbol = $1
         AND timestamp >= ($2 + INTERVAL '5 minutes')
       ORDER BY timestamp ASC
       LIMIT 1
     ),
     vol_now AS (
       SELECT SUM(volume)::numeric AS vol_5m
       FROM intraday_1m
       WHERE symbol = $1
         AND timestamp >= NOW() - INTERVAL '5 minutes'
     ),
     vol_baseline AS (
       SELECT AVG(volume)::numeric AS avg_1m
       FROM intraday_1m
       WHERE symbol = $1
         AND timestamp >= NOW() - INTERVAL '90 minutes'
         AND timestamp < NOW() - INTERVAL '5 minutes'
     )
     SELECT
       latest.close AS latest_close,
       latest.timestamp AS latest_timestamp,
       first_bar.close AS first_close,
       bar_5m.close AS close_5m,
       vol_now.vol_5m,
       vol_baseline.avg_1m
     FROM latest
     LEFT JOIN first_bar ON TRUE
     LEFT JOIN bar_5m ON TRUE
     LEFT JOIN vol_now ON TRUE
     LEFT JOIN vol_baseline ON TRUE`,
    [symbol, eventTs],
    { timeoutMs: 8000, label: 'catalyst_reaction.intraday', maxRetries: 0 }
  );

  const row = rows[0] || {};
  const firstClose = safeNumber(row.first_close, 0);
  const close5m = safeNumber(row.close_5m, 0);
  const latestClose = safeNumber(row.latest_close, firstClose);
  const latestTimestamp = row.latest_timestamp ? new Date(row.latest_timestamp) : null;
  const vol5m = safeNumber(row.vol_5m, 0);
  const avg1m = safeNumber(row.avg_1m, 0);

  if (latestTimestamp) {
    const lagMinutes = (Date.now() - latestTimestamp.getTime()) / 60000;
    if (lagMinutes > 20) {
      logger.warn('[CATALYST_REACTION] stale intraday data', {
        symbol,
        lagMinutes: Number(lagMinutes.toFixed(1)),
        latestTimestamp: latestTimestamp.toISOString(),
      });
    }
  }

  const first5mMove = firstClose > 0 ? ((close5m - firstClose) / firstClose) * 100 : 0;
  const currentMove = firstClose > 0 ? ((latestClose - firstClose) / firstClose) * 100 : 0;
  const abnormalVolumeRatio = avg1m > 0 ? vol5m / (avg1m * 5) : 0;

  return {
    first5mMove: Number(first5mMove.toFixed(4)),
    currentMove: Number(currentMove.toFixed(4)),
    abnormalVolumeRatio: Number(abnormalVolumeRatio.toFixed(4)),
  };
}

async function fetchExpectationInputs(symbol, eventTs) {
  const [earningsRes, cadenceRes, moveRes] = await Promise.all([
    queryWithTimeout(
      `SELECT eps_surprise_pct, rev_surprise_pct, eps_estimate, rev_estimate
       FROM earnings_events
       WHERE symbol = $1
       ORDER BY COALESCE(earnings_date, report_date) DESC NULLS LAST
       LIMIT 1`,
      [symbol],
      { timeoutMs: 6000, label: 'catalyst_reaction.earnings_inputs', maxRetries: 0 }
    ),
    queryWithTimeout(
      `SELECT
         COUNT(*) FILTER (WHERE published_at >= ($2::timestamptz - INTERVAL '72 hours'))::int AS headline_72h,
         COUNT(*) FILTER (WHERE published_at >= ($2::timestamptz - INTERVAL '7 days'))::int AS headline_7d
       FROM news_articles
       WHERE symbol = $1`,
      [symbol, eventTs],
      { timeoutMs: 6000, label: 'catalyst_reaction.news_cadence', maxRetries: 0 }
    ),
    queryWithTimeout(
      `WITH ordered AS (
         SELECT date, close
         FROM daily_ohlc
         WHERE symbol = $1
         ORDER BY date DESC
         LIMIT 4
       )
       SELECT
         MAX(CASE WHEN rn = 1 THEN close END) AS c0,
         MAX(CASE WHEN rn = 2 THEN close END) AS c1,
         MAX(CASE WHEN rn = 4 THEN close END) AS c3
       FROM (
         SELECT close, ROW_NUMBER() OVER (ORDER BY date DESC) AS rn
         FROM ordered
       ) x`,
      [symbol],
      { timeoutMs: 6000, label: 'catalyst_reaction.price_move_inputs', maxRetries: 0 }
    ),
  ]);

  const earnings = earningsRes.rows[0] || {};
  const cadence = cadenceRes.rows[0] || {};
  const move = moveRes.rows[0] || {};

  const c0 = safeNumber(move.c0, 0);
  const c1 = safeNumber(move.c1, 0);
  const c3 = safeNumber(move.c3, 0);

  const move1dPct = c1 > 0 ? ((c0 - c1) / c1) * 100 : 0;
  const move3dPct = c3 > 0 ? ((c0 - c3) / c3) * 100 : 0;

  return {
    epsSurprisePct: safeNumber(earnings.eps_surprise_pct, 0),
    revSurprisePct: safeNumber(earnings.rev_surprise_pct, 0),
    epsEstimate: safeNumber(earnings.eps_estimate, 0),
    revEstimate: safeNumber(earnings.rev_estimate, 0),
    recentHeadline72h: safeNumber(cadence.headline_72h, 0),
    recentHeadline7d: safeNumber(cadence.headline_7d, 0),
    move1dPct,
    move3dPct,
  };
}

function computeContinuationProbability({ confidenceScore, abnormalVolumeRatio, currentMove, sectorAlignment, qqqTrend, spyTrend, expectationGapScore }) {
  const confidence = clamp(safeNumber(confidenceScore), 0, 1);
  const volume = clamp(safeNumber(abnormalVolumeRatio) / 3, 0, 1);
  const move = clamp(Math.abs(safeNumber(currentMove)) / 4, 0, 1);
  const alignment = clamp((safeNumber(sectorAlignment) + safeNumber(qqqTrend) + safeNumber(spyTrend) + 3) / 6, 0, 1);
  const expectation = clamp((safeNumber(expectationGapScore) + 1) / 2, 0, 1);

  return Number(clamp(
    (confidence * 0.35)
    + (volume * 0.2)
    + (move * 0.15)
    + (alignment * 0.15)
    + (expectation * 0.15),
    0,
    1
  ).toFixed(4));
}

async function upsertReaction(row) {
  await queryWithTimeout(
    `INSERT INTO catalyst_reactions (
       symbol,
       news_id,
       reaction_type,
       abnormal_volume_ratio,
       first_5m_move,
       current_move,
       continuation_probability,
       expectation_gap_score,
       priced_in_flag,
       qqq_trend,
       spy_trend,
       sector_alignment,
       is_tradeable_now,
       created_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11, $12, $13, NOW()
     )
    ON CONFLICT (news_id) WHERE news_id IS NOT NULL
     DO UPDATE SET
       reaction_type = EXCLUDED.reaction_type,
       abnormal_volume_ratio = EXCLUDED.abnormal_volume_ratio,
       first_5m_move = EXCLUDED.first_5m_move,
       current_move = EXCLUDED.current_move,
       continuation_probability = EXCLUDED.continuation_probability,
       expectation_gap_score = EXCLUDED.expectation_gap_score,
       priced_in_flag = EXCLUDED.priced_in_flag,
       qqq_trend = EXCLUDED.qqq_trend,
       spy_trend = EXCLUDED.spy_trend,
       sector_alignment = EXCLUDED.sector_alignment,
       is_tradeable_now = EXCLUDED.is_tradeable_now,
       created_at = NOW()`,
    [
      row.symbol,
      row.news_id,
      row.reaction_type,
      row.abnormal_volume_ratio,
      row.first_5m_move,
      row.current_move,
      row.continuation_probability,
      row.expectation_gap_score,
      row.priced_in_flag,
      row.qqq_trend,
      row.spy_trend,
      row.sector_alignment,
      row.is_tradeable_now,
    ],
    { timeoutMs: 10000, label: 'catalyst_reaction.upsert', maxRetries: 0 }
  );
}

async function runCatalystReactionEngine(options = {}) {
  const limit = Number(options.limit) > 0 ? Number(options.limit) : 300;
  const rows = await fetchPendingIntelligence(limit);

  let insertedOrUpdated = 0;
  for (const row of rows) {
    const eventTs = row.published_at || row.created_at || new Date().toISOString();
    const intraday = await fetchIntradayReaction(row.symbol, eventTs);
    const context = await fetchMarketContext(row.symbol, row.sector);
    const expectationInputs = await fetchExpectationInputs(row.symbol, eventTs);
    const expectation = computeExpectationGap(expectationInputs);

    const continuationProbability = computeContinuationProbability({
      confidenceScore: row.confidence_score,
      abnormalVolumeRatio: intraday.abnormalVolumeRatio,
      currentMove: intraday.currentMove,
      sectorAlignment: context.sectorAlignment,
      qqqTrend: context.qqqTrend,
      spyTrend: context.spyTrend,
      expectationGapScore: expectation.expectationGapScore,
    });

    const reactionType = classifyReactionType({
      sentimentScore: row.sentiment_score,
      currentMove: intraday.currentMove,
      abnormalVolumeRatio: intraday.abnormalVolumeRatio,
      continuationProbability,
      shortInterest: row.short_interest,
    });

    const isTradeableNow = continuationProbability >= 0.55
      && intraday.abnormalVolumeRatio >= 1.2
      && Math.abs(intraday.currentMove) >= 0.3
      && !expectation.pricedInFlag;

    await upsertReaction({
      symbol: row.symbol,
      news_id: row.news_id,
      reaction_type: reactionType,
      abnormal_volume_ratio: intraday.abnormalVolumeRatio,
      first_5m_move: intraday.first5mMove,
      current_move: intraday.currentMove,
      continuation_probability: continuationProbability,
      expectation_gap_score: expectation.expectationGapScore,
      priced_in_flag: expectation.pricedInFlag,
      qqq_trend: context.qqqTrend,
      spy_trend: context.spyTrend,
      sector_alignment: context.sectorAlignment,
      is_tradeable_now: isTradeableNow,
    });

    insertedOrUpdated += 1;
  }

  const result = {
    scanned: rows.length,
    insertedOrUpdated,
  };

  logger.info('[CATALYST_REACTION] completed', result);
  return result;
}

module.exports = {
  runCatalystReactionEngine,
};
