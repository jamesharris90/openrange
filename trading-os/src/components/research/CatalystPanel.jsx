"use client";

import { memo, useMemo } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WARMING_COPY, isNullDisplay } from "@/components/research/formatters";

function normalizeNewsItems(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.items)
        ? payload.items
        : [];

  return rows
    .map((item) => {
      const headline = String(item?.headline || item?.title || "").trim();
      if (!headline) {
        return null;
      }

      return {
        id: item?.id || headline,
        symbol: String(item?.symbol || "").trim().toUpperCase() || null,
        headline,
        source: String(item?.source || "News").trim() || "News",
        url: String(item?.url || "").trim() || null,
        publishedAt: item?.publishedAt || item?.published_at || null,
        contextScope: String(item?.context_scope || item?.contextScope || 'DIRECT').trim().toUpperCase(),
      };
    })
    .filter(Boolean)
    .slice(0, 5);
}

function formatTimestamp(value) {
  if (!value) {
    return WARMING_COPY;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return WARMING_COPY;
  }

  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function scopeLabel(value) {
  switch (String(value || '').toUpperCase()) {
    case 'SECTOR':
      return 'SECTOR';
    case 'MARKET':
      return 'MACRO';
    case 'RELATED':
      return 'RELATED';
    default:
      return 'DIRECT CATALYST';
  }
}

function sourceTone(source) {
  const label = String(source || '').toUpperCase();
  if (label.includes('REUTERS')) return 'border-sky-500/30 bg-sky-500/10 text-sky-200';
  if (label.includes('SEC')) return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  if (label.includes('YAHOO')) return 'border-violet-500/30 bg-violet-500/10 text-violet-200';
  return 'border-slate-700 bg-slate-900/70 text-slate-300';
}

function buildNoDataCopy(symbol, company = {}) {
  const classificationLabel = String(company?.stock_classification_label || '').trim();
  const classificationReason = String(company?.stock_classification_reason || '').trim();

  if (!classificationLabel) {
    return {
      description: `No symbol-specific catalyst articles found for ${symbol}.`,
      body: 'No direct catalyst headlines in the current window.',
    };
  }

  return {
    description: `There is limited stock data for ${symbol} because it is classified as ${classificationLabel.toLowerCase()}.`,
    body: classificationReason || 'Structured coverage is limited for this type of listing.',
  };
}

/**
 * @param {{
 *   symbol: string,
 *   news?: Array<{
 *     id?: string | null,
 *     title?: string | null,
 *     headline?: string | null,
 *     summary?: string | null,
 *     source?: string | null,
 *     url?: string | null,
 *     publishedAt?: string | null,
 *     published_at?: string | null,
 *     contextScope?: string | null,
 *     context_scope?: string | null,
 *   }>,
 *   company?: {
 *     stock_classification?: string | null,
 *     stock_classification_label?: string | null,
 *     stock_classification_reason?: string | null,
 *     listing_type?: string | null,
 *   },
 * }} props
 */
function CatalystPanel({ symbol, news = [], company = {} }) {
  const items = useMemo(() => normalizeNewsItems(news), [news]);
  const noData = items.length === 0;
  const noDataCopy = useMemo(() => buildNoDataCopy(symbol, company), [company, symbol]);
  const description = noData
    ? noDataCopy.description
    : `Top headlines directly linked to ${symbol}.`;

  return (
    <Card className="border-slate-800/80 bg-slate-950/50">
      <CardHeader>
        <CardTitle>Catalyst</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="max-h-[70vh] overflow-y-auto pr-1">
        {items.length > 0 ? (
          <div className="space-y-3">
            {items.map((item, index) => {
              const publishedAt = formatTimestamp(item.publishedAt);
              const hasPublishedAt = !isNullDisplay(publishedAt);
              const content = (
                <div className="rounded-2xl border border-slate-800/70 bg-slate-950/45 p-4 transition hover:border-slate-700 hover:bg-slate-900/55">
                  <div className="flex items-center justify-between gap-3">
                    <div className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[0.18em] ${sourceTone(item.source)}`}>{item.source}</div>
                    <div className="rounded-full border border-slate-700 bg-slate-900/70 px-2.5 py-1 text-[10px] font-semibold tracking-[0.18em] text-slate-300">
                      {scopeLabel(item.contextScope)}
                    </div>
                  </div>
                  <div className="mt-3 flex items-start justify-between gap-3">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-300/75">Headline {index + 1}</div>
                    <div className={`text-[11px] uppercase tracking-[0.18em] ${hasPublishedAt ? "text-slate-500" : "text-slate-600"}`}>
                      {publishedAt}
                    </div>
                  </div>
                  <div className="mt-3 text-sm font-medium leading-6 text-slate-100">{item.headline}</div>
                </div>
              );

              return item.url ? (
                <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="block">
                  {content}
                </a>
              ) : (
                <div key={item.id}>{content}</div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-800/70 bg-slate-950/45 px-4 py-8 text-sm leading-6 text-slate-400">
            {noDataCopy.body}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default memo(CatalystPanel);