const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { queryWithTimeout } = require("../db/pg");

async function run() {
  const outputPath = path.join(__dirname, "..", "..", "screener_data_audit.json");

  const result = {
    timestamp: new Date().toISOString(),
    counts: {
      market_metrics_real: 0,
      tradable_universe_real: 0,
      market_metrics_price_gt_1: 0,
    },
    thresholds: {
      market_metrics_real_min: 1000,
      tradable_universe_real_min: 3000,
    },
    pass: false,
    errors: [],
  };

  try {
    const marketMetricsReal = await queryWithTimeout(
      "SELECT COUNT(*)::int AS count FROM market_metrics WHERE source = 'real'",
      [],
      { label: "audit.market_metrics.real", timeoutMs: 20000, maxRetries: 0 }
    );

    const tradableUniverseReal = await queryWithTimeout(
      "SELECT COUNT(*)::int AS count FROM tradable_universe WHERE source = 'real'",
      [],
      { label: "audit.tradable_universe.real", timeoutMs: 20000, maxRetries: 0 }
    );

    const marketMetricsPriceGt1 = await queryWithTimeout(
      "SELECT COUNT(*)::int AS count FROM market_metrics WHERE price > 1",
      [],
      { label: "audit.market_metrics.price_gt_1", timeoutMs: 20000, maxRetries: 0 }
    );

    result.counts.market_metrics_real = Number(marketMetricsReal.rows[0]?.count || 0);
    result.counts.tradable_universe_real = Number(tradableUniverseReal.rows[0]?.count || 0);
    result.counts.market_metrics_price_gt_1 = Number(marketMetricsPriceGt1.rows[0]?.count || 0);

    if (result.counts.market_metrics_real <= result.thresholds.market_metrics_real_min) {
      result.errors.push("market_metrics real count must be > 1000");
    }

    if (result.counts.tradable_universe_real <= result.thresholds.tradable_universe_real_min) {
      result.errors.push("tradable_universe real count must be > 3000");
    }

    result.pass = result.errors.length === 0;
  } catch (error) {
    result.errors.push(error.message || "Audit failed");
    result.pass = false;
  }

  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

  if (!result.pass) {
    console.log("DATA PIPELINE ISSUE");
    process.exit(1);
  }

  console.log("SCREENER DATA AUDIT PASS");
}

run();
