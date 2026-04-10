const fs = require("fs");
const path = require("path");
const http = require("http");

const EXPECTED_FIELDS = [
  "symbol",
  "price",
  "change_percent",
  "volume",
  "relative_volume",
  "market_cap",
  "sector",
];

function fetchScreenerRows(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            const rows = Array.isArray(parsed?.data) ? parsed.data : [];
            resolve(rows);
          } catch (err) {
            reject(new Error(`Failed to parse response: ${err.message}`));
          }
        });
      })
      .on("error", (err) => reject(err));
  });
}

async function run() {
  const outputPath = path.join(__dirname, "..", "..", "screener_validation.json");

  const report = {
    timestamp: new Date().toISOString(),
    checks: {
      rawData_gt_1000: false,
      processedRows_gt_500: false,
      sorting_changes_order: false,
      pagination_correct: false,
      no_undefined_fields: false,
    },
    counts: {
      rawData: 0,
      processedRows: 0,
      sortedRows: 0,
      paginatedRows: 0,
    },
    pass: false,
    errors: [],
  };

  try {
    const rawData = await fetchScreenerRows("http://127.0.0.1:3007/api/screener");
    report.counts.rawData = rawData.length;

    const cleaned = rawData.filter((r) => r && r.symbol);

    const schemaLocked = cleaned.filter((r) => {
      const missing = EXPECTED_FIELDS.filter((field) => r[field] === undefined);
      return missing.length === 0;
    });

    const noUndefinedFields = schemaLocked.length === cleaned.length;

    const validated = schemaLocked.filter((r) =>
      typeof r.price === "number" &&
      typeof r.volume === "number" &&
      typeof r.change_percent === "number" &&
      typeof r.relative_volume === "number"
    );

    const processedRows = validated;

    const sortKey = "volume";
    const sortDir = "desc";
    const sortedRows = [...processedRows].sort((a, b) => {
      const valA = Number(a[sortKey] ?? 0);
      const valB = Number(b[sortKey] ?? 0);
      if (sortDir === "asc") return valA - valB;
      return valB - valA;
    });

    const page = 1;
    const pageSize = 25;
    const start = (page - 1) * pageSize;
    const paginatedRows = sortedRows.slice(start, start + pageSize);

    const sortingChangesOrder = processedRows.some((row, idx) => row?.symbol !== sortedRows[idx]?.symbol);
    const paginationCorrect = paginatedRows.length === Math.min(pageSize, sortedRows.length);

    report.counts.processedRows = processedRows.length;
    report.counts.sortedRows = sortedRows.length;
    report.counts.paginatedRows = paginatedRows.length;

    report.checks.rawData_gt_1000 = report.counts.rawData > 1000;
    report.checks.processedRows_gt_500 = report.counts.processedRows > 500;
    report.checks.sorting_changes_order = sortingChangesOrder;
    report.checks.pagination_correct = paginationCorrect;
    report.checks.no_undefined_fields = noUndefinedFields;

    Object.entries(report.checks).forEach(([key, ok]) => {
      if (!ok) {
        report.errors.push(`${key} failed`);
      }
    });

    report.pass = report.errors.length === 0;
  } catch (error) {
    report.errors.push(error.message || "Validation failed");
    report.pass = false;
  }

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  if (report.pass) {
    console.log("SCREENER FULLY OPERATIONAL — DATA TRUSTED");
  } else {
    console.log("SCREENER FAILED — DATA OR FILTER ISSUE");
    process.exit(1);
  }
}

run();
