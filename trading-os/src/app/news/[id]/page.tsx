"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { getNewsDetail } from "@/lib/api/news";
import { toFixedSafe } from "@/lib/number";

export default function NewsDetailPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || "");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["news-detail", id],
    queryFn: () => getNewsDetail(id),
    enabled: Boolean(id),
  });

  if (isLoading) {
    return <div className="rounded-2xl border border-slate-800 bg-panel p-6 text-sm text-slate-300">Loading news detail...</div>;
  }

  if (isError || !data) {
    return <div className="rounded-2xl border border-slate-800 bg-panel p-6 text-sm text-slate-300">News detail unavailable.</div>;
  }

  const headline = data.headline || "Untitled";
  const source = data.provider || data.source || "Unknown source";
  const narrative = data.catalyst_narrative || data.narrative || "Narrative unavailable";

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-800 bg-panel p-6 shadow-lg">
        <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">News Intelligence</div>
        <h1 className="text-xl font-semibold text-slate-100">{headline}</h1>
        <div className="mt-2 text-xs text-slate-400">
          {data.symbol || "N/A"} | {new Date(String(data.published_at || Date.now())).toLocaleString()} | {source}
        </div>
        <p className="mt-4 text-sm text-slate-200">{data.summary || "No summary provided."}</p>
        <p className="mt-3 text-sm text-slate-300">{narrative}</p>
        <div className="mt-4 grid gap-2 text-xs text-slate-300 md:grid-cols-2">
          <div>Confidence: {toFixedSafe(data.confidence_score || 0, 2)}</div>
          <div>Expected move: {toFixedSafe(data.expected_move_low || 0, 2)} to {toFixedSafe(data.expected_move_high || 0, 2)}</div>
          <div>Sector trend: {data.sector_trend || "n/a"}</div>
          <div>Market trend: {data.market_trend || "n/a"}</div>
          <div>Freshness minutes: {toFixedSafe(data.freshness_minutes || 0, 0)}</div>
          <div>Provider count: {toFixedSafe(data.provider_count || 0, 0)}</div>
        </div>
        <div className="mt-4 flex flex-wrap gap-3 text-xs">
          {data.url ? (
            <a className="text-cyan-300 underline-offset-2 hover:underline" href={data.url} rel="noreferrer" target="_blank">
              Open source article
            </a>
          ) : null}
          {data.source_links?.map((href) => (
            <a key={href} className="text-cyan-300 underline-offset-2 hover:underline" href={href} rel="noreferrer" target="_blank">
              Source link
            </a>
          ))}
          <Link className="text-slate-400 underline-offset-2 hover:underline" href="/catalyst-scanner">
            Back to catalyst scanner
          </Link>
        </div>
      </div>
    </div>
  );
}
