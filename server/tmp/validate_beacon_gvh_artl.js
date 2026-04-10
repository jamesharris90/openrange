const { generateBeaconMorningPayload } = require('../email/beaconMorningBrief');

async function main() {
  const payload = await generateBeaconMorningPayload({ limit: 5 });
  const rows = [payload.stockOfDay, ...(payload.secondaryOpportunities || [])]
    .filter(Boolean)
    .filter((row) => ['GVH', 'ARTL'].includes(String(row.symbol || '').toUpperCase()))
    .map((row) => ({
      symbol: row.symbol,
      price: row.price,
      move: row.move,
      price_change_percent: row.price_change_percent,
      rvol: row.rvol,
      relative_volume: row.relative_volume,
      setupType: row.setupType,
      confidence: row.confidence,
      tradeScore: row.tradeScore,
    }));
  console.log(JSON.stringify({ mode: payload.mode, rows }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
