const express = require('express');
const { queryWithTimeout } = require('../../db/pg');

const router = express.Router();

// Mirrors the C2 signal list, but kept local so the route is independent.
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

function clampInt(value, defaultValue, min, max) {
  const parsed = parseInt(value, 10);
  const numeric = Number.isFinite(parsed) ? parsed : defaultValue;
  return Math.min(Math.max(numeric, min), max);
}

function isPurchase(row) {
  return /^Purchase/i.test(String(row.transaction_type || ''));
}

function isSale(row) {
  return /^Sale/i.test(String(row.transaction_type || ''));
}

function memberKey(row) {
  return `${row.last_name || ''}|${row.first_name || ''}`;
}

router.get('/recent', async (req, res) => {
  try {
    const chamber = String(req.query.chamber || 'all').trim().toLowerCase();
    const txType = String(req.query.transaction_type || 'all').trim().toLowerCase();
    const symbol = req.query.symbol ? String(req.query.symbol).trim().toUpperCase() : null;
    const member = req.query.member ? String(req.query.member).trim().toLowerCase() : null;
    const highProfile = req.query.high_profile === 'true';
    const days = clampInt(req.query.days, 30, 1, 365);
    const limit = clampInt(req.query.limit, 50, 1, 200);
    const offset = clampInt(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);

    const conditions = ['disclosure_date >= CURRENT_DATE - ($1 || \' days\')::interval'];
    const params = [days];

    if (chamber === 'senate' || chamber === 'house') {
      params.push(chamber);
      conditions.push(`chamber = $${params.length}`);
    }

    if (txType === 'purchase') {
      conditions.push("transaction_type ILIKE 'Purchase%'");
    } else if (txType === 'sale') {
      conditions.push("transaction_type ILIKE 'Sale%'");
    }

    if (symbol) {
      params.push(symbol);
      conditions.push(`symbol = $${params.length}`);
    }

    if (member) {
      params.push(`%${member}%`);
      conditions.push(`LOWER(last_name) LIKE $${params.length}`);
    }

    if (highProfile) {
      params.push(HIGH_PROFILE_MEMBERS);
      conditions.push(`last_name = ANY($${params.length}::text[])`);
    }

    const whereClause = conditions.join(' AND ');
    const countParams = [...params];
    const highProfileParamIndex = params.length + 1;
    const limitParamIndex = params.length + 2;
    const offsetParamIndex = params.length + 3;
    params.push(HIGH_PROFILE_MEMBERS, limit, offset);

    const result = await queryWithTimeout(
      `
        SELECT
          id, chamber, symbol, transaction_date, disclosure_date,
          first_name, last_name, district, owner,
          asset_description, asset_type, transaction_type,
          amount_range, amount_min, amount_max,
          source_link,
          CASE WHEN last_name = ANY($${highProfileParamIndex}::text[]) THEN true ELSE false END AS is_high_profile
        FROM congressional_trades
        WHERE ${whereClause}
        ORDER BY disclosure_date DESC, transaction_date DESC, id DESC
        LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
      `,
      params,
      {
        label: 'congressional.recent',
        timeoutMs: 8000,
        slowQueryMs: 1000,
        poolType: 'read',
        maxRetries: 1,
      },
    );

    const countResult = await queryWithTimeout(
      `
        SELECT COUNT(*)::int AS total
        FROM congressional_trades
        WHERE ${whereClause}
      `,
      countParams,
      {
        label: 'congressional.recent.count',
        timeoutMs: 8000,
        slowQueryMs: 1000,
        poolType: 'read',
        maxRetries: 1,
      },
    );

    return res.json({
      total: countResult.rows[0]?.total || 0,
      limit,
      offset,
      results: result.rows,
    });
  } catch (error) {
    console.error('[congressional/recent] error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

router.get('/by-symbol/:symbol', async (req, res) => {
  try {
    const symbol = String(req.params.symbol || '').trim().toUpperCase();

    const result = await queryWithTimeout(
      `
        SELECT
          id, chamber, transaction_date, disclosure_date,
          first_name, last_name, district, owner,
          asset_description, asset_type, transaction_type,
          amount_range, amount_min, amount_max,
          source_link,
          CASE WHEN last_name = ANY($2::text[]) THEN true ELSE false END AS is_high_profile
        FROM congressional_trades
        WHERE symbol = $1
        ORDER BY disclosure_date DESC, transaction_date DESC, id DESC
      `,
      [symbol, HIGH_PROFILE_MEMBERS],
      {
        label: 'congressional.by_symbol',
        timeoutMs: 8000,
        slowQueryMs: 1000,
        poolType: 'read',
        maxRetries: 1,
      },
    );

    const stats = {
      total_trades: result.rows.length,
      purchases: result.rows.filter(isPurchase).length,
      sales: result.rows.filter(isSale).length,
      distinct_members: new Set(result.rows.map(memberKey)).size,
      chambers: Array.from(new Set(result.rows.map((row) => row.chamber))).filter(Boolean).sort(),
      high_profile_count: result.rows.filter((row) => row.is_high_profile).length,
    };

    return res.json({
      symbol,
      stats,
      trades: result.rows,
    });
  } catch (error) {
    console.error('[congressional/by-symbol] error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

router.get('/by-member', async (req, res) => {
  try {
    const name = String(req.query.name || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'name parameter required' });
    }

    const limit = clampInt(req.query.limit, 100, 1, 500);

    const result = await queryWithTimeout(
      `
        SELECT
          id, chamber, symbol, transaction_date, disclosure_date,
          first_name, last_name, district, owner,
          asset_description, asset_type, transaction_type,
          amount_range, amount_min, amount_max,
          source_link
        FROM congressional_trades
        WHERE LOWER(last_name) LIKE $1
        ORDER BY disclosure_date DESC, transaction_date DESC, id DESC
        LIMIT $2
      `,
      [`%${name.toLowerCase()}%`, limit],
      {
        label: 'congressional.by_member',
        timeoutMs: 8000,
        slowQueryMs: 1000,
        poolType: 'read',
        maxRetries: 1,
      },
    );

    const stats = {
      total_trades: result.rows.length,
      purchases: result.rows.filter(isPurchase).length,
      sales: result.rows.filter(isSale).length,
      distinct_symbols: new Set(result.rows.map((row) => row.symbol)).size,
    };

    return res.json({
      query: name,
      stats,
      trades: result.rows,
    });
  } catch (error) {
    console.error('[congressional/by-member] error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

router.get('/leaderboard', async (req, res) => {
  try {
    const days = clampInt(req.query.days, 30, 1, 365);
    const limit = clampInt(req.query.limit, 50, 1, 200);

    const result = await queryWithTimeout(
      `
        SELECT
          symbol,
          COUNT(*)::int AS total_purchases,
          COUNT(DISTINCT last_name || '|' || COALESCE(first_name, ''))::int AS distinct_members,
          COUNT(DISTINCT chamber)::int AS distinct_chambers,
          COUNT(*) FILTER (WHERE last_name = ANY($1::text[]))::int AS high_profile_purchases,
          COUNT(*) FILTER (WHERE amount_min >= 100000)::int AS high_amount_purchases,
          MAX(disclosure_date) AS most_recent_disclosure,
          MAX(amount_min) AS largest_amount,
          STRING_AGG(DISTINCT last_name, ', ' ORDER BY last_name) AS member_names,
          STRING_AGG(DISTINCT chamber, ', ' ORDER BY chamber) AS chambers
        FROM congressional_trades
        WHERE transaction_type ILIKE 'Purchase%'
          AND asset_type ILIKE 'Stock%'
          AND disclosure_date >= CURRENT_DATE - ($2 || ' days')::interval
        GROUP BY symbol
        ORDER BY
          distinct_members DESC,
          high_profile_purchases DESC,
          total_purchases DESC,
          most_recent_disclosure DESC,
          symbol ASC
        LIMIT $3
      `,
      [HIGH_PROFILE_MEMBERS, days, limit],
      {
        label: 'congressional.leaderboard',
        timeoutMs: 8000,
        slowQueryMs: 1000,
        poolType: 'read',
        maxRetries: 1,
      },
    );

    return res.json({
      window_days: days,
      results: result.rows,
    });
  } catch (error) {
    console.error('[congressional/leaderboard] error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;