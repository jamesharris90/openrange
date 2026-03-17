import type { Metadata } from "next";

import { ResearchView } from "@/components/terminal/research-view";
import { API_BASE } from "@/lib/config/apiBase";

type Props = {
  params: { ticker: string };
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ticker = params.ticker.toUpperCase();

  let price = "";
  let sector = "";

  try {
    const response = await fetch(`${API_BASE}/api/quote?symbol=${encodeURIComponent(ticker)}`, { cache: "no-store" });
    if (response.ok) {
      const payload = (await response.json()) as { price?: number; sector?: string };
      if (typeof payload.price === "number") price = ` $${payload.price.toFixed(2)}`;
      if (payload.sector) sector = ` • ${payload.sector}`;
    }
  } catch {
    // Metadata is best-effort and should not block page rendering.
  }

  const title = `${ticker} Research | OpenRange`;
  const description = `${ticker} technical chart, financial context, earnings intelligence, AI narrative, and probability forecast.${price}${sector}`;
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
