const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const { loadAndValidateTruth } = require('./_truthGuard');

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function runCatalystValidationEngine() {
  const startedAt = Date.now();

  loadAndValidateTruth({
    requiredTables: {
      opportunity_stream: ['id', 'symbol', 'event_type', 'headline', 'source', 'change_percent', 'catalyst_type', 'earnings_flag', 'updated_at'],
      news_articles: ['symbol', 'title', 'published_at', 'source', 'headline'],
      earnings_events: ['symbol', 'report_date'],
    },
    requiredMappings: ['stock-news', 'earnings-calendar'],
  });

  const { rows: signals } = await queryWithTimeout(
    `SELECT id, symbol, change_percent
     FROM opportunity_stream
     WHERE source = 'real'
       AND event_type = 'signal_quality_engine'
     ORDER BY score DESC
     LIMIT 20`,
    [],
    { timeoutMs: 9000, label: 'engines.catalystValidationEngine.select_signals', maxRetries: 0 }
  );

  if (!signals.length) {
    throw new Error('catalyst validation found no signal rows');
  }

  let updated = 0;
  let rejected = 0;
  for (const signal of signals) {
    const symbol = String(signal.symbol || '').trim().toUpperCase();

    const { rows: newsRows } = await queryWithTimeout(
      `SELECT
         COALESCE(NULLIF(title, ''), NULLIF(headline, ''), 'News catalyst') AS headline
       FROM news_articles
       WHERE symbol = $1
       ORDER BY published_at DESC NULLS LAST, created_at DESC NULLS LAST
       LIMIT 1`,
      [symbol],
      { timeoutMs: 7000, label: 'engines.catalystValidationEngine.news_lookup', maxRetries: 0 }
    );

    const { rows: earningsRows } = await queryWithTimeout(
      `SELECT symbol
       FROM earnings_events
       WHERE symbol = $1
         AND report_date BETWEEN CURRENT_DATE - INTERVAL '7 days' AND CURRENT_DATE + INTERVAL '14 days'
       ORDER BY report_date ASC
       LIMIT 1`,
      [symbol],
      { timeoutMs: 7000, label: 'engines.catalystValidationEngine.earnings_lookup', maxRetries: 0 }
    );

    const headline = newsRows[0]?.headline || null;
    const earningsFlag = earningsRows.length > 0;

    let catalystType = null;
    if (headline) {
      catalystType = 'NEWS';
    } else if (earningsFlag) {
      catalystType = 'EARNINGS';
    } else if (Math.abs(asNumber(signal.change_percent)) >= 4) {
      catalystType = 'TECHNICAL';
    }

    if (!catalystType && Math.abs(asNumber(signal.change_percent)) < 4) {
      await queryWithTimeout(
        `DELETE FROM opportunity_stream WHERE id = $1`,
        [signal.id],
        { timeoutMs: 5000, label: 'engines.catalystValidationEngine.delete_weak_uncatalyzed', maxRetries: 0 }
      );
      rejected += 1;
      continue;
    }

    await queryWithTimeout(
      `UPDATE opportunity_stream
       SET headline = COALESCE($2, headline),
           catalyst_type = $3,
           earnings_flag = $4,
           updated_at = NOW()
       WHERE id = $1`,
      [signal.id, headline, catalystType, earningsFlag],
      { timeoutMs: 6000, label: 'engines.catalystValidationEngine.update_signal', maxRetries: 0 }
    );

    updated += 1;
  }

  const { rows: countRows } = await queryWithTimeout(
    `SELECT COUNT(*)::int AS c
     FROM opportunity_stream
     WHERE source = 'real'
       AND event_type = 'signal_quality_engine'`,
    [],
    { timeoutMs: 7000, label: 'engines.catalystValidationEngine.count_remaining', maxRetries: 0 }
  );

  const remaining = Number(countRows[0]?.c || 0);
  if (remaining < 5) {
    throw new Error(`catalyst gate failed; remaining validated signals=${remaining}`);
  }

  logger.info('[CATALYST ENGINE]', {
    count: updated,
    rejected,
    remaining,
    runtimeMs: Date.now() - startedAt,
  });

  return {
    count: updated,
    rejected,
    remaining,
    runtimeMs: Date.now() - startedAt,
  };
}

module.exports = {
  runCatalystValidationEngine,
};
