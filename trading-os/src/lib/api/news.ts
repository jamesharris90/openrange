import { apiGet } from "@/lib/api/client";

type NewsItem = {
  id?: string;
  news_id?: number;
  symbol?: string;
  headline?: string;
  summary?: string;
  source?: string;
  provider?: string;
  url?: string;
  published_at?: string;
  sector?: string;
  sentiment?: string;
  news_score?: number;
  catalyst_type?: string;
  provider_count?: number;
  freshness_minutes?: number;
  sector_trend?: string;
  market_trend?: string;
  float_size?: number;
  short_interest?: number;
  institutional_ownership?: number;
  expected_move_low?: number;
  expected_move_high?: number;
  confidence_score?: number;
  sentiment_score?: number;
  narrative?: string;
  catalyst_narrative?: string;
  reaction_type?: string;
  abnormal_volume_ratio?: number;
  first_5m_move?: number;
  current_move?: number;
  continuation_probability?: number;
  expectation_gap_score?: number;
  priced_in_flag?: boolean;
  is_tradeable_now?: boolean;
  qqq_trend?: number;
  spy_trend?: number;
  sector_alignment?: number;
  provider_list?: string[];
  source_links?: string[];
};

export async function getLatestNews(limit = 50): Promise<NewsItem[]> {
  const response = await apiGet<{ ok?: boolean; items?: NewsItem[] }>(`/api/news/latest?limit=${limit}`);
  if (!response.items) {
    throw new Error("No data returned from API");
  }
  return response.items;
}

export async function getNewsBySymbol(symbol: string, limit = 50): Promise<NewsItem[]> {
  const normalized = encodeURIComponent(String(symbol || "").trim().toUpperCase());
  if (!normalized) return [];
  const response = await apiGet<{ ok?: boolean; items?: NewsItem[] }>(`/api/news/symbol/${normalized}?limit=${limit}`);
  if (!response.items) {
    throw new Error("No data returned from API");
  }
  return response.items;
}

export async function getNewsDetail(id: string): Promise<NewsItem | null> {
  const response = await apiGet<{ ok?: boolean; items?: NewsItem[] }>(`/api/news/id/${encodeURIComponent(id)}`);
  return response.items?.[0] || null;
}

export async function getCatalystDetail(newsId: string): Promise<NewsItem | null> {
  const response = await apiGet<{ ok?: boolean; items?: NewsItem[] }>(`/api/catalysts/id/${encodeURIComponent(newsId)}`);
  return response.items?.[0] || null;
}
