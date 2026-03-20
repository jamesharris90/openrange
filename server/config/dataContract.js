const {
  MARKET_QUOTES_TABLE,
  OPPORTUNITIES_TABLE,
  SIGNALS_TABLE,
} = require('../../lib/data/authority');

const DATA_CONTRACT = {
  news: {
    table: 'news_articles',
    columns: [
      'id',
      'headline',
      'symbols',
      'source',
      'url',
      'published_at',
      'summary',
      'news_score',
      'symbol',
      'catalyst_type',
      'sector',
      'narrative',
      'created_at',
    ],
  },

  alerts: {
    table: 'signal_alerts',
    columns: [
      'id',
      'symbol',
      'score',
      'confidence',
      'alert_type',
      'message',
      'acknowledged',
      'strategy',
      'created_at',
    ],
  },

  signals: {
    table: SIGNALS_TABLE,
    columns: [
      'id',
      'symbol',
      'strategy',
      'class',
      'score',
      'probability',
      'change_percent',
      'gap_percent',
      'relative_volume',
      'volume',
      'entry_price',
      'exit_price',
      'result',
      'catalyst_count',
      'created_at',
      'updated_at',
      'timestamp',
    ],
  },

  opportunities: {
    table: OPPORTUNITIES_TABLE,
    columns: [
      'symbol',
      'setup_type',
      'score',
      'detected_at',
      'updated_at',
    ],
  },

  opportunityStream: {
    table: 'opportunity_stream',
    columns: [
      'id',
      'symbol',
      'event_type',
      'headline',
      'score',
      'source',
      'created_at',
    ],
    nonAuthoritative: true,
  },

  marketQuotes: {
    table: MARKET_QUOTES_TABLE,
    columns: [
      'symbol',
      'price',
      'change_percent',
      'volume',
      'market_cap',
      'sector',
      'updated_at',
      'short_float',
      'float',
      'relative_volume',
      'premarket_volume',
    ],
  },

  marketMetrics: {
    table: 'market_metrics',
    columns: [
      'symbol',
      'price',
      'gap_percent',
      'relative_volume',
      'atr',
      'rsi',
      'vwap',
      'float_rotation',
      'last_updated',
      'change_percent',
      'avg_volume_30d',
      'updated_at',
      'volume',
      'previous_high',
      'float_shares',
      'atr_percent',
      'short_float',
      'liquidity_surge',
    ],
  },
};

const CANONICAL_TABLES = Object.values(DATA_CONTRACT).map((entry) => entry.table);

module.exports = {
  DATA_CONTRACT,
  CANONICAL_TABLES,
};
