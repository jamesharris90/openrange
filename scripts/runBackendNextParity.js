/* eslint-disable no-console */

const dotenv = require("dotenv");
dotenv.config({ path: "server/.env" });

const API_KEY = process.env.PROXY_API_KEY || "";
const BACKEND_BASE = "http://localhost:3001";
const NEXT_BASE = "http://localhost:3000";

async function get(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      ...(API_KEY ? { "x-api-key": API_KEY } : {}),
    },
    signal: AbortSignal.timeout(8000),
  });

  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

async function run() {
  const checks = [];
  const paths = [
    "/api/earnings?limit=3",
    "/api/news?symbol=AAPL&limit=3",
    "/api/ipos?symbol=AVTM&limit=3",
    "/api/splits?symbol=TR&limit=3",
  ];

  for (const path of paths) {
    const backend = await get(`${BACKEND_BASE}${path}`);
    const next = await get(`${NEXT_BASE}${path}`);

    const backendRows = Array.isArray(backend.json?.data) ? backend.json.data : [];
    const nextRows = Array.isArray(next.json?.data) ? next.json.data : [];

    checks.push({
      path,
      backendStatus: backend.status,
      nextStatus: next.status,
      backendRows: backendRows.length,
      nextRows: nextRows.length,
      topSymbolBackend: backendRows[0]?.symbol || null,
      topSymbolNext: nextRows[0]?.symbol || null,
      pass:
        backend.status === 200
        && next.status === 200
        && backendRows.length > 0
        && nextRows.length > 0
        && (backendRows[0]?.symbol || null) === (nextRows[0]?.symbol || null),
    });
  }

  const result = {
    ok: checks.every((check) => check.pass),
    checks,
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 2;
  }
}

run().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
