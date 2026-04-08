"use client";

import EarningsChart from "@/components/research/EarningsChart";
import EarningsEdge from "@/components/research/EarningsEdge";
import MetricGridCard from "@/components/research/MetricGridCard";
import EarningsPatternBar from "@/components/research/EarningsPatternBar";
import InsightBlock from "@/components/research/InsightBlock";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { WARMING_COPY, formatBooleanLabel, formatCurrency, formatDate, formatMetricPercent, formatNumber, formatText, isNullDisplay } from "@/components/research/formatters";

function getEarningsStatus(earnings) {
  if (!earnings?.next?.date) {
    return "none";
  }

  const status = String(earnings?.status || "").trim().toLowerCase();
  if (status === "full" || status === "partial" || status === "none") {
    return status;
  }

  const hasTime = Boolean(earnings?.next?.report_time && String(earnings.next.report_time).trim().toUpperCase() !== "TBD");
  const hasEstimate = Number.isFinite(Number(earnings?.next?.eps_estimate ?? earnings?.next?.epsEstimated));
  const hasExpectedMove = Number.isFinite(Number(earnings?.next?.expected_move_percent ?? earnings?.next?.expectedMove));
  return hasTime && hasEstimate && hasExpectedMove ? "full" : "partial";
}

function formatEarningsPercent(value, fallback = WARMING_COPY) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  const sign = numeric > 0 ? "+" : "";
  return `${sign}${numeric.toFixed(2)}%`;
}

function isPlaceholderRead(value) {
  const text = String(value || "").trim();
  return !text || text === "No upcoming earnings scheduled." || text === "Upcoming earnings schedule confirmed.";
}

function getEventRead(status, earnings, edge) {
  const earningsRead = isPlaceholderRead(earnings?.read) ? null : earnings?.read;
  const edgeRead = isPlaceholderRead(edge?.read) ? null : edge?.read;

  if (status === "none") {
    return edgeRead || earningsRead || "No upcoming earnings scheduled.";
  }

  if (status === "partial") {
    return earningsRead || edgeRead || "Upcoming earnings scheduled. Some event details are still estimating.";
  }

  return earningsRead || edgeRead || "Upcoming earnings schedule confirmed.";
}

function EventCard({ label, value }) {
  const isEmpty = isNullDisplay(value);

  return (
    <div className={`rounded-2xl border p-4 ${isEmpty ? "border-slate-800/40 bg-slate-950/20" : "border-slate-800/70 bg-slate-950/40"}`}>
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className={`mt-2 text-xl font-semibold ${isEmpty ? "text-slate-500" : "text-slate-100"}`}>{value}</div>
    </div>
  );
}

export default function EarningsTab({ terminal }) {
  const earnings = terminal.earnings;
  const edge = earnings?.edge || terminal.earningsEdge;
  const status = getEarningsStatus(earnings);
  const eventRead = getEventRead(status, earnings, edge);
  const catalyst = terminal.scanner?.catalyst_events || {};

  return (
    <div className="space-y-4">
      <EarningsChart earnings={earnings} />
      <EarningsPatternBar pattern={earnings?.pattern || edge?.earnings_pattern || edge?.earningsPattern} history={earnings?.history} />

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Card className="border-slate-800/80 bg-slate-950/50">
        <CardHeader>
          <CardTitle>Earnings</CardTitle>
          <CardDescription>Upcoming event timing and consensus-derived volatility framing.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          {status === "none" ? (
            <div className="md:col-span-4 rounded-2xl border border-dashed border-slate-800/70 bg-slate-950/40 p-4 text-sm text-slate-300">
              No upcoming earnings scheduled.
            </div>
          ) : (
            <>
              <EventCard label="Next Date" value={formatDate(earnings?.next?.date)} />
              <EventCard label="Report Time" value={status === "partial" ? (earnings?.next?.report_time && earnings.next.report_time !== "TBD" ? earnings.next.report_time : WARMING_COPY) : (earnings?.next?.report_time && earnings.next.report_time !== "TBD" ? earnings.next.report_time : WARMING_COPY)} />
              <EventCard label="EPS Estimate" value={Number.isFinite(Number(earnings?.next?.eps_estimate ?? earnings?.next?.epsEstimated)) ? formatCurrency(Number(earnings?.next?.eps_estimate ?? earnings?.next?.epsEstimated)) : WARMING_COPY} />
              <EventCard label="Expected Move" value={formatEarningsPercent(earnings?.next?.expected_move_percent ?? earnings?.next?.expectedMove)} />
            </>
          )}
        </CardContent>
        </Card>

        <Card className="border-slate-800/80 bg-slate-950/50">
        <CardHeader>
          <CardTitle>Event Read</CardTitle>
          <CardDescription>Read generated from actual earnings reaction history.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-6 text-slate-300">{eventRead}</p>
        </CardContent>
        </Card>
      </div>

      <EarningsEdge edge={edge} />

      <MetricGridCard
        title="Catalyst & Events"
        description="Event-driven screener fields moved into research so they remain available per ticker without crowding the scanner." 
        items={[
          { label: "Days to Earnings", value: formatNumber(catalyst.days_to_earnings, 0) },
          { label: "Earnings Surprise %", value: formatMetricPercent(catalyst.earnings_surprise_percent) },
          { label: "Has News Today", value: formatBooleanLabel(catalyst.has_news_today) },
          { label: "Recent Insider Buy", value: formatText(catalyst.recent_insider_buy_summary || (catalyst.recent_insider_buy ? "Yes" : null)) },
          { label: "Recent Upgrade", value: formatText(catalyst.recent_upgrade_summary || (catalyst.recent_upgrade ? "Yes" : null)) },
          { label: "Institutional Ownership %", value: formatMetricPercent(catalyst.institutional_ownership_percent, { signed: false }) },
          { label: "Insider Ownership %", value: formatMetricPercent(catalyst.insider_ownership_percent, { signed: false }) },
        ]}
        columns="md:grid-cols-2 xl:grid-cols-4"
      />

      <InsightBlock
        title="Earnings Read"
        body={eventRead}
        tone={String(edge?.directional_bias || edge?.directionalBias || "MIXED") === "UPSIDE" ? "positive" : String(edge?.directional_bias || edge?.directionalBias || "MIXED") === "DOWNSIDE" ? "negative" : "neutral"}
      />
    </div>
  );
}