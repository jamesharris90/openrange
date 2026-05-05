const {
  buildUniverseClause,
  createResultMap,
  queryWithTimeout,
  toNumber,
} = require('./_helpers');

const SIGNAL_NAME = 'top_smart_money_today';
const CATEGORY = 'smart_money';
const RUN_MODE = 'leaderboard';
const FORWARD_LOOKING = false;
const TOP_N = 100;

function synthesizeHeadline(row) {
  const fragments = [];
  const insiderBuys = Number(row.insider_buy_count || 0);
  const insiderNet = toNumber(row.insider_net_value) || 0;
  const congressionalMembers = Number(row.congressional_member_count || 0);
  const institutionalNew = Number(row.institutional_new_positions || 0);
  const activistCount = Number(row.activist_filing_count || 0);

  if (insiderBuys > 0) {
    fragments.push(`${insiderBuys} insider${insiderBuys === 1 ? '' : 's'} bought $${(Math.max(insiderNet, 0) / 1000000).toFixed(1)}M`);
  }
  if (congressionalMembers > 0) {
    fragments.push(`${congressionalMembers} congressional member${congressionalMembers === 1 ? '' : 's'}`);
  }
  if (institutionalNew > 0) {
    fragments.push(`${institutionalNew} new 13F position${institutionalNew === 1 ? '' : 's'}`);
  }
  if (activistCount > 0) {
    fragments.push(`${activistCount} activist filing${activistCount === 1 ? '' : 's'}`);
  }

  return fragments.length > 0 ? fragments.join('; ') : 'Elevated smart money alignment';
}

async function detect(universe = [], options = {}) {
  const topN = Number(options.topN || TOP_N);
  const universeFilter = buildUniverseClause(universe, 2);

  const result = await queryWithTimeout(
    `
      WITH latest_scores AS (
        SELECT MAX(score_date) AS score_date
        FROM smart_money_scores
      )
      SELECT
        symbol,
        score_date,
        total_score,
        score_tier,
        insider_component,
        insider_net_value,
        insider_buy_count,
        congressional_component,
        congressional_member_count,
        institutional_component,
        institutional_new_positions,
        activist_component,
        activist_filing_count,
        contributing_factors
      FROM smart_money_scores
      WHERE score_date = (SELECT score_date FROM latest_scores)
        ${universeFilter.clause}
      ORDER BY total_score DESC, symbol ASC
      LIMIT $1
    `,
    [topN, ...universeFilter.params],
    {
      label: 'beacon_v0.signal.top_smart_money_today',
      timeoutMs: 15000,
      slowQueryMs: 1000,
      poolType: 'read',
      maxRetries: 1,
    }
  );

  return createResultMap(result.rows, (row, index) => {
    const headline = synthesizeHeadline(row);
    return {
      symbol: row.symbol,
      signal: SIGNAL_NAME,
      rank: index + 1,
      score: toNumber(row.total_score) || 0,
      headline,
      cluster: 'SMART_MONEY',
      metadata: {
        score_date: row.score_date,
        score_tier: row.score_tier,
        cluster: 'SMART_MONEY',
        total_score: toNumber(row.total_score) || 0,
        headline,
        insider_component: toNumber(row.insider_component) || 0,
        insider_net_value: toNumber(row.insider_net_value) || 0,
        insider_buy_count: Number(row.insider_buy_count || 0),
        congressional_component: toNumber(row.congressional_component) || 0,
        congressional_member_count: Number(row.congressional_member_count || 0),
        institutional_component: toNumber(row.institutional_component) || 0,
        institutional_new_positions: Number(row.institutional_new_positions || 0),
        activist_component: toNumber(row.activist_component) || 0,
        activist_filing_count: Number(row.activist_filing_count || 0),
        contributing_factors: row.contributing_factors || {},
      },
      reasoning: headline,
    };
  });
}

function summarize(metadata = {}) {
  return metadata.headline || 'Smart Money alignment';
}

module.exports = {
  CATEGORY,
  FORWARD_LOOKING,
  RUN_MODE,
  SIGNAL_NAME,
  TOP_N,
  detect,
  summarize,
  synthesizeHeadline,
};