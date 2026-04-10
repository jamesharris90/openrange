const fs = require("fs");
const path = require("path");
const http = require("http");

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error(`Invalid JSON: ${err.message}`));
          }
        });
      })
      .on("error", reject);
  });
}

async function run() {
  const endpoint = process.env.SCREENER_ENDPOINT || "http://127.0.0.1:3007/api/screener?page=1&pageSize=5000";
  const outputPath = path.join(__dirname, "..", "..", "screener_endpoint_validation.json");

  const report = {
    timestamp: new Date().toISOString(),
    endpoint,
    checks: {
      count_gt_3000: false,
      all_rows_source_real: false,
    },
    metrics: {
      response_count: 0,
      row_count: 0,
      non_real_rows: 0,
    },
    pass: false,
    errors: [],
  };

  try {
    const payload = await fetchJson(endpoint);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const responseCount = Number(payload?.count || 0);

    const nonRealRows = rows.filter((row) => row?.source !== "real");

    report.metrics.response_count = responseCount;
    report.metrics.row_count = rows.length;
    report.metrics.non_real_rows = nonRealRows.length;

    report.checks.count_gt_3000 = responseCount > 3000;
    report.checks.all_rows_source_real = nonRealRows.length === 0;

    if (!report.checks.count_gt_3000) {
      report.errors.push(`count <= 3000 (got ${responseCount})`);
    }
    if (!report.checks.all_rows_source_real) {
      report.errors.push(`non-real rows detected (${nonRealRows.length})`);
    }

    report.pass = report.errors.length === 0;
  } catch (error) {
    report.errors.push(error.message || "Endpoint validation failed");
    report.pass = false;
  }

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  if (report.pass) {
    console.log("SCREENER UNIVERSE RESTORED — FULL DATA FLOW ACTIVE");
  } else {
    console.log("SCREENER STILL LIMITED — BACKEND CONTRACT BROKEN");
    process.exit(1);
  }
}

run();
