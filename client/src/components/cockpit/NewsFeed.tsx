import { useEffect, useState } from 'react';
import { authFetch } from '../../utils/api';

interface NewsItem {
  id: string;
  title: string;
  source: string;
  publishedAt: string;
  url: string;
}

function toItem(raw: any, index: number): NewsItem | null {
  const title = String(raw?.title || raw?.headline || '').trim();
  const url = String(raw?.url || '').trim();
  const source = String(raw?.source || 'News').trim();
  const datetime = Number(raw?.datetime);
  const publishedAt = String(
    raw?.publishedAt
      || (Number.isFinite(datetime) ? new Date(datetime * 1000).toISOString() : '')
  ).trim();
  if (!title || !url) return null;

  return {
    id: String(raw?.id || `${url}-${index}`),
    title,
    source,
    publishedAt,
    url,
  };
}

export default function NewsFeed({ symbol }: { symbol: string }) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const normalized = String(symbol || '').trim().toUpperCase();
    if (!normalized) {
      setNews([]);
      setLoading(false);
      setError('');
      return;
    }

    const controller = new AbortController();
    let active = true;

    setLoading(true);
    setError('');

    const run = async () => {
      try {
        const response = await authFetch(`/api/v5/news?symbol=${encodeURIComponent(normalized)}&limit=10`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          if (response.status === 404) throw new Error('News endpoint not found (404)');
          if (response.status >= 500) throw new Error('News service unavailable (500)');
          throw new Error(`News request failed (${response.status})`);
        }

        const payload = await response.json();
        const rows = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.news)
            ? payload.news
            : [];
        let mapped = rows
          .map((row, index) => toItem(row, index))
          .filter(Boolean) as NewsItem[];

        if (!mapped.length) {
          const fallback = await authFetch(`/api/news/symbol?symbol=${encodeURIComponent(normalized)}`, {
            signal: controller.signal,
          });
          if (fallback.ok) {
            const fallbackPayload = await fallback.json();
            const fallbackRows = Array.isArray(fallbackPayload) ? fallbackPayload : [];
            mapped = fallbackRows
              .map((row, index) => toItem(row, index))
              .filter(Boolean) as NewsItem[];
          }
        }
        console.log('[NewsFetch]', normalized, mapped.length);

        if (!active) return;
        setNews(mapped);
      } catch (fetchError: any) {
        if (!active || fetchError?.name === 'AbortError') return;
        setNews([]);
        setError(fetchError?.message || 'Failed to load news');
      } finally {
        if (active) setLoading(false);
      }
    };

    run();

    return () => {
      active = false;
      controller.abort();
    };
  }, [symbol]);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-md p-3 h-[240px] overflow-y-auto">
      <div className="text-xs uppercase tracking-wider text-gray-400 mb-2">
        {String(symbol || '').toUpperCase()} News
      </div>

      {loading && (
        <div className="text-gray-500 text-sm">Loading…</div>
      )}

      {!loading && error && (
        <div className="text-gray-500 text-sm">{error}</div>
      )}

      {!loading && !error && news.length === 0 && (
        <div className="text-gray-600 text-sm">No recent news</div>
      )}

      <div className="space-y-3">
        {news.map((item) => (
          <a
            key={item.id}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block hover:bg-gray-800 p-2 rounded transition"
          >
            <div className="text-sm text-gray-100">
              {item.title}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {item.source} • {new Date(item.publishedAt).toLocaleTimeString()}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}