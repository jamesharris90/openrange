#!/usr/bin/env node

/*
  Validates that focus symbols are always contained in all-mode symbols.
*/

const BASE_URL = process.env.SCREENER_BASE_URL || 'http://localhost:3007';

async function getJson(path) {
  const response = await fetch(`${BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${path}`);
  }
  return response.json();
}

async function main() {
  const allPayload = await getJson('/api/screener?mode=all&page=1&pageSize=5000');
  const focusPayload = await getJson('/api/screener?mode=focus&page=1&pageSize=50');

  const allRows = Array.isArray(allPayload?.data) ? allPayload.data : [];
  const focusRows = Array.isArray(focusPayload?.data) ? focusPayload.data : [];

  const allSymbols = new Set(
    allRows
      .map((row) => String(row?.symbol || '').toUpperCase().trim())
      .filter(Boolean)
  );

  const focusSymbols = focusRows
    .map((row) => String(row?.symbol || '').toUpperCase().trim())
    .filter(Boolean);

  const missingFocusSymbolsInAll = focusSymbols.filter((symbol) => !allSymbols.has(symbol));

  const report = {
    all_count: Number(allPayload?.count || allRows.length || 0),
    focus_count: Number(focusPayload?.count || focusRows.length || 0),
    missing_focus_symbols_in_all: missingFocusSymbolsInAll,
    pass: missingFocusSymbolsInAll.length === 0,
  };

  console.log(JSON.stringify(report, null, 2));

  if (!report.pass) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        all_count: 0,
        focus_count: 0,
        missing_focus_symbols_in_all: [],
        pass: false,
        error: error.message,
      },
      null,
      2
    )
  );
  process.exit(1);
});
