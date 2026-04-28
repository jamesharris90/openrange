'use strict';

/**
 * Post-market earnings window — fires at 20:30 UTC (21:30 UK),
 * 30 minutes after US market close.
 *
 * Strategy: capture actual earnings beat/miss reactions on the
 * symbols reporting after the close. Smaller universe — only
 * companies that reported today.
 */

const POST_MARKET_WINDOW = {
  name: 'post_market',
  display_name: 'Post-Market Earnings',
  display_uk_time: '21:30 UK',
  cron_utc: '30 20 * * 1-5',

  signals: [
    'earnings_reaction_last_3d', // actual EPS surprise + price reaction
    'top_news_last_12h', // earnings call commentary
  ],

  min_alignment_count: 1, // earnings reaction alone is sufficient

  universe: {
    include_nightly_picks: false, // earnings-only universe
    expansion_query: 'todays_after_hours_earnings_reporters',
    expansion_max_symbols: 50,
  },

  ranking_weights: {
    alignment_count: 5,
    eps_surprise_pct_factor: 15, // bigger surprise = higher rank
    after_hours_volume_factor: 5,
    after_hours_pct_change_factor: 8,
  },

  top_n: 6,

  outcome_checkpoints: {
    t1_offset_minutes: 720, // next day open (16h after pick)
    t2_offset_minutes: 1080, // 4h after next day open
    t3_offset_minutes: 1380, // next day close
    t4_offset_minutes: 2820, // 2-day open (full earnings reaction window)
  },
};

module.exports = POST_MARKET_WINDOW;
