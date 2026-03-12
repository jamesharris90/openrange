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

  report.opportunities_24h = opportunitiesCount || 0;

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
  };
}
