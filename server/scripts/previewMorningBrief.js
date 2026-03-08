const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { runMorningBrief } = require('../engines/morningBriefEngine');

function buildPreview(briefing) {
  const market = Array.isArray(briefing.market) ? briefing.market : [];
  const news = Array.isArray(briefing.news) ? briefing.news : [];
  const signals = Array.isArray(briefing.signals) ? briefing.signals : [];
  const narrative = briefing.narrative || {};

  const geopoliticalNews = news
    .filter((item) => /(war|iran|israel|china|russia|sanction|oil|fed|geopolit)/i.test(String(item.headline || '')))
    .slice(0, 5);

  const sectorNews = news
    .filter((item) => /(sector|tech|energy|financial|healthcare|semiconductor|biotech)/i.test(String(item.headline || '')))
    .slice(0, 5);

  const earningsToday = news
    .filter((item) => /(earnings|guidance|eps|revenue|beat|miss)/i.test(String(item.headline || '')))
    .slice(0, 5);

  const topCatalysts = narrative.catalysts || news.map((n) => n.headline).slice(0, 5);
  const top5Stocks = (narrative.watchlist || signals.map((s) => s.symbol)).filter(Boolean).slice(0, 5);

  const bestSetup = signals.length
    ? {
        symbol: signals[0].symbol || null,
        strategy: signals[0].strategy || null,
        score: signals[0].score || null,
      }
    : null;

  return {
    generated_at: briefing.createdAt || new Date().toISOString(),
    market_overview: narrative.overview || 'No market overview generated.',
    geopolitical_news: geopoliticalNews,
    sector_news: sectorNews,
    top_catalysts: topCatalysts,
    top_5_stocks_to_watch: top5Stocks,
    earnings_today: earningsToday,
    best_setup: bestSetup,
    raw: briefing,
  };
}

async function run() {
  const briefing = await runMorningBrief({ sendEmail: false });
  const preview = buildPreview(briefing);

  console.log('[PREVIEW] Morning briefing generated');
  console.log(JSON.stringify(preview, null, 2));

  const outPath = '/tmp/openrange_brief_preview.json';
  fs.writeFileSync(outPath, JSON.stringify(preview, null, 2), 'utf8');
  console.log(`[PREVIEW] saved to ${outPath}`);
}

run().catch((error) => {
  console.error('[PREVIEW] failed:', error.message);
  process.exit(1);
});
