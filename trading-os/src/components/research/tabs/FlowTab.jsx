"use client";

import MetricGridCard from "@/components/research/MetricGridCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { formatBooleanLabel, formatCompactNumber, formatNumber, formatPercent } from "@/components/research/formatters";

function FlowMetric({ label, value, note }) {
  return (
    <div className="rounded-2xl border border-slate-800/70 bg-slate-950/40 p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-xl font-semibold text-slate-100">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{note}</div>
    </div>
  );
}

function insiderLabel(value) {
  if (!value) {
    return "Neutral";
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function scoreTone(value) {
  if (value >= 80) return "text-emerald-300";
  if (value >= 60) return "text-amber-300";
  return "text-rose-300";
}

function ScoreTile({ label, value, tone = "text-slate-100", detail = null }) {
  return (
    <div className="rounded-2xl border border-slate-800/70 bg-slate-950/40 p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${tone}`}>{value}</div>
      {detail ? <div className="mt-1 text-sm text-slate-500">{detail}</div> : null}
    </div>
  );
}

export default function FlowTab({ research, terminal }) {
  const ownership = research.ownership;
  const optionsFlow = terminal.scanner?.options_flow || {};
  const score = terminal.score || {};
  const optionItems = [
    { label: "IV Rank", value: formatNumber(optionsFlow.iv_rank) },
    { label: "Put/Call Ratio", value: formatNumber(optionsFlow.put_call_ratio) },
    { label: "Options Volume", value: formatCompactNumber(optionsFlow.options_volume) },
    { label: "Options Vol vs 30d", value: formatNumber(optionsFlow.options_volume_vs_30d) },
    { label: "Net Premium $", value: formatCompactNumber(optionsFlow.net_premium) },
    { label: "Unusual Options", value: formatBooleanLabel(optionsFlow.unusual_options) },
  ];
  const hasOptionsMetrics = Object.values(optionsFlow).some((value) => value !== null && value !== undefined);
  const topEtfs = Array.isArray(ownership.etf_exposure_list) ? ownership.etf_exposure_list : [];

  return (
    <div className="space-y-4">
      <Card className="border-slate-800/80 bg-slate-950/50">
        <CardHeader>
          <CardTitle>Flow & Score</CardTitle>
          <CardDescription>Ownership, sponsorship, score quality, and partial options context in one workspace.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <FlowMetric
            label="Institutional Ownership"
            value={formatPercent(ownership.institutional)}
            note="Useful for sponsorship context and crowding sensitivity."
          />
          <FlowMetric
            label="Holders"
            value={formatCompactNumber(ownership.investors_holding)}
            note="Institutional holder count from the latest summary snapshot."
          />
          <FlowMetric
            label="Insider Trend"
            value={insiderLabel(ownership.insider)}
            note={ownership.insider_summary || "Directional bias from recent insider activity."}
          />
          <FlowMetric
            label="Put/Call Ratio"
            value={formatNumber(ownership.put_call_ratio, 2)}
            note="Institutional options posture from ownership summary data."
          />
        </CardContent>
      </Card>

      <Card className="border-slate-800/80 bg-slate-950/50">
        <CardHeader>
          <CardTitle>Score Ledger</CardTitle>
          <CardDescription>Discovery now lives on the screener. Score validation lives here with the ticker context.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <ScoreTile label="Score" value={formatNumber(score.final_score, 2)} tone={scoreTone(Number(score.final_score || 0))} />
          <ScoreTile label="TQI" value={formatNumber(score.tqi, 0)} tone={scoreTone(Number(score.tqi || 0))} />
          <ScoreTile label="Grade" value={score.tqi_label || "—"} tone={scoreTone(Number(score.tqi || 0))} />
          <ScoreTile label="Coverage" value={`${Math.round(Number(score.coverage_score || terminal.coverage?.coverage_score || 0))}%`} tone={scoreTone(Number(score.coverage_score || terminal.coverage?.coverage_score || 0))} />
          <ScoreTile label="DCS" value={`${Math.round(Number(score.data_confidence || terminal.data_confidence || 0))}`} tone={scoreTone(Number(score.data_confidence || terminal.data_confidence || 0))} detail={score.data_confidence_label || terminal.data_confidence_label || "—"} />
        </CardContent>
      </Card>

      <Card className="border-slate-800/80 bg-slate-950/50">
        <CardHeader>
          <CardTitle>Insider & ETF Detail</CardTitle>
          <CardDescription>Recent filings and ETF exposure from the latest ownership refresh.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <FlowMetric label="Recent Insider Buy" value={ownership.recent_insider_buy_summary || "—"} note="Recent acquisition summary when available." />
            <FlowMetric label="Recent Upgrade" value={ownership.recent_upgrade_summary || "—"} note="Latest analyst upgrade or constructive rating action." />
          </div>
          {topEtfs.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              {topEtfs.map((item, index) => (
                <div key={`${item.name || "etf"}-${item.weight_percent ?? "na"}-${index}`} className="rounded-2xl border border-slate-800/70 bg-slate-950/40 p-4">
                  <div className="truncate text-[11px] uppercase tracking-[0.18em] text-slate-500">ETF</div>
                  <div className="mt-2 truncate text-sm font-semibold text-slate-100">{item.name}</div>
                  <div className="mt-1 text-sm text-teal-200">{formatPercent(item.weight_percent)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-700/80 bg-slate-950/40 px-4 py-6 text-sm text-slate-400">ETF exposure data is still filling for this ticker.</div>
          )}
        </CardContent>
      </Card>

      {hasOptionsMetrics ? (
        <MetricGridCard
          title="Options Flow"
          description="Partial fill only. Real-time options flow still requires a dedicated provider beyond FMP."
          items={optionItems}
        />
      ) : (
        <Card className="border-slate-800/80 bg-slate-950/50">
          <CardContent className="p-4 text-sm text-slate-400">
            {/* Full options flow requires a dedicated provider such as Unusual Whales, CBOE, or similar. */}
            Options flow data requires additional data source integration. Coming soon.
          </CardContent>
        </Card>
      )}
    </div>
  );
}