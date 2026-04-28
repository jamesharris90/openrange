'use strict';

/**
 * Open window — fires at 13:45 UTC (14:45 UK), 15 minutes after US market open.
 *
 * Strategy: catch the gap-and-go performers, opening range breakouts,
 * first-15-min RVOL leaders. James trades 14:30-16:00 UK so this is
 * his most actionable window.
 */

const OPEN_WINDOW = {
  name: 'open',
  display_name: 'Market Open',
  display_uk_time: '14:45 UK',
  cron_utc: '45 13 * * 1-5',

  signals: [
    'top_rvol_today', // first-15-min RVOL is the key signal
    'top_gap_today',
    'top_volume_building',
    'top_news_last_12h',
  ],

  min_alignment_count: 2,

  universe: {
    include_nightly_picks: true,
    include_premarket_window_picks: true, // also include premarket additions
    expansion_query: 'opening_range_breakouts',
    expansion_max_symbols: 150,
  },

  ranking_weights: {
    alignment_count: 10,
    forward_setup_bonus: 0,
    rank_inverse: 2,
    rvol_factor: 8, // RVOL is dominant signal at open
    earnings_today_bonus: 15,
    gap_pct_factor: 4,
    orb_break_bonus: 12, // opening range break flag, set by signal
  },

  top_n: 10,

  outcome_checkpoints: {
    t1_offset_minutes: 60, // 1h after pick = ~14:45 UTC = 15:45 UK
    t2_offset_minutes: 195, // ~17:00 UTC = 18:00 UK
    t3_offset_minutes: 375, // ~20:00 UTC = 21:00 UK (market close)
    t4_offset_minutes: 1335, // next day open
  },
};

module.exports = OPEN_WINDOW;
