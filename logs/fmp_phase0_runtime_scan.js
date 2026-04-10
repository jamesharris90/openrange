const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

require("dotenv").config({ path: path.resolve(__dirname, "../server/.env") });

const baseCandidates = ["http://localhost:3001", "http://localhost:3101", "http://localhost:3102"];
const headers = { "Content-Type": "application/json" };
if (process.env.PROXY_API_KEY) headers["x-api-key"] = process.env.PROXY_API_KEY;

function parseRows(body) {
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.rows)) return body.rows;
  if (Array.isArray(body?.results)) return body.results;
  if (Array.isArray(body)) return body;
  return [];
}

async function hit(base, route, method = "GET") {
  const url = `${base}${route}`;
  const started = Date.now();
  try {
    const res = await fetch(url, { method, headers });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }
    return {
      route,
      method,
      url,
      status: res.status,
      duration_ms: Date.now() - started,
      rows: parseRows(body).length,
      body_preview: typeof body === "object" ? JSON.stringify(body).slice(0, 400) : String(body).slice(0, 400)
    };
  } catch (error) {
    return {
      route,
      method,
      url,
      status: 0,
      duration_ms: Date.now() - started,
      rows: 0,
      error: error.message
    };
  }
}

function cmdSafe(command) {
  try {
    return execSync(command, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
  } catch (error) {
    return (error.stdout || "").toString().trim() || (error.stderr || "").toString().trim() || error.message;
  }
}

(async () => {
  const routes = [
    "/api/system/health",
    "/api/system/cron-status",
    "/api/stocks-in-play?limit=5",
    "/api/intelligence/top-opportunities?limit=5",
    "/api/earnings?limit=5",
    "/api/catalysts?limit=5",
    "/api/market/quotes?symbols=AAPL,MSFT,SPY"
  ];

  const scans = [];
  for (const base of baseCandidates) {
    const checks = [];
    for (const route of routes) {
      checks.push(await hit(base, route));
    }
    scans.push({ base, checks, ok_routes: checks.filter((c) => c.status >= 200 && c.status < 300).length });
  }

  const out = {
    generated_at: new Date().toISOString(),
    process_scan: {
      node_processes: cmdSafe("pgrep -af node || true"),
      listeners_3001: cmdSafe("lsof -nP -iTCP:3001 -sTCP:LISTEN || true"),
      listeners_3101: cmdSafe("lsof -nP -iTCP:3101 -sTCP:LISTEN || true"),
      listeners_3102: cmdSafe("lsof -nP -iTCP:3102 -sTCP:LISTEN || true")
    },
    api_scan: scans
  };

  fs.mkdirSync(path.resolve(__dirname), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, "fmp_foundation_runtime_scan.json"), JSON.stringify(out, null, 2));
  console.log("ok logs/fmp_foundation_runtime_scan.json");
})();
