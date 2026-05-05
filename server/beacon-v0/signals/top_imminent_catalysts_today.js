const {
  buildUniverseClause,
  createResultMap,
  queryWithTimeout,
  toNumber,
} = require('./_helpers');
const logger = require('../../logger');

const SIGNAL_NAME = 'top_imminent_catalysts_today';
const CATEGORY = 'catalyst';
const RUN_MODE = 'leaderboard';
const FORWARD_LOOKING = true;
const TOP_N = 100;

function synthesizeHeadline(row) {
  const title = String(row.title || '').trim();
  const description = String(row.description || '').trim();
  const days = Number(row.days_until_event || 0);
  const when = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
  return `${title} ${when}${description ? `; ${description}` : ''}`.trim();
}

async function detect(universe = [], options = {}) {
  const topN = Number(options.topN || TOP_N);
  const universeFilter = buildUniverseClause(universe, 2);
  logger.debug('[imminent_catalysts] symbol filter size: %d', Array.isArray(universeFilter.params[0]) ? universeFilter.params[0].length : 0);
  const result = await queryWithTimeout(
    `
      SELECT
        symbol,
        event_type,
        event_date,
        title,
        description,
        source,
        importance,
        confidence,
        GREATEST(0, event_date - CURRENT_DATE) AS days_until_event,
        ((10 - GREATEST(0, event_date - CURRENT_DATE)) * importance::numeric / 10.0) AS score,
        metadata
      FROM event_calendar
      WHERE event_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
        AND symbol IS NOT NULL
        ${universeFilter.clause}
      ORDER BY score DESC, event_date ASC, symbol ASC
      LIMIT $1
    `,
    [topN, ...universeFilter.params],
    {
      label: 'beacon_v0.signal.top_imminent_catalysts_today',
      timeoutMs: 15000,
      slowQueryMs: 1000,
      poolType: 'read',
      maxRetries: 1,
    }
  );

  return createResultMap(result.rows, (row, index) => {
    const score = toNumber(row.score) || 0;
    const headline = synthesizeHeadline(row);
    return {
      symbol: row.symbol,
      signal: SIGNAL_NAME,
      rank: index + 1,
      score,
      headline,
      cluster: 'IMMINENT_CATALYST',
      metadata: {
        event_type: row.event_type,
        event_date: row.event_date,
        source: row.source,
        importance: Number(row.importance || 0),
        confidence: row.confidence,
        days_until_event: Number(row.days_until_event || 0),
        cluster: 'IMMINENT_CATALYST',
        headline,
        ...((row.metadata && typeof row.metadata === 'object') ? row.metadata : {}),
      },
      reasoning: headline,
    };
  });
}

function summarize(metadata = {}) {
  return metadata.headline || 'Imminent calendar catalyst';
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