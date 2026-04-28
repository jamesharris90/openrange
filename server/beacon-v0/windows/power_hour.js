'use strict';

/**
 * Power hour window — fires at 18:00 UTC (19:00 UK), 1 hour before US close.
 *
 * Strategy: catch late-day momentum, breaking news after 17:00 UTC,
 * volume building into close. Historically the highest-volume hour
 * of the trading day.
 */

const POWER_HOUR_WINDOW = {
  name: 'power_hour',
  display_name: 'Power Hour',
  display_uk_time: '19:00 UK',
  cron_utc: '0 18 * * 1-5',

  signals: [
    'top_rvol_today',
    'top_news_last_12h',
    'top_volume_building',
    'top_congressional_trades_recent',
  ],

  content_profile: {
    purpose: 'acceleration',
    signals: [
      'top_rvol_today',
      'top_news_last_12h',
      'top_volume_building',
      'top_congressional_trades_recent',
    ],
    signal_weights: {
      top_rvol_today: 1.5,
      top_news_last_12h: 1.5,
      top_volume_building: 1.0,
      top_congressional_trades_recent: 0.5,
    },
    lookback_hours: 4,
    forward_hours: null,
  },

  min_alignment_count: 2,

  universe: {
    include_nightly_picks: true,
    include_premarket_window_picks: true,
    include_open_window_picks: true,
    expansion_query: 'late_day_movers',
    expansion_max_symbols: 100,
  },

  ranking_weights: {
    alignment_count: 8,
    forward_setup_bonus: 0,
    rank_inverse: 1.5,
    rvol_factor: 6,
    late_news_bonus: 15, // news after 17:00 UTC gets bonus
    volume_acceleration: 5,
  },

  top_n: 8,

  outcome_checkpoints: {
    t1_offset_minutes: 60,
    t2_offset_minutes: 120, // market close
    t3_offset_minutes: 300, // post-market reaction
    t4_offset_minutes: 1080, // next day open
  },
};

module.exports = POWER_HOUR_WINDOW;
