import { useEffect, useMemo, useState } from 'react';
import { authFetch } from '../utils/api';

export default function ScreenerV3FMP() {
  const [news, setNews] = useState([]);
  const [quotes, setQuotes] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');

      try {
        const newsRes = await authFetch('/api/canonical/news');
        const newsData = await newsRes.json();
        const newsItems = Array.isArray(newsData) ? newsData : [];

        if (cancelled) return;
        setNews(newsItems);

        const tickers = Array.from(
          new Set(
            newsItems.flatMap((item) => (Array.isArray(item.tickers) ? item.tickers : []))
          )
        );

        if (!tickers.length) {
          if (!cancelled) {
            setQuotes({});
            setLoading(false);
          }
          return;
        }

        const quotesRes = await authFetch(`/api/canonical/quotes?symbols=${encodeURIComponent(tickers.join(','))}`);
        const quotesData = await quotesRes.json();

        if (!cancelled) {
          const map = {};
          (Array.isArray(quotesData) ? quotesData : []).forEach((quote) => {
            if (quote?.symbol) map[quote.symbol] = quote;
          });
          setQuotes(map);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || 'Failed to load FMP screener');
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    const seen = new Set();
    const out = [];

    news.forEach((item) => {
      (Array.isArray(item.tickers) ? item.tickers : []).forEach((ticker) => {
        if (seen.has(ticker)) return;
        seen.add(ticker);

        const quote = quotes[ticker];
        out.push({
          symbol: ticker,
          headline: item.headline,
          source: item.source,
          price: quote?.price,
          changePercent: quote?.changePercent,
          volume: quote?.volume,
          marketCap: quote?.marketCap,
          float: quote?.float,
        });
      });
    });

    return out;
  }, [news, quotes]);

  return (
    <div className="p-4">
      <h1 className="mb-3 text-xl font-semibold">Screener V3 (FMP-Only Canonical)</h1>
      {loading && <p>Loading…</p>}
      {error && <p className="text-red-500">{error}</p>}

      {!loading && !error && (
        <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-800">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-3 py-2 text-left">Symbol</th>
                <th className="px-3 py-2 text-left">Headline</th>
                <th className="px-3 py-2 text-left">Source</th>
                <th className="px-3 py-2 text-right">Price</th>
                <th className="px-3 py-2 text-right">Change %</th>
                <th className="px-3 py-2 text-right">Volume</th>
                <th className="px-3 py-2 text-right">Market Cap</th>
                <th className="px-3 py-2 text-right">Float</th>
              </tr>
            </thead>
            <tbody>
              {rows?.map((row) => (
                <tr key={row.symbol} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-3 py-2">{row.symbol}</td>
                  <td className="px-3 py-2">{row.headline}</td>
                  <td className="px-3 py-2">{row.source}</td>
                  <td className="px-3 py-2 text-right">{row.price ?? '-'}</td>
                  <td className="px-3 py-2 text-right">{row.changePercent ?? '-'}</td>
                  <td className="px-3 py-2 text-right">{row.volume ?? '-'}</td>
                  <td className="px-3 py-2 text-right">{row.marketCap ?? '-'}</td>
                  <td className="px-3 py-2 text-right">{row.float ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
