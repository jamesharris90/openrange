"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { getCatalystDetail } from "@/lib/api/news";
import { toFixedSafe } from "@/lib/number";

export default function CatalystDetailPage() {
  const params = useParams<{ newsId: string }>();
  const newsId = String(params?.newsId || "");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["catalyst-detail", newsId],
    queryFn: () => getCatalystDetail(newsId),
    enabled: Boolean(newsId),
  });

  if (isLoading) {
    return <div className="rounded-2xl border border-slate-800 bg-panel p-6 text-sm text-slate-300">Loading catalyst detail...</div>;
  }

  if (isError || !data) {
    return <div className="rounded-2xl border border-slate-800 bg-panel p-6 text-sm text-slate-300">Catalyst detail unavailable.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-800 bg-panel p-6 shadow-lg">
        <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Catalyst Detail</div>
        <h1 className="text-xl font-semibold text-slate-100">{data.headline || "Catalyst"}</h1>
        <div className="mt-2 text-xs text-slate-400">
          {data.symbol || "N/A"} | type: {data.catalyst_type || "n/a"} | providers: {toFixedSafe(data.provider_count || 0, 0)}
        </div>

        <p className="mt-4 text-sm text-slate-300">{data.narrative || "Narrative unavailable."}</p>

        <div className="mt-4 grid gap-2 text-xs text-slate-300 md:grid-cols-2">
          <div>Confidence score: {toFixedSafe(data.confidence_score || 0, 2)}</div>
          <div>Expected move: {toFixedSafe(data.expected_move_low || 0, 2)} to {toFixedSafe(data.expected_move_high || 0, 2)}</div>
          <div>Freshness minutes: {toFixedSafe(data.freshness_minutes || 0, 0)}</div>
          <div>Sentiment score: {toFixedSafe(data.sentiment_score || 0, 2)}</div>
          <div>Sector trend: {data.sector_trend || "n/a"}</div>
          <div>Market trend: {data.market_trend || "n/a"}</div>
          <div>Float size: {toFixedSafe(data.float_size || 0, 0)}</div>
          <div>Short interest: {toFixedSafe(data.short_interest || 0, 2)}</div>
          <div>Institutional ownership: {toFixedSafe(data.institutional_ownership || 0, 2)}</div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-panel p-6 shadow-lg">
        <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Reaction / Tradeability</div>
        <div className="grid gap-2 text-xs text-slate-300 md:grid-cols-2">
          <div>Reaction type: {data.reaction_type || "n/a"}</div>
          <div>Tradeable now: {data.is_tradeable_now ? "yes" : "no"}</div>
          <div>Continuation probability: {toFixedSafe(data.continuation_probability || 0, 2)}</div>
          <div>Abnormal volume ratio: {toFixedSafe(data.abnormal_volume_ratio || 0, 2)}</div>
          <div>First 5m move: {toFixedSafe(data.first_5m_move || 0, 2)}%</div>
          <div>Current move: {toFixedSafe(data.current_move || 0, 2)}%</div>
          <div>Expectation gap score: {toFixedSafe(data.expectation_gap_score || 0, 2)}</div>
          <div>Priced in: {data.priced_in_flag ? "yes" : "no"}</div>
          <div>QQQ trend: {toFixedSafe(data.qqq_trend || 0, 2)}%</div>
          <div>SPY trend: {toFixedSafe(data.spy_trend || 0, 2)}%</div>
          <div>Sector alignment: {toFixedSafe(data.sector_alignment || 0, 2)}</div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3 text-xs">
          {data.source_links?.map((href) => (
            <a key={href} className="text-cyan-300 underline-offset-2 hover:underline" href={href} rel="noreferrer" target="_blank">
              Source link
            </a>
          ))}
          <Link className="text-slate-400 underline-offset-2 hover:underline" href="/catalyst-scanner">
            Back to catalyst scanner
          </Link>
          {data.news_id ? (
            <Link className="text-slate-400 underline-offset-2 hover:underline" href={`/news/${data.news_id}`}>
              Open related news
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
