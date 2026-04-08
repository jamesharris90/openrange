"use client";

import InsightBlock from "@/components/research/InsightBlock";
import MetricGridCard from "@/components/research/MetricGridCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { formatCompactNumber, formatMetricPercent, formatNumber } from "@/components/research/formatters";

function Sparkline({ values }) {
  const points = (Array.isArray(values) ? values : []).filter((value) => typeof value === "number" && Number.isFinite(value));
  if (points.length < 2) {
    return <div className="h-10 w-24 rounded-full bg-slate-900/60" />;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const path = points.map((value, index) => {
    const x = points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
    const y = 36 - (((value - min) / span) * 28);
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");

  return (
    <svg viewBox="0 0 100 40" className="h-10 w-24 overflow-visible">
      <path d={path} fill="none" stroke="#22d3a0" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function MetricCard({ label, value, sparkline = null }) {
  return (
    <div className="rounded-2xl border border-slate-800/70 bg-slate-950/40 p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="text-xl font-semibold text-slate-100">{value}</div>
        {sparkline}
      </div>
    </div>
  );
}

function buildQualityRead(fundamentals) {
  const revenueGrowth = fundamentals.revenue_growth ?? 0;
  const epsGrowth = fundamentals.eps_growth ?? 0;
  const grossMargin = fundamentals.gross_margin ?? 0;
  const netMargin = fundamentals.net_margin ?? 0;

  if (revenueGrowth > 10 && epsGrowth > 10 && grossMargin > 40 && netMargin > 10) {
    return "Growth, margin conversion, and leverage all screen constructive for a quality compounder profile.";
  }

  if (revenueGrowth < 0 || epsGrowth < 0 || netMargin < 0) {
    return "Fundamental momentum is uneven. Negative growth or margin pressure should be treated as a validation item before sizing conviction.";
  }

  return "The fundamental profile is balanced but not one-sided. Treat valuation and upcoming catalysts as the deciding variables.";
}

export default function FundamentalsTab({ terminal }) {
  const fundamentals = terminal.fundamentals;
  const scannerFundamentals = terminal.scanner?.fundamentals || {};
  const trends = Array.isArray(fundamentals?.trends) ? fundamentals.trends : [];
  const revenueTrend = trends.map((row) => row?.revenue).filter((value) => typeof value === "number");
  const epsTrend = trends.map((row) => row?.eps).filter((value) => typeof value === "number");
  const grossTrend = trends.map((row) => row?.gross_margin).filter((value) => typeof value === "number");
  const netTrend = trends.map((row) => row?.net_margin).filter((value) => typeof value === "number");

  return (
    <div className="space-y-4">
      <Card className="border-slate-800/80 bg-slate-950/50">
        <CardHeader>
          <CardTitle>Fundamentals</CardTitle>
          <CardDescription>Growth, margin conversion, cash flow, and valuation in one consolidated view.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <MetricCard label="Revenue Growth" value={formatMetricPercent(fundamentals.revenue_growth, { scaleRatio: true })} sparkline={<Sparkline values={revenueTrend} />} />
            <MetricCard label="EPS Growth" value={formatMetricPercent(fundamentals.eps_growth, { scaleRatio: true })} sparkline={<Sparkline values={epsTrend} />} />
            <MetricCard label="Gross Margin" value={formatMetricPercent(fundamentals.gross_margin, { signed: false })} sparkline={<Sparkline values={grossTrend} />} />
            <MetricCard label="Net Margin" value={formatMetricPercent(fundamentals.net_margin, { signed: false })} sparkline={<Sparkline values={netTrend} />} />
            <MetricCard label="Free Cash Flow" value={formatCompactNumber(fundamentals.free_cash_flow)} />
          </div>
          <InsightBlock title="Fundamentals Read" body={buildQualityRead(fundamentals)} />
        </CardContent>
      </Card>

      <MetricGridCard
        title="Valuation & Quality"
        description="Screener-aligned valuation and balance-sheet fields, consolidated into the fundamentals workspace."
        items={[
          { label: "P/E", value: formatNumber(scannerFundamentals.pe) },
          { label: "P/S", value: formatNumber(scannerFundamentals.ps) },
          { label: "Debt/Equity", value: formatNumber(scannerFundamentals.debt_equity) },
          { label: "ROE %", value: formatMetricPercent(scannerFundamentals.roe_percent, { signed: false }) },
          { label: "FCF Yield %", value: formatMetricPercent(scannerFundamentals.fcf_yield_percent) },
          { label: "Dividend Yield %", value: formatMetricPercent(scannerFundamentals.dividend_yield_percent, { signed: false }) },
          { label: "EPS Growth %", value: formatMetricPercent(scannerFundamentals.eps_growth_percent) },
          { label: "Revenue Growth %", value: formatMetricPercent(scannerFundamentals.revenue_growth_percent) },
        ]}
      />
    </div>
  );
}