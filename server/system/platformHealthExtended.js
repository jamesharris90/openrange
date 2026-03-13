import { DATA_CONTRACT } from "../contracts/dataContract.js";
import { safeFrom } from "../utils/safeSupabase.js";

export async function platformHealthExtended(supabase) {
  const report = {};
  const cutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { count: opportunitiesCount } = await safeFrom(supabase, DATA_CONTRACT.OPPORTUNITY_STREAM)
    .select("id", { count: "exact", head: true })
    .gte("created_at", cutoffIso);

  const { count: flowSignalsCount } = await safeFrom(supabase, DATA_CONTRACT.FLOW_SIGNALS)
    .select("id", { count: "exact", head: true })
    .gte("detected_at", cutoffIso);

  const { count: marketNewsCount } = await safeFrom(supabase, DATA_CONTRACT.MARKET_NEWS)
    .select("id", { count: "exact", head: true })
    .gte("published_at", cutoffIso);

  const { count: marketMetricsCount } = await safeFrom(supabase, DATA_CONTRACT.MARKET_METRICS)
    .select("symbol", { count: "exact", head: true });

  const { count: intradayCount } = await safeFrom(supabase, DATA_CONTRACT.INTRADAY_DATA)
    .select("symbol", { count: "exact", head: true })
    .gte("timestamp", cutoffIso);

  let intelligenceRows24h = 0;
  try {
    const { count } = await supabase
      .from("opportunity_intelligence")
      .select("id", { count: "exact", head: true })
      .gte("created_at", cutoffIso);
    intelligenceRows24h = count || 0;
  } catch (_error) {
    intelligenceRows24h = 0;
  }

  let radarGeneratedAt = null;
  try {
    const { data } = await supabase
      .from("radar_market_summary")
      .select("generated_at")
      .limit(1);
    radarGeneratedAt = data?.[0]?.generated_at ?? null;
  } catch (_error) {
    radarGeneratedAt = null;
  }

  let watchdogStatus = 'UNKNOWN';
  let secondsSinceLastOpportunity = null;
  let intelligenceSignalCount = intelligenceRows24h;
  try {
    const { data } = await supabase
      .from("platform_watchdog_status")
      .select("stream_status, seconds_since_last_opportunity, intelligence_signals")
      .limit(1);

    const watchdog = data?.[0] ?? null;
    if (watchdog?.stream_status) watchdogStatus = watchdog.stream_status;
    if (watchdog?.seconds_since_last_opportunity != null) {
      const parsed = Number(watchdog.seconds_since_last_opportunity);
      secondsSinceLastOpportunity = Number.isFinite(parsed) ? parsed : null;
    }
    if (watchdog?.intelligence_signals != null) {
      const parsed = Number(watchdog.intelligence_signals);
      intelligenceSignalCount = Number.isFinite(parsed) ? parsed : intelligenceSignalCount;
    }
  } catch (_error) {
    watchdogStatus = 'UNKNOWN';
  }

  if (secondsSinceLastOpportunity == null) {
    try {
      const { data } = await safeFrom(supabase, DATA_CONTRACT.OPPORTUNITY_STREAM)
        .select("created_at")
        .order("created_at", { ascending: false })
        .limit(1);
      const createdAt = data?.[0]?.created_at ? new Date(data[0].created_at).getTime() : null;
      if (createdAt) {
        secondsSinceLastOpportunity = Math.max(0, (Date.now() - createdAt) / 1000);
      }
    } catch (_error) {
      secondsSinceLastOpportunity = null;
    }
  }

  let signalRegistryCount = 0;
  let signalOutcomesCount = 0;
  let strategyCount = 0;
  try {
    const { count } = await supabase
      .from("signal_registry")
      .select("id", { count: "exact", head: true });
    signalRegistryCount = count || 0;
  } catch (_error) {
    signalRegistryCount = 0;
  }

  try {
    const { count } = await supabase
      .from("signal_outcomes")
      .select("id", { count: "exact", head: true });
    signalOutcomesCount = count || 0;
  } catch (_error) {
    signalOutcomesCount = 0;
  }

  try {
    const { data } = await supabase
      .from("signal_calibration_log")
      .select("strategy")
      .limit(1000);
    const strategies = new Set((Array.isArray(data) ? data : []).map((r) => r?.strategy).filter(Boolean));
    strategyCount = strategies.size;
  } catch (_error) {
    strategyCount = 0;
  }

  let calibrationSignalCount = 0;
  let calibrationWinRate = 0;
  let calibrationLastUpdate = null;
  try {
    const { count } = await supabase
      .from("signal_calibration_log")
      .select("id", { count: "exact", head: true });
    calibrationSignalCount = count || 0;
  } catch (_error) {
    calibrationSignalCount = 0;
  }

  try {
    const { data } = await supabase
      .from("signal_calibration_log")
      .select("success, created_at")
      .order("created_at", { ascending: false })
      .limit(500);

    const rows = Array.isArray(data) ? data : [];
    const decidedRows = rows.filter((row) => row?.success === true || row?.success === false);
    if (decidedRows.length > 0) {
      const wins = decidedRows.filter((row) => row.success === true).length;
      calibrationWinRate = (wins / decidedRows.length) * 100;
    }
    calibrationLastUpdate = rows[0]?.created_at ?? null;
  } catch (_error) {
    calibrationWinRate = 0;
    calibrationLastUpdate = null;
  }

  report.opportunities_24h = opportunitiesCount || 0;

  // Replay engine: count replay-sourced signals and get last replay run time
  let replaySignalCount = 0;
  let replayLastRunAt = null;
  try {
    const { count, data: replayRows } = await supabase
      .from("signal_registry")
      .select("source, entry_time", { count: "exact" })
      .eq("source", "replay")
      .order("entry_time", { ascending: false })
      .limit(1);
    replaySignalCount = count || 0;
    replayLastRunAt = replayRows?.[0]?.entry_time ?? null;
  } catch (_error) {
    replaySignalCount = 0;
    replayLastRunAt = null;
  }

  const replaySecondsSinceLastRun = replayLastRunAt
    ? Math.max(0, (Date.now() - new Date(replayLastRunAt).getTime()) / 1000)
    : null;

  const replayEngineStatus =
    replaySignalCount === 0
      ? 'NEVER_RUN'
      : replaySecondsSinceLastRun !== null && replaySecondsSinceLastRun < 90000 // 25h
      ? 'OK'
      : 'STALE';

  let strategyWeightCount = 0;
  let strategyWeightLastUpdated = null;
  let strategyWeightMax = null;
  let strategyWeightMin = null;
  try {
    const { data } = await supabase
      .from('strategy_weights')
      .select('weight,last_updated')
      .limit(500);

    const rows = Array.isArray(data) ? data : [];
    strategyWeightCount = rows.length;
    if (rows.length > 0) {
      const weights = rows
        .map((r) => Number(r?.weight))
        .filter((n) => Number.isFinite(n));
      if (weights.length > 0) {
        strategyWeightMax = Math.max(...weights);
        strategyWeightMin = Math.min(...weights);
      }
      strategyWeightLastUpdated = rows
        .map((r) => r?.last_updated)
        .filter(Boolean)
        .sort()
        .at(-1) || null;
    }
  } catch (_error) {
    strategyWeightCount = 0;
    strategyWeightLastUpdated = null;
  }

  let missedOpportunityCount = 0;
  let learningScore = 0;
  let validationLastRun = null;
  let missedReplayStatus = 'UNKNOWN';

  try {
    const { count } = await supabase
      .from('missed_opportunities')
      .select('id', { count: 'exact', head: true });
    missedOpportunityCount = count || 0;
  } catch (_error) {
    missedOpportunityCount = 0;
  }

  try {
    const { data } = await supabase
      .from('signal_validation_daily')
      .select('learning_score,created_at,date')
      .order('date', { ascending: false })
      .limit(1);
    const latest = data?.[0] || null;
    learningScore = Number(latest?.learning_score || 0);
    validationLastRun = latest?.created_at || latest?.date || null;
  } catch (_error) {
    learningScore = 0;
    validationLastRun = null;
  }

  try {
    const { count } = await supabase
      .from('missed_opportunities')
      .select('id', { count: 'exact', head: true })
      .eq('replayed', false);
    missedReplayStatus = (count || 0) > 0 ? 'PENDING' : 'OK';
  } catch (_error) {
    missedReplayStatus = 'UNKNOWN';
  }

  return {
    opportunities_24h: report.opportunities_24h,
    flow_signals_24h: flowSignalsCount || 0,
    market_news_24h: marketNewsCount || 0,
    market_metrics_rows: marketMetricsCount || 0,
    intraday_rows_24h: intradayCount || 0,
    intelligence_rows_24h: intelligenceRows24h,
    RADAR_GENERATED_AT: radarGeneratedAt,
    WATCHDOG_STATUS: watchdogStatus,
    SECONDS_SINCE_LAST_OPPORTUNITY: secondsSinceLastOpportunity,
    INTELLIGENCE_SIGNAL_COUNT: intelligenceSignalCount,
    CALIBRATION_SIGNAL_COUNT: calibrationSignalCount,
    CALIBRATION_WIN_RATE: calibrationWinRate,
    CALIBRATION_LAST_UPDATE: calibrationLastUpdate,
    SIGNAL_REGISTRY_COUNT: signalRegistryCount,
    SIGNAL_OUTCOMES_COUNT: signalOutcomesCount,
    STRATEGY_COUNT: strategyCount,
    REPLAY_ENGINE_STATUS: replayEngineStatus,
    REPLAY_SIGNAL_COUNT: replaySignalCount,
    REPLAY_LAST_RUN_AT: replayLastRunAt,
    STRATEGY_WEIGHT_COUNT: strategyWeightCount,
    STRATEGY_WEIGHT_LAST_UPDATED: strategyWeightLastUpdated,
    STRATEGY_WEIGHT_MAX: strategyWeightMax,
    STRATEGY_WEIGHT_MIN: strategyWeightMin,
    MISSED_OPPORTUNITY_COUNT: missedOpportunityCount,
    LEARNING_SCORE: learningScore,
    VALIDATION_LAST_RUN: validationLastRun,
    MISSED_REPLAY_ENGINE_STATUS: missedReplayStatus,
  };
}