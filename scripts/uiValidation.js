#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const BASE_URL = process.env.UI_VALIDATION_BASE_URL || "http://localhost:4000";
const NOW = new Date().toISOString();
const STALE_MS = 15 * 60 * 1000;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

async function getJson(endpoint) {
  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    return {
      endpoint,
      ok: response.ok,
      status: response.status,
      payload,
      error: null,
    };
  } catch (error) {
    return {
      endpoint,
      ok: false,
      status: 0,
      payload: null,
      error: String(error?.message || error),
    };
  }
}

function pickOpportunitySymbol(opportunitiesResult) {
  const rows = Array.isArray(opportunitiesResult?.payload?.data) ? opportunitiesResult.payload.data : [];
  const live = rows.find((row) => {
    const symbol = String(row.symbol || "").trim();
    const ts = Date.parse(String(row.updated_at || row.created_at || ""));
    return symbol.length > 0 && Number.isFinite(ts) && Date.now() - ts <= STALE_MS;
  });
  return String(live?.symbol || rows[0]?.symbol || "").toUpperCase();
}

function precheckRows(payload, pathLabel) {
  if (!payload || !Array.isArray(payload.data)) {
    return { pass: false, path: pathLabel, message: "data array missing" };
  }

  return {
    pass: payload.data.length > 0,
    path: pathLabel,
    rowCount: payload.data.length,
    message: payload.data.length > 0 ? "ok" : "zero_rows",
  };
}

function assertNoStaticSymbols(textBlob) {
  const banned = ["AAPL", "NVDA", "TSLA"];
  const found = banned.filter((symbol) => textBlob.includes(symbol));
  return {
    pass: found.length === 0,
    found,
  };
}

async function run() {
  const logsDir = path.join(process.cwd(), "logs");
  ensureDir(logsDir);

  const opportunity = await getJson("/api/intelligence/top-opportunities?limit=40");
  const overview = await getJson("/api/market/overview");
  const screener = await getJson("/api/screener?limit=20");
  const topOpportunities = await getJson("/api/intelligence/top-opportunities?limit=20");
  const earnings = await getJson("/api/earnings?limit=20");

  const symbol = pickOpportunitySymbol(opportunity);
  const decision = symbol
    ? await getJson(`/api/intelligence/decision/${encodeURIComponent(symbol)}`)
    : { endpoint: "/api/intelligence/decision/:symbol", ok: false, status: 0, payload: null };

  const quotesSymbols = [];
  const indexKeys = Object.keys(overview?.payload?.indices || {}).slice(0, 3);
  quotesSymbols.push(...indexKeys);
  if (symbol) quotesSymbols.push(symbol);
  const uniqueSymbols = Array.from(new Set(quotesSymbols)).filter(Boolean);

  const quotes = uniqueSymbols.length
    ? await getJson(`/api/market/quotes?symbols=${encodeURIComponent(uniqueSymbols.join(","))}`)
    : { endpoint: "/api/market/quotes?symbols=<empty>", ok: false, status: 0, payload: null };

  const prechecks = [
    precheckRows(opportunity.payload, "top-opportunities"),
    precheckRows(quotes.payload, "market-quotes"),
    {
      pass: Boolean(overview.payload && typeof overview.payload === "object" && overview.payload.indices),
      path: "market-overview",
      message: "indices object required",
    },
  ];

  const endpointChecks = [screener, topOpportunities, overview, earnings, quotes, decision].map((item) => ({
    endpoint: item.endpoint,
    status: item.status,
    ok: item.ok,
    error: item.error || null,
  }));

  const staleRows = (Array.isArray(opportunity.payload?.data) ? opportunity.payload.data : []).filter((row) => {
    const ts = Date.parse(String(row.updated_at || row.created_at || ""));
    return !Number.isFinite(ts) || Date.now() - ts > STALE_MS;
  }).length;

  const staticScan = assertNoStaticSymbols(
    JSON.stringify({
      opportunities: opportunity.payload,
      overview: overview.payload,
      quotes: quotes.payload,
      decision: decision.payload,
    })
  );

  const allEndpointsOk = endpointChecks.every((item) => item.ok && item.status === 200);
  const allPrechecksOk = prechecks.every((item) => item.pass);
  const stalePass = staleRows === 0;

  const report = {
    generated_at: NOW,
    base_url: BASE_URL,
    checks: {
      precheck: {
        pass: allPrechecksOk,
        details: prechecks,
      },
      endpoints: {
        pass: allEndpointsOk,
        details: endpointChecks,
      },
      stale_data: {
        pass: stalePass,
        stale_rows: staleRows,
        threshold_minutes: 15,
      },
      static_ticker_scan: staticScan,
    },
    selected_symbol_for_decision: symbol || null,
  };

  const finalPass = allPrechecksOk && allEndpointsOk && stalePass && staticScan.pass;
  const buildValidation = {
    generated_at: NOW,
    pass: finalPass,
    summary: finalPass ? "BUILD VALIDATED - SAFE TO DEPLOY" : "BUILD FAILED - FIX REQUIRED",
  };

  writeJson(path.join(logsDir, "precheck_validation.json"), {
    generated_at: NOW,
    pass: allPrechecksOk,
    details: prechecks,
  });
  writeJson(path.join(logsDir, "endpoint_validation.json"), {
    generated_at: NOW,
    pass: allEndpointsOk,
    details: endpointChecks,
  });
  writeJson(path.join(logsDir, "build_validation_report.json"), buildValidation);

  writeJson(path.join(process.cwd(), "ui_system_report.json"), report);

  process.stdout.write(`${buildValidation.summary}\n`);
  if (!finalPass) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  process.stdout.write("BUILD FAILED - FIX REQUIRED\n");
  process.stderr.write(`${String(error?.stack || error)}\n`);
  process.exitCode = 1;
});
