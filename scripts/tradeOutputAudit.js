require("dotenv").config();
require("dotenv").config({ path: require("path").resolve(__dirname, "../server/.env") });
const fs = require("fs");

const fetchImpl = global.fetch
  ? global.fetch.bind(global)
  : (...args) => import("node-fetch").then((m) => m.default(...args));

const endpoints = [
  "http://localhost:3001/api/stocks-in-play",
  "http://localhost:3001/api/intelligence/top-opportunities",
  "http://localhost:3001/api/catalysts",
  "http://localhost:3001/api/earnings",
];

function extractData(json) {
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.rows)) return json.rows;
  if (Array.isArray(json?.results)) return json.results;
  if (Array.isArray(json)) return json;
  return [];
}

function normalizeTrade(item) {
  return {
    symbol: item?.symbol ?? null,
    why: item?.why ?? item?.why_moving ?? item?.headline ?? null,
    how: item?.how ?? item?.how_to_trade ?? item?.execution_plan ?? null,
    source: item?.source ?? item?.raw?.source ?? null,
    raw: item,
  };
}

(async () => {
  fs.mkdirSync("./logs", { recursive: true });

  const headers = {};
  if (process.env.PROXY_API_KEY) {
    headers["x-api-key"] = process.env.PROXY_API_KEY;
  }

  const results = [];

  for (const url of endpoints) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 180000);
      const res = await fetchImpl(url, { headers, signal: controller.signal });
      clearTimeout(timeout);
      const text = await res.text();
      let json;

      try {
        json = JSON.parse(text);
      } catch (parseError) {
        throw new Error(`non-json response: ${parseError.message}`);
      }

      const data = extractData(json);
      const count = Array.isArray(data) ? data.length : 0;
      const sample = data.slice(0, 3).map(normalizeTrade);

      const row = {
        endpoint: url,
        status: res.status,
        ok: res.ok,
        count,
        sample,
      };

      results.push(row);

      console.log("\n====================");
      console.log("ENDPOINT:", url);
      console.log("STATUS:", res.status);
      console.log("COUNT:", count);
      console.log("SAMPLE:", sample);

      if (!res.ok) {
        console.error("ERROR: non-200 status", url, res.status);
      }
    } catch (err) {
      console.error("ERROR:", url, err.message);

      results.push({
        endpoint: url,
        status: 0,
        ok: false,
        error: err.message,
      });
    }
  }

  fs.writeFileSync("./logs/trade_output_audit.json", JSON.stringify(results, null, 2));
  console.log("\nAudit saved -> logs/trade_output_audit.json");
})();
