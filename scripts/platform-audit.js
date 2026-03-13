const fs = require('fs');
const path = require('path');

async function probe(url) {
  try {
    const res = await fetch(url);
    const text = await res.text();
    return { ok: res.ok, status: res.status, body_preview: text.slice(0, 180) };
  } catch (error) {
    return { ok: false, status: 0, error: error.message };
  }
}

async function main() {
  const checks = {
    routes: await probe('http://localhost:3000/api/system/platform-health'),
    provider_connectivity: await probe('http://localhost:3000/api/system/provider-health'),
    data_freshness: await probe('http://localhost:3000/api/system/data-health'),
    chart_rendering: await probe('http://localhost:5173/charts'),
    filters: await probe('http://localhost:5173/screener'),
    email_sending: await probe('http://localhost:3000/api/system/email-health'),
  };

  const report = {
    generated_at: new Date().toISOString(),
    checks,
  };

  const output = path.resolve(__dirname, '../platform-audit-report.json');
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log('Platform audit report generated:', output);
}

main().catch((error) => {
  console.error('Platform audit failed:', error.message);
  process.exit(1);
});
