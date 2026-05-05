const { queryWithTimeout } = require('../db/pg');
const logger = require('../utils/logger');
const { resolveSmartMoneyWorkingSet } = require('../services/smartMoneyWorkingSet');
const { computeScoreForSymbol } = require('../services/smartMoneyScoreEngine');

async function upsertScores(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 0;
  }

  await queryWithTimeout(
    `INSERT INTO smart_money_scores (
       symbol,
       score_date,
       total_score,
       score_tier,
       insider_component,
       insider_signal_count,
       insider_net_value,
       insider_buy_count,
       insider_sell_count,
       congressional_component,
       congressional_member_count,
       congressional_net_value,
       institutional_component,
       institutional_new_positions,
       institutional_increased_positions,
       institutional_closed_positions,
       activist_component,
       activist_filing_count,
       contributing_factors
     )
     SELECT
       payload.symbol,
       payload.score_date::date,
       payload.total_score,
       payload.score_tier,
       payload.insider_component,
       payload.insider_signal_count,
       payload.insider_net_value,
       payload.insider_buy_count,
       payload.insider_sell_count,
       payload.congressional_component,
       payload.congressional_member_count,
       payload.congressional_net_value,
       payload.institutional_component,
       payload.institutional_new_positions,
       payload.institutional_increased_positions,
       payload.institutional_closed_positions,
       payload.activist_component,
       payload.activist_filing_count,
       payload.contributing_factors::jsonb
     FROM json_to_recordset($1::json) AS payload(
       symbol text,
       score_date text,
       total_score numeric,
       score_tier text,
       insider_component numeric,
       insider_signal_count integer,
       insider_net_value numeric,
       insider_buy_count integer,
       insider_sell_count integer,
       congressional_component numeric,
       congressional_member_count integer,
       congressional_net_value numeric,
       institutional_component numeric,
       institutional_new_positions integer,
       institutional_increased_positions integer,
       institutional_closed_positions integer,
       activist_component numeric,
       activist_filing_count integer,
       contributing_factors jsonb
     )
     ON CONFLICT (symbol, score_date) DO UPDATE SET
       total_score = EXCLUDED.total_score,
       score_tier = EXCLUDED.score_tier,
       insider_component = EXCLUDED.insider_component,
       insider_signal_count = EXCLUDED.insider_signal_count,
       insider_net_value = EXCLUDED.insider_net_value,
       insider_buy_count = EXCLUDED.insider_buy_count,
       insider_sell_count = EXCLUDED.insider_sell_count,
       congressional_component = EXCLUDED.congressional_component,
       congressional_member_count = EXCLUDED.congressional_member_count,
       congressional_net_value = EXCLUDED.congressional_net_value,
       institutional_component = EXCLUDED.institutional_component,
       institutional_new_positions = EXCLUDED.institutional_new_positions,
       institutional_increased_positions = EXCLUDED.institutional_increased_positions,
       institutional_closed_positions = EXCLUDED.institutional_closed_positions,
       activist_component = EXCLUDED.activist_component,
       activist_filing_count = EXCLUDED.activist_filing_count,
       contributing_factors = EXCLUDED.contributing_factors,
       computed_at = NOW()`,
    [JSON.stringify(rows)],
    {
      label: 'smart_money_scores.upsert',
      timeoutMs: 30000,
      maxRetries: 0,
      poolType: 'write',
    }
  );

  return rows.length;
}

async function runComputeSmartMoneyScores(options = {}) {
  const scoreDate = typeof options.scoreDate === 'string'
    ? options.scoreDate.slice(0, 10)
    : new Date(options.scoreDate || new Date()).toISOString().slice(0, 10);
  const symbols = Array.isArray(options.symbols) && options.symbols.length
    ? options.symbols.map((symbol) => String(symbol || '').trim().toUpperCase()).filter(Boolean)
    : await resolveSmartMoneyWorkingSet({ maxSymbols: options.maxSymbols || 1000 });

  const rows = [];
  const tierCounts = { high: 0, medium: 0, low: 0 };

  for (const symbol of symbols) {
    const score = await computeScoreForSymbol(symbol, scoreDate);
    rows.push(score);
    tierCounts[score.score_tier] = (tierCounts[score.score_tier] || 0) + 1;
  }

  const inserted = await upsertScores(rows);
  logger.info('smart money score compute complete', {
    scoreDate,
    symbols: symbols.length,
    inserted,
    tierCounts,
  });

  return {
    jobName: 'computeSmartMoneyScores',
    inserted,
    scoreDate,
    tierCounts,
  };
}

module.exports = {
  runComputeSmartMoneyScores,
  upsertScores,
};