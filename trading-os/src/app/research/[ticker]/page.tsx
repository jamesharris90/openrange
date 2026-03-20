import type { Metadata } from "next";

import { ResearchView } from "@/components/terminal/research-view";
import { normalizeMarketQuotes } from "@/lib/api/normalize";
import { API_BASE } from "@/lib/config/apiBase";
import { toFixedSafe } from "@/lib/number";

type Props = {
  params: { ticker: string };
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ticker = params.ticker.toUpperCase();

  let price = "";

  try {
    const response = await fetch(`${API_BASE}/api/intelligence/markets?symbols=${encodeURIComponent(ticker)}`, { cache: "no-store" });
    if (response.ok) {
      const payload = (await response.json()) as Record<string, unknown>;
      const row = normalizeMarketQuotes(payload)[0];
      if (row && typeof row.price === "number") price = ` $${toFixedSafe(row.price, 2)}`;
    }
  } catch {
    // Metadata is best-effort and should not block page rendering.
  }

  const title = `${ticker} Research | OpenRange`;
  const description = `${ticker} technical chart, financial context, earnings intelligence, AI narrative, and probability forecast.${price}`;
  const canonical = `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001"}/research/${ticker}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      type: "article",
      url: canonical,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default function ResearchPage({ params }: Props) {
  return <ResearchView ticker={params.ticker.toUpperCase()} />;
}
