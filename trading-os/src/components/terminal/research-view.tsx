"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { ChartEngine } from "@/components/charts/chart-engine";
import { DataUnavailable } from "@/components/data-unavailable";
import { ExpectedMoveChip } from "@/components/terminal/expected-move-chip";
import { getTickerEarnings } from "@/lib/api/earnings";
import { getNewsBySymbol } from "@/lib/api/news";
import { getResearchOverview } from "@/lib/api/stocks";
import { normalizeDataSource } from "@/lib/data-source";
import { buildStockDecision } from "@/lib/decision-engine";
import { buildMarketContext } from "@/lib/market-context";
import { percentSafe, toFixedSafe, toNumber } from "@/lib/number";
import { QUERY_POLICY, queryKeys } from "@/lib/queries/policy";

export function ResearchView({ ticker }: { ticker: string }) {
  const { data: overview } = useQuery({
    queryKey: queryKeys.research(ticker),
    queryFn: () => getResearchOverview(ticker),
    ...QUERY_POLICY.slow,
  });

  const { data: earnings = [] } = useQuery({
    queryKey: [...queryKeys.research(ticker), "earnings"],
    queryFn: () => getTickerEarnings(ticker),
    ...QUERY_POLICY.slow,
  });

  const { data: news = [] } = useQuery({
    queryKey: [...queryKeys.research(ticker), "news"],
    queryFn: async () => {
      try {
        return await getNewsBySymbol(ticker, 6);
      } catch {
        return [];
      }
    },
    ...QUERY_POLICY.medium,
  });

  const safeEarnings = earnings.map((row) => ({
    ...row,
    earnings_date: String((row as unknown as { earnings_date?: unknown; event_date?: unknown }).earnings_date ?? (row as unknown as { earnings_date?: unknown; event_date?: unknown }).event_date ?? ""),
    beat_miss: String((row as unknown as { beat_miss?: unknown }).beat_miss ?? ""),
    source: normalizeDataSource((row as unknown as { source?: unknown }).source),
    price: toNumber((row as unknown as { price?: unknown }).price, 0),
    prevClose: toNumber((row as unknown as { prevClose?: unknown; prev_close?: unknown }).prevClose ?? (row as unknown as { prevClose?: unknown; prev_close?: unknown }).prev_close, 0),
    iv: toNumber((row as unknown as { iv?: unknown }).iv, 0),
    value: toNumber((row as unknown as { value?: unknown }).value, 0),
    probability: toNumber((row as unknown as { probability?: unknown }).probability, 0),
    confidence: toNumber((row as unknown as { confidence?: unknown }).confidence, 0),
    expected_move: toNumber(row.expected_move, 0),
    actual_move: toNumber(row.actual_move, 0),
    post_earnings_move: toNumber(row.post_earnings_move, 0),
  }));

  const earningsWithDecision = safeEarnings.map((row) => {
    const expectedPercent = Math.abs(toNumber(row.expected_move, 0));
    const rowPrice = toNumber((row as unknown as { price?: unknown }).price, 0) || toNumber((row as unknown as { prevClose?: unknown }).prevClose, 0);
    const rowIv = toNumber((row as unknown as { iv?: unknown }).iv, 0);

    if (!rowPrice || rowPrice <= 0) {
      console.warn("[DATA QUALITY ISSUE]", {
        symbol: String(row.symbol || ticker).toUpperCase(),
        missing: ["price"],
      });
      return null;
    }

    if (!rowIv || rowIv <= 0) {
      console.warn("[DATA QUALITY ISSUE]", {
        symbol: String(row.symbol || ticker).toUpperCase(),
        missing: ["iv"],
      });
    }

    const decision = buildStockDecision({
      symbol: row.symbol || ticker,
      price: rowPrice,
      iv: rowIv,
      catalyst: "earnings",
      trend: toNumber(row.actual_move, 0) >= 0 ? "bullish" : "bearish",
      volumeSpike: expectedPercent >= 4,
    });

    const effectiveDecision = decision || {
      reason: "Insufficient options metrics for full decision model",
      expectedMove: expectedPercent,
      probability: toNumber(row.probability, 50),
      confidence: toNumber(row.confidence, 50),
      catalystType: "earnings",
    };

    return {
      ...row,
      decision: effectiveDecision,
      expectedValue: Math.abs(toNumber(row.expected_move, 0)),
      actualValue: toNumber(row.actual_move, 0),
    };
  }).filter((row): row is NonNullable<typeof row> => Boolean(row));

  const safeNews = news.map((row) => ({
    ...row,
    data_source: normalizeDataSource(row.source || row.provider),
    headline: String((row as Record<string, unknown>).title || row.headline || "").trim(),
    source: String(row.source || row.provider || "Market source"),
    published_at: String((row as Record<string, unknown>).published_date || row.published_at || ""),
    sentiment_score: toNumber(row.sentiment_score, 0),
    confidence_score: toNumber(row.confidence_score, 0),
  }));

  const overviewRecord = (overview as Record<string, unknown> | undefined) || {};
  const overviewSource = normalizeDataSource(overviewRecord.source);
  const basePrice = toNumber(overviewRecord.price, 0);
  const lastPrice = toNumber(overviewRecord.lastPrice ?? overviewRecord.last_price, 0);
  const prevClose = toNumber(overviewRecord.prevClose ?? overviewRecord.previousClose ?? overviewRecord.previous_close, 0);
  const resolvedPrice = basePrice || lastPrice || prevClose;
  const priceValue = resolvedPrice;
  const marketCapValue = toNumber(overviewRecord.market_cap, 0);
  const hasPrice = Number.isFinite(resolvedPrice) && resolvedPrice > 0;
  const hasMarketCap = Number.isFinite(marketCapValue) && marketCapValue > 0;
  const ivValue = toNumber(overviewRecord.iv, 0);
  const gexValue = toNumber(overviewRecord.gex, 0);
  const oiValue = toNumber(
    overviewRecord.openInterest ?? overviewRecord.open_interest,
    0
  );
  const marketContext = buildMarketContext({
    price: basePrice,
    lastPrice,
    prevClose,
    iv: ivValue,
    gex: gexValue,
    openInterest: oiValue,
    symbol: ticker,
  });
  const expectedMovePercent =
    marketContext && priceValue > 0
      ? Math.max((marketContext.expectedMove / priceValue) * 100, 0.01)
      : 0;

  useEffect(() => {
    const debugPayload = {
      ticker,
      hasOverview: Boolean(overview),
      overview,
      earningsCount: safeEarnings.length,
      newsCount: safeNews.length,
      price: priceValue,
      iv: ivValue,
      expectedMove: marketContext?.expectedMove,
      gex: marketContext?.gex,
    };
    console.log("RESEARCH VIEW RENDER", debugPayload);

    if (typeof window !== "undefined" && (window as Window & { __OR_DEBUG__?: boolean }).__OR_DEBUG__) {
      console.log("[DATA CHECK]", {
        symbol: ticker,
        price: priceValue,
        iv: ivValue,
        expectedMove: marketContext?.expectedMove,
        gex: marketContext?.gex,
      });
    }
  }, [ticker, overview, safeEarnings, safeNews, priceValue, ivValue, marketContext?.expectedMove, marketContext?.gex]);

  if (!resolvedPrice || resolvedPrice <= 0 || !marketContext) {
    console.warn("[DATA QUALITY ISSUE]", {
      symbol: ticker,
      missing: [
        ...((!resolvedPrice || resolvedPrice <= 0) ? ["price"] : []),
        ...((!marketContext) ? ["context"] : []),
      ],
    });
    return <DataUnavailable />;
  }

  const primaryHeadline = safeNews[0]?.headline || "";
  const newsMappedReason =
    primaryHeadline.length > 0
      ? `${ticker} is reacting to ${primaryHeadline} with ${marketContext.positioning} dealer positioning.`
      : `${ticker} is being driven by flow and ${marketContext.positioning} positioning.`;

  const computedDecision = buildStockDecision({
    symbol: ticker,
    price: priceValue,
    iv: ivValue,
    catalyst: primaryHeadline ? "news" : earningsWithDecision.length > 0 ? "earnings" : "research",
    trend: marketContext.positioning === "supportive" ? "bullish" : marketContext.positioning === "volatile" ? "bearish" : "neutral",
    volumeSpike: toNumber(overviewRecord.volume, 0) > 1000000 || Math.abs(expectedMovePercent) >= 3,
  });

  const decision = computedDecision || {
    reason: "Insufficient options metrics for full decision model",
    expectedMove: Number.isFinite(marketContext.expectedMove) ? marketContext.expectedMove : 0,
    probability: 50,
    confidence: 50,
    catalystType: primaryHeadline ? "news" : "research",
  };

  const bias = decision.probability >= 55 ? "Bullish" : decision.probability <= 45 ? "Bearish" : "Neutral";
  const risk = decision.confidence >= 72 ? "Medium" : decision.confidence >= 55 ? "Moderate" : "High";
  const keySupport = Math.max(priceValue - marketContext.expectedMove * 0.4, 0);
  const decisionReason = primaryHeadline ? newsMappedReason : decision.reason;
  const convictionStrong = decision.probability >= 68 && decision.confidence >= 72;

  const decisionTone = decision.probability >= 60 ? "bg-emerald-500" : decision.probability <= 40 ? "bg-rose-500" : "bg-amber-400";
  const confidenceTone = decision.confidence >= 70 ? "bg-emerald-500" : decision.confidence <= 45 ? "bg-rose-500" : "bg-amber-400";
  const positioningTone = marketContext.positioning === "supportive" ? "text-emerald-300" : marketContext.positioning === "volatile" ? "text-rose-300" : "text-amber-300";
  const expectedMoveLabel = `±${toFixedSafe(expectedMovePercent, 2)}%`;

  return (
    <div className="space-y-4">
      <section className={`rounded-2xl border bg-panel p-4 shadow-lg ${convictionStrong ? "border-emerald-500/40 shadow-emerald-500/20" : "border-slate-800"}`}>
        <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Trade Insight</div>
        <div className="mb-2 text-[11px] text-slate-500">Source: {overviewSource}</div>
        <div className="decision-card rounded-xl border border-slate-700 bg-slate-950/60 p-3">
          <h3 className="text-sm font-semibold text-slate-100">Decision System</h3>
          <div className="mt-2 text-xs text-slate-400">Why it&apos;s moving:</div>
          <p className="text-xs text-slate-200">{decisionReason}</p>

          <div className="mt-2 grid gap-2 text-xs md:grid-cols-3">
            <div>
              <div className="text-slate-400">Bias</div>
              <p className="font-semibold text-slate-100">{bias}</p>
            </div>
            <div>
              <div className="text-slate-400">Expected Move</div>
              <p className="font-mono text-slate-100">{expectedMoveLabel}</p>
            </div>
            <div>
              <div className="text-slate-400">Catalyst Type</div>
              <p className="text-slate-100 capitalize">{decision.catalystType}</p>
            </div>
          </div>

          <div className="mt-3 text-xs text-slate-400">Probability</div>
          <div className="mt-1 h-2 w-full rounded-full bg-slate-800">
            <div className={`h-2 rounded-full ${decisionTone}`} style={{ width: `${toFixedSafe(decision.probability, 0)}%` }} />
          </div>
          <p className="mt-1 text-xs text-slate-100">{toFixedSafe(decision.probability, 0)}%</p>

          <div className="mt-2 text-xs text-slate-400">Confidence</div>
          <div className="mt-1 h-2 w-full rounded-full bg-slate-800">
            <div className={`h-2 rounded-full ${confidenceTone}`} style={{ width: `${toFixedSafe(decision.confidence, 0)}%` }} />
          </div>
          <p className="mt-1 text-xs text-slate-100">{toFixedSafe(decision.confidence, 0)}%</p>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
        <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Market Intelligence Panel</div>
        <div className="intel-grid grid gap-3 md:grid-cols-4">
          <ExpectedMoveChip label="Expected Move" percent={expectedMovePercent} dollars={marketContext.expectedMove} />
          <div className="rounded-xl border border-slate-800 p-3">
            <div className="text-xs text-slate-400">Positioning</div>
            <div className={`mt-1 text-lg capitalize ${positioningTone}`}>{marketContext.positioning}</div>
          </div>
          <div className="rounded-xl border border-slate-800 p-3">
            <div className="text-xs text-slate-400">Gamma Exposure</div>
            <div className="mt-1 font-mono text-lg text-slate-100">{toFixedSafe(marketContext.gex, 2)}</div>
          </div>
          <div className="rounded-xl border border-slate-800 p-3">
            <div className="text-xs text-slate-400">Open Interest</div>
            <div className="mt-1 font-mono text-lg text-slate-100">{toFixedSafe(marketContext.oi, 0)}</div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
        <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Chart</div>
        <ChartEngine ticker={ticker} timeframe="daily" gammaExposure={marketContext.gex} />
      </section>

      <section className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
        <div className="trade-box rounded-xl border border-slate-700 bg-slate-950/60 p-3">
          <h3 className="text-sm font-semibold text-slate-100">Trade Setup</h3>
          <p className="mt-2 text-xs text-slate-300">Bias: {bias}</p>
          <p className="text-xs text-slate-300">Expected Move: {expectedMoveLabel}</p>
          <p className="text-xs text-slate-300">Key Level: {toFixedSafe(keySupport, 2)} support</p>
          <p className="text-xs text-slate-300">Risk: {risk}</p>
          <button className="mt-3 rounded-md border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-100 hover:bg-slate-800">
            View Options Chain
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
        <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Post-Earnings Behavior Model</div>
        <div className="space-y-2">
          {earningsWithDecision.slice(0, 8).map((row) => {
            const beat = String(row.beat_miss || "").toLowerCase().includes("beat");
            const upside = row.actualValue >= 0;
            const markerTone = beat && upside ? "bg-emerald-500" : !beat && !upside ? "bg-rose-500" : "bg-amber-400";
            const directionTone = upside ? "text-emerald-400" : "text-rose-400";
            const direction = upside ? "Upside" : "Downside";

            return (
              <div key={`${row.symbol}-${row.earnings_date}`} className="grid rounded-lg border border-slate-800 p-2 text-xs text-slate-300 md:grid-cols-7">
                <span className="font-mono text-slate-100">{row.earnings_date}</span>
                <span>Expected {percentSafe(row.expectedValue, 2)}</span>
                <span>Actual {percentSafe(row.actualValue, 2)}</span>
                <span>{row.beat_miss || "N/A"}</span>
                <span className={directionTone}>{direction}</span>
                <span className="text-slate-400">{row.decision.reason}</span>
                <span className="text-slate-500">Source: {row.source}</span>
                <span className="flex items-center gap-2">
                  <span className={`inline-block h-2.5 w-2.5 rounded-full ${markerTone}`} />
                  Actual vs Expected
                </span>
              </div>
            );
          })}
          {earningsWithDecision.length === 0 && <div className="text-xs text-slate-500">No strong signals detected.</div>}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
        <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Historical Data</div>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-slate-800 p-3">
            <div className="text-xs text-slate-400">Symbol</div>
            <div className="font-mono text-sm text-slate-100">{overview?.symbol || ticker}</div>
          </div>
          <div className="rounded-xl border border-slate-800 p-3">
            <div className="text-xs text-slate-400">Price</div>
            <div className="font-mono text-sm text-slate-100">{hasPrice ? `$${toFixedSafe(priceValue, 2)}` : "No price data"}</div>
          </div>
          <div className="rounded-xl border border-slate-800 p-3">
            <div className="text-xs text-slate-400">Sector</div>
            <div className="text-sm text-slate-100">{String(overviewRecord.sector || "N/A")}</div>
          </div>
          <div className="rounded-xl border border-slate-800 p-3">
            <div className="text-xs text-slate-400">Market Cap</div>
            <div className="text-sm text-slate-100">{hasMarketCap ? marketCapValue.toLocaleString() : "No market cap data"}</div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
        <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">News</div>
        <div className="space-y-2">
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2 text-xs text-slate-300">
            {decisionReason}
          </div>
          {safeNews.slice(0, 5).map((item, idx) => (
            <div key={`${item.headline}-${idx}`} className="rounded-lg border border-slate-800 p-2 text-xs text-slate-300">
              <div className="font-medium text-slate-100">{item.headline || "Headline unavailable"}</div>
              <div className="mt-1 text-slate-500">{item.source} {item.published_at ? `| ${item.published_at}` : ""}</div>
              <div className="text-[11px] text-slate-500">Source: {item.data_source}</div>
            </div>
          ))}
          {safeNews.length === 0 && <div className="text-xs text-slate-500">No strong signals detected.</div>}
        </div>
      </section>

    </div>
  );
}
