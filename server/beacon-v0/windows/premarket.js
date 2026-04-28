'use strict';

/**
 * Pre-market window — fires at 12:00 UTC (13:00 UK).
 *
 * Strategy: catch overnight earnings reactions, gap-up movers, and
 * fresh news that wasn't visible at 22:00 UTC yesterday. Scans a
 * narrower universe than nightly but with lower alignment threshold
 * because window-specific signals are higher conviction individually.
 */

const PREMARKET_WINDOW = {
  name: 'premarket',
  display_name: 'Pre-market',
  display_uk_time: '13:00 UK',
  cron_utc: '0 12 * * 1-5', // weekdays only

  signals: [
    'top_gap_today',
    'top_news_last_12h',
    'earnings_reaction_last_3d',
    'top_volume_building',
  ],

  content_profile: {
    purpose: 'reaction',
    signals: [
      'top_gap_today',
      'top_news_last_12h',
      'earnings_reaction_last_3d',
      'top_volume_building',
    ],
    signal_weights: {
      top_gap_today: 1.5,
      top_news_last_12h: 1.0,
      earnings_reaction_last_3d: 1.5,
      top_volume_building: 1.0,
    },
    lookback_hours: 14,
    forward_hours: null,
  },

  // Lower alignment threshold — premarket signals are individually meaningful
  min_alignment_count: 2,

  // Universe strategy
  universe: {
    // Always include last night's nightly picks
    include_nightly_picks: true,

    // Plus expand with premarket-specific universe scan
    expansion_query: 'premarket_movers', // defined in orchestrator
    expansion_max_symbols: 200,
  },

  // Tier ranking weights specific to premarket
  ranking_weights: {
    alignment_count: 8, // weight per aligned signal
    forward_setup_bonus: 0, // less relevant for premarket
    rank_inverse: 1.5,
    rvol_factor: 3,
    earnings_today_bonus: 30, // huge bonus — premarket earnings reactions are highest conviction
    gap_pct_factor: 5, // premarket-only — weight by gap percentage
  },

  // Top-N picks to surface in this window
  top_n: 12,

  // Outcome capture timing (offsets from window fire time)
  outcome_checkpoints: {
    t1_offset_minutes: 105, // ~30min after market open (13:30 UTC + 30 = 14:00 UTC)
    t2_offset_minutes: 210, // 1 hour after market open
    t3_offset_minutes: 480, // market close (~20:00 UTC)
    t4_offset_minutes: 1440, // next day open
  },
};

module.exports = PREMARKET_WINDOW;
