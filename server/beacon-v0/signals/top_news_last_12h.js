const {
  buildUniverseClause,
  createResultMap,
  queryWithTimeout,
  toNumber,
} = require('./_helpers');

const SIGNAL_NAME = 'top_news_last_12h';
const CATEGORY = 'news';
const RUN_MODE = 'leaderboard';
const TOP_N = 100;
const NEWS_WINDOW_HOURS = 12;

async function detect(universe = [], options = {}) {
  const topN = Number(options.topN || TOP_N);
  const windowHours = Number(options.newsWindowHours || NEWS_WINDOW_HOURS);
  const universeFilter = buildUniverseClause(universe, 3);

  const result = await queryWithTimeout(
    `
      WITH symbolized_news AS (
        SELECT
          UPPER(symbol) AS symbol,
          COALESCE(published_at, published_date::timestamp, created_at) AS published_at,
          COALESCE(headline, title, summary, narrative, 'Untitled news') AS headline,
          COALESCE(priority_score, news_score::numeric, 0) AS article_score
        FROM news_articles
        WHERE symbol IS NOT NULL
          AND COALESCE(published_at, published_date::timestamp, created_at) >= NOW() - ($1::int * INTERVAL '1 hour')
          ${universeFilter.clause}

        UNION ALL

        SELECT
          UPPER(expanded.symbol) AS symbol,
          COALESCE(n.published_at, n.published_date::timestamp, n.created_at) AS published_at,
          COALESCE(n.headline, n.title, n.summary, n.narrative, 'Untitled news') AS headline,
          COALESCE(n.priority_score, n.news_score::numeric, 0) AS article_score
        FROM news_articles n
        CROSS JOIN LATERAL unnest(COALESCE(n.detected_symbols, n.symbols, ARRAY[]::text[])) AS expanded(symbol)
        WHERE expanded.symbol IS NOT NULL
          AND COALESCE(n.published_at, n.published_date::timestamp, n.created_at) >= NOW() - ($1::int * INTERVAL '1 hour')
          ${universeFilter.clause.replace(/UPPER\(symbol\)/g, 'UPPER(expanded.symbol)')}
      ),
      ranked_news AS (
        SELECT
          symbol,
          COUNT(*)::int AS news_count,
          MAX(published_at) AS latest_news_at,
          MAX(article_score) AS max_article_score,
          ARRAY_AGG(headline ORDER BY published_at DESC) FILTER (WHERE headline IS NOT NULL) AS headlines
        FROM symbolized_news
        WHERE symbol IS NOT NULL AND symbol <> ''
        GROUP BY symbol
      )
      SELECT
        symbol,
        news_count,
        latest_news_at,
        max_article_score,
        headlines[1:3] AS top_headlines,
        (news_count * 10 + COALESCE(max_article_score, 0))::numeric(10,2) AS news_score
      FROM ranked_news
      WHERE news_count > 0
      ORDER BY news_score DESC, latest_news_at DESC
      LIMIT $2
    `,
    [windowHours, topN, ...universeFilter.params],
    {
      label: 'beacon_v0.signal.top_news_last_12h',
      timeoutMs: 15000,
      slowQueryMs: 1000,
      poolType: 'read',
      maxRetries: 1,
    },
  );

  return createResultMap(result.rows, (row, index) => {
    const newsCount = toNumber(row.news_count) || 0;
    const score = toNumber(row.news_score) || newsCount;
    return {
      symbol: row.symbol,
      signal: SIGNAL_NAME,
      rank: index + 1,
      score,
      metadata: {
        news_count: newsCount,
        latest_news_at: row.latest_news_at,
        max_article_score: toNumber(row.max_article_score),
        top_headlines: row.top_headlines || [],
        window_hours: windowHours,
      },
      reasoning: `${newsCount} news item${newsCount === 1 ? '' : 's'} in the last ${windowHours} hours`,
    };
  });
}

module.exports = { CATEGORY, NEWS_WINDOW_HOURS, RUN_MODE, SIGNAL_NAME, TOP_N, detect };