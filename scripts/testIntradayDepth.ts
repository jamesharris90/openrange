import fetch from "node-fetch";

const API_KEY = process.env.FMP_API_KEY;

if (!API_KEY) {
  console.error("❌ Missing FMP_API_KEY environment variable");
  process.exit(1);
}

const TEST_SYMBOLS = ["AAPL", "MSFT", "NVDA"];

function distinctTradingDays(rows: any[]) {
  const set = new Set(
    rows.map(r => r.date?.split(" ")[0])
  );
  return set.size;
}

function sortAsc(rows: any[]) {
  return rows.sort((a, b) =>
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );
}

async function testSymbol(symbol: string) {
  console.log("\n==================================================");
  console.log(`Testing symbol: ${symbol}`);
  console.log("==================================================");

  // Default request
  const url = `https://financialmodelingprep.com/api/v3/historical-chart/1min/${symbol}?apikey=${API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();

  if (!Array.isArray(data) || data.length === 0) {
    console.log("❌ No data returned from default endpoint");
    return;
  }

  const sorted = sortAsc(data);

  console.log("\nDEFAULT ENDPOINT:");
  console.log("Rows:", sorted.length);
  console.log("Earliest:", sorted[0].date);
  console.log("Latest:", sorted[sorted.length - 1].date);
  console.log("Distinct trading days:", distinctTradingDays(sorted));

  // 30-day range test
  const now = new Date();
  const fromDate = new Date();
  fromDate.setDate(now.getDate() - 30);

  const from = fromDate.toISOString().split("T")[0];
  const to = now.toISOString().split("T")[0];

  const rangedUrl = `https://financialmodelingprep.com/api/v3/historical-chart/1min/${symbol}?from=${from}&to=${to}&apikey=${API_KEY}`;
  const rangedRes = await fetch(rangedUrl);
  const rangedData = await rangedRes.json();

  if (!Array.isArray(rangedData) || rangedData.length === 0) {
    console.log("\n❌ Range endpoint returned no data");
    return;
  }

  const sortedRange = sortAsc(rangedData);

  console.log("\n30-DAY RANGE QUERY:");
  console.log("Rows:", sortedRange.length);
  console.log("Earliest:", sortedRange[0].date);
  console.log("Latest:", sortedRange[sortedRange.length - 1].date);
  console.log("Distinct trading days:", distinctTradingDays(sortedRange));
}

async function main() {
  for (const symbol of TEST_SYMBOLS) {
    await testSymbol(symbol);
  }
  console.log("\n✅ Intraday depth test complete.");
  process.exit(0);
}

main();
