const MARKET_QUOTES_TABLE = 'market_quotes';
const INTRADAY_TABLE = 'intraday_1m';
const OPPORTUNITIES_TABLE = 'trade_setups';
const SIGNALS_TABLE = 'strategy_signals';

// These tables can exist for history/backfill/analytics but are not authoritative
// sources for live API contracts.
const NON_AUTHORITATIVE_TABLES = [
  'opportunities',
  'opportunity_stream',
  'trade_opportunities',
];

module.exports = {
  MARKET_QUOTES_TABLE,
  INTRADAY_TABLE,
  OPPORTUNITIES_TABLE,
  SIGNALS_TABLE,
  NON_AUTHORITATIVE_TABLES,
};
