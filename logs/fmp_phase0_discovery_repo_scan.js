const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function walk(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", ".next", "dist", "build"].includes(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(walk(p));
    else out.push(p);
  }
  return out;
}

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

const serverDir = path.join(root, "server");
const frontendDir = path.join(root, "trading-os", "src");
const serverFilesAbs = walk(serverDir);
const frontendFilesAbs = walk(frontendDir);
const serverFiles = serverFilesAbs.map((p) => path.relative(root, p));
const frontendFiles = frontendFilesAbs.map((p) => path.relative(root, p));

const pick = (arr, re) => arr.filter((f) => re.test(f));

const frontPages = [
  "dashboard",
  "stocks-in-play",
  "trading-terminal",
  "research",
  "catalyst-scanner",
  "earnings",
  "alerts",
  "heat-map",
  "markets"
];

const pageMap = {};
for (const page of frontPages) {
  const pageRel = `trading-os/src/app/${page}/page.tsx`;
  const pageAbs = path.join(root, pageRel);
  const content = safeRead(pageAbs);
  const imports = Array.from(content.matchAll(/from\s+["']([^"']+)["']/g)).map((m) => m[1]);
  const inlineApiRefs = Array.from(content.matchAll(/\/api\/[A-Za-z0-9_\-/?=&]+/g)).map((m) => m[0]);

  pageMap[page] = {
    page_file: fs.existsSync(pageAbs) ? pageRel : null,
    imports,
    inline_api_refs: [...new Set(inlineApiRefs)]
  };
}

const out = {
  generated_at: new Date().toISOString(),
  backend_entrypoint: fs.existsSync(path.join(root, "server", "index.js")) ? "server/index.js" : null,
  scheduler_entrypoints: pick(serverFiles, /(scheduler|cron|run-all|dailyReviewCron|stream_scheduler|metrics_scheduler)/i),
  ingestion_engines: pick(serverFiles, /(server\/ingestion\/|fmp.*ingest|marketIngestion|extended_hours_ingest)/i),
  strategy_engines: pick(serverFiles, /(strategy|signal|opportunity|stocksInPlayEngine|finalTradeBuilder)/i),
  intelligence_routes: pick(serverFiles, /server\/routes\/(intelligence|intel|strategyIntelligence|radar|signals)/i),
  earnings_routes: pick(serverFiles, /server\/routes\/earnings|earnings/i),
  catalyst_news_routes: pick(serverFiles, /server\/routes\/(news|catalyst)/i),
  market_quote_routes: pick(serverFiles, /server\/routes\/(market|trades)|server\/modules\/marketData\/marketDataRoutes/i),
  db_connection_layer: pick(serverFiles, /server\/(db\/(pg|pool|connectionConfig)|pg\.js|system\/supabaseClient\.js)/i),
  migration_system: {
    primary: pick(serverFiles, /server\/db\/(migrate\.js|migrations\/)/i),
    legacy_or_aux: pick(serverFiles, /server\/migrations\//i)
  },
  frontend_fetch_routes: pageMap,
  frontend_api_proxy_routes: pick(frontendFiles, /trading-os\/src\/app\/api\//i)
};

fs.mkdirSync(path.join(root, "logs"), { recursive: true });
fs.writeFileSync(path.join(root, "logs", "fmp_foundation_repo_scan.json"), JSON.stringify(out, null, 2));
console.log("ok logs/fmp_foundation_repo_scan.json");
