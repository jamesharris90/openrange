import type { Metadata } from "next";

import ResearchView from "@/components/research/ResearchPage";
import { SITE_URL } from "@/lib/apiBase";
import { toFixedSafe } from "@/lib/number";

type Props = {
  params: { ticker: string };
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ticker = params.ticker.toUpperCase();

  let price = "";

  try {
    const response = await fetch(`${SITE_URL}/api/research/${encodeURIComponent(ticker)}`, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });
    if (response.ok) {
      const payload = (await response.json()) as {
        data?: {
          overview?: {
            price?: number;
          };
        };
      };
      const marketPrice = payload?.data?.overview?.price;
      if (typeof marketPrice === "number") {
        price = ` $${toFixedSafe(marketPrice, 2)}`;
      }
    }
  } catch {
    // Metadata is best-effort and should not block page rendering.
  }

  const title = `${ticker} Research | OpenRange`;
  const description = `${ticker} technical chart, financial context, earnings intelligence, AI narrative, and probability forecast.${price}`;
  const canonical = `${SITE_URL}/research/${ticker}`;

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
  return <ResearchView symbol={params.ticker.toUpperCase()} />;
}
