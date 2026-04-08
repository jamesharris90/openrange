import { apiGet } from "@/lib/api/client";
import { debugLog } from "@/lib/debug";

type NewsItem = {
  symbol?: string;
  headline?: string;
  title?: string;
  summary?: string;
  narrative?: string;
  catalyst_narrative?: string;
  body_text?: string;
  source?: string;
  provider?: string;
  catalyst_type?: string;
  provider_count?: number;
  confidence_score?: number;
  expected_move_low?: number;
  expected_move_high?: number;
  freshness_minutes?: number;
  sentiment_score?: number;
  sector_trend?: string;
  market_trend?: string;
  float_size?: number;
  short_interest?: number;
  institutional_ownership?: number;
  reaction_type?: string;
  is_tradeable_now?: boolean;
  continuation_probability?: number;
  abnormal_volume_ratio?: number;
  first_5m_move?: number;
  current_move?: number;
  expectation_gap_score?: number;
  priced_in_flag?: boolean;
  qqq_trend?: number;
  spy_trend?: number;
  sector_alignment?: number;
  news_id?: string;
  source_links?: string[];
  publisher?: string;
  site?: string;
  url?: string;
  image_url?: string;
  published_at?: string;
  published_date?: string;
  raw_json?: Record<string, unknown>;
  ingested_at?: string;
};

export async function getLatestNews(limit = 50): Promise<NewsItem[]> {
  const response = await apiGet<{ success?: boolean; data?: NewsItem[] } | NewsItem[]>(`/api/news?limit=${limit}`);
  debugLog("/api/news", response);
  if (Array.isArray(response)) {
    return response;
  }
  if (Array.isArray(response?.data)) {
    return response.data;
  }
  throw new Error("No data returned from API");
}

export async function getNewsBySymbol(symbol: string, limit = 50): Promise<NewsItem[]> {
  const normalized = encodeURIComponent(String(symbol || "").trim().toUpperCase());
  if (!normalized) return [];
  const response = await apiGet<{ success?: boolean; data?: NewsItem[] } | NewsItem[]>(`/api/news?symbol=${normalized}&limit=${limit}`);
  if (Array.isArray(response)) {
    return response;
  }
  if (Array.isArray(response?.data)) {
    return response.data;
  }
  throw new Error("No data returned from API");
}

export async function getNewsDetail(id: string): Promise<NewsItem | null> {
  const response = await apiGet<{ ok?: boolean; items?: NewsItem[] }>(`/api/news/id/${encodeURIComponent(id)}`);
  return response.items?.[0] || null;
}

export async function getCatalystDetail(newsId: string): Promise<NewsItem | null> {
  const response = await apiGet<{ ok?: boolean; items?: NewsItem[] }>(`/api/catalysts/id/${encodeURIComponent(newsId)}`);
  return response.items?.[0] || null;
}
