/**
 * Signal: top_congressional_trades_recent
 *
 * Detects symbols with recently disclosed congressional purchases.
 *
 * Score combines:
 *   - Political alpha: cluster (multi-member), both chambers, conviction
 *     amount, repeat buying, self-owned vs spouse
 *   - Fame multiplier: amplify when high-profile members are involved
 *
 * Filters:
 *   - Stock asset_type only (skip ETFs, bonds, REITs)
 *   - Purchases only (Sales deferred to v2)
 *   - Disclosed in last 30 days (not transaction date — disclosure is
 *     when public could act on the info)
 *
 * Status: backward-looking (signal detects an event that already happened)
 */

const {
  buildUniverseClause,
  createResultMap,
  queryWithTimeout,
  toNumber,
} = require('./_helpers');

const SIGNAL_NAME = 'top_congressional_trades_recent';
const CATEGORY = 'congressional';
const RUN_MODE = 'leaderboard';
const FORWARD_LOOKING = false;
const TOP_N = 100;
const RECENT_DAYS = 30;
const HIGH_AMOUNT_THRESHOLD = 100000;

// Hardcoded list of high-profile members (last names).
// Drives retail attention regardless of underlying trade alpha.
// Edit this list as the political landscape changes.
const HIGH_PROFILE_MEMBERS = [
  'Pelosi',
  'McConnell',
  'Schumer',
  'AOC',
  'Ocasio-Cortez',
  'Cruz',
  'Sanders',
  'Warren',
  'Hawley',
  'Khanna',
  'Tuberville',
];

async function detect(universe = [], options = {}) {
  const topN = Number(options.topN || TOP_N);
  const recentDays = Number(options.recentDays || RECENT_DAYS);
  const highAmountThreshold = Number(options.highAmountThreshold || HIGH_AMOUNT_THRESHOLD);
  const highProfileMembers = Array.isArray(options.highProfileMembers) ? options.highProfileMembers : HIGH_PROFILE_MEMBERS;
  const universeFilter = buildUniverseClause(universe, 5);

  const result = await queryWithTimeout(
    `
      WITH eligible_purchases AS (
        SELECT
          UPPER(ct.symbol) AS symbol,
          ct.last_name,
          ct.first_name,
          ct.chamber,
          ct.amount_min,
          ct.amount_max,
          ct.transaction_date,
          ct.disclosure_date,
          ct.owner,
          CASE
            WHEN ct.last_name = ANY($3::text[]) THEN 1
            ELSE 0
          END AS is_high_profile
        FROM congressional_trades ct
        WHERE ct.transaction_type ILIKE 'Purchase%'
          AND ct.asset_type ILIKE 'Stock%'
          AND ct.disclosure_date >= CURRENT_DATE - ($1 || ' days')::interval
          AND ct.symbol IS NOT NULL
          AND TRIM(ct.symbol) <> ''
      ),
      symbol_aggregates AS (
        SELECT
          symbol,
          COUNT(*)::int AS total_purchases,
          COUNT(DISTINCT (last_name || '|' || COALESCE(first_name, '')))::int AS distinct_members,
          COUNT(DISTINCT chamber)::int AS distinct_chambers,
          COUNT(*) FILTER (WHERE is_high_profile = 1)::int AS high_profile_purchases,
          COUNT(*) FILTER (WHERE owner = 'Self')::int AS self_owned,
          COUNT(*) FILTER (WHERE amount_min >= $2)::int AS high_amount_purchases,
          MAX(disclosure_date) AS most_recent_disclosure,
          MAX(amount_min) AS largest_amount,
          STRING_AGG(DISTINCT last_name, ', ' ORDER BY last_name) AS member_names,
          STRING_AGG(DISTINCT chamber, ', ' ORDER BY chamber) AS chambers
        FROM eligible_purchases
        GROUP BY symbol
      ),
      scored AS (
        SELECT
          symbol,
          total_purchases,
          distinct_members,
          distinct_chambers,
          high_profile_purchases,
          self_owned,
          high_amount_purchases,
          most_recent_disclosure,
          largest_amount,
          member_names,
          chambers,
          (
            1.0
            + LEAST((distinct_members - 1) * 0.5, 2.0)
            + CASE WHEN distinct_chambers = 2 THEN 1.0 ELSE 0.0 END
            + CASE WHEN high_amount_purchases > 0 THEN 0.5 ELSE 0.0 END
            + CASE WHEN total_purchases >= 3 THEN 0.5 ELSE 0.0 END
            + LEAST(self_owned * 0.3, 0.6)
          ) AS political_alpha_score,
          CASE
            WHEN high_profile_purchases > 0 THEN 1.3
            ELSE 1.0
          END AS fame_multiplier
        FROM symbol_aggregates
      )
      SELECT
        symbol,
        total_purchases,
        distinct_members,
        distinct_chambers,
        high_profile_purchases,
        self_owned,
        high_amount_purchases,
        most_recent_disclosure,
        largest_amount,
        member_names,
        chambers,
        (political_alpha_score * fame_multiplier)::numeric(10, 4) AS score
      FROM scored
      WHERE 1=1
        ${universeFilter.clause}
      ORDER BY score DESC, most_recent_disclosure DESC, symbol ASC
      LIMIT $4
    `,
    [recentDays, highAmountThreshold, highProfileMembers, topN, ...universeFilter.params],
    {
      label: 'beacon_v0.signal.top_congressional_trades_recent',
      timeoutMs: 20000,
      slowQueryMs: 1000,
      poolType: 'read',
      maxRetries: 1,
    },
  );

  return createResultMap(result.rows, (row, index) => {
    const totalPurchases = Number.parseInt(row.total_purchases, 10) || 0;
    const distinctMembers = Number.parseInt(row.distinct_members, 10) || 0;
    const highProfile = Number.parseInt(row.high_profile_purchases, 10) || 0;
    const highAmountPurchases = Number.parseInt(row.high_amount_purchases, 10) || 0;
    const largestAmount = toNumber(row.largest_amount);
    const isHighProfile = highProfile > 0;
    const isCluster = distinctMembers >= 2;
    const isBothChambers = Number.parseInt(row.distinct_chambers, 10) === 2;

    const fragments = [];
    if (distinctMembers === 1) {
      fragments.push(`${totalPurchases} purchase${totalPurchases > 1 ? 's' : ''} by ${row.member_names}`);
    } else {
      fragments.push(`${totalPurchases} purchases by ${distinctMembers} members (${row.member_names})`);
    }
    if (isBothChambers) fragments.push('both chambers');
    if (highAmountPurchases > 0 && largestAmount != null) fragments.push(`largest tier $${(largestAmount / 1000).toFixed(0)}k+`);
    if (isHighProfile) fragments.push('high-profile member');

    return {
      symbol: row.symbol,
      signal: SIGNAL_NAME,
      rank: index + 1,
      score: toNumber(row.score) || 0,
      metadata: {
        total_purchases: totalPurchases,
        distinct_members: distinctMembers,
        is_cluster: isCluster,
        is_both_chambers: isBothChambers,
        is_high_profile: isHighProfile,
        high_profile_purchases: highProfile,
        self_owned: Number.parseInt(row.self_owned, 10) || 0,
        high_amount_purchases: highAmountPurchases,
        most_recent_disclosure: row.most_recent_disclosure,
        largest_amount: largestAmount,
        member_names: row.member_names,
        chambers: row.chambers,
      },
      reasoning: `Congressional disclosure: ${fragments.join(', ')}`,
    };
  });
}

function summarize(metadata = {}) {
  const members = Number(metadata.distinct_members) || 0;
  const purchases = Number(metadata.total_purchases) || 0;
  const largestAmount = toNumber(metadata.largest_amount);
  const fragments = [];

  if (members === 1) {
    fragments.push(`${purchases} congressional purchase${purchases > 1 ? 's' : ''}`);
  } else {
    fragments.push(`${purchases} purchases by ${members} congressional members`);
  }

  if (metadata.is_both_chambers) fragments.push('both chambers');
  if (metadata.is_high_profile) fragments.push('high-profile member');
  if (Number(metadata.high_amount_purchases) > 0 && largestAmount != null) fragments.push(`$${Math.round(largestAmount / 1000)}k+ position`);

  return fragments.join(', ');
}

module.exports = {
  CATEGORY,
  FORWARD_LOOKING,
  HIGH_AMOUNT_THRESHOLD,
  HIGH_PROFILE_MEMBERS,
  RECENT_DAYS,
  RUN_MODE,
  SIGNAL_NAME,
  TOP_N,
  detect,
  summarize,
};