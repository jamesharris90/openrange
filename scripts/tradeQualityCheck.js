require("dotenv").config();
require("dotenv").config({ path: require("path").resolve(__dirname, "../server/.env") });
const fs = require("fs");

const auditPath = "./logs/trade_output_audit.json";
if (!fs.existsSync(auditPath)) {
  console.log("\nTRADE PIPELINE BROKEN");
  console.log("ISSUES:");
  console.log(`- Missing audit file: ${auditPath}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(auditPath, "utf8"));
let issues = [];

for (const d of data) {
  if (!d.ok || (typeof d.status === "number" && d.status !== 200)) {
    issues.push(`NON-200 OR ERROR: ${d.endpoint} status=${d.status ?? "n/a"} error=${d.error ?? "none"}`);
  }

  if ((d.count || 0) === 0) {
    issues.push(`ZERO DATA: ${d.endpoint}`);
  }

  for (const t of d.sample || []) {
    if (!t.symbol) issues.push(`Missing symbol: ${d.endpoint}`);
    if (!t.why || String(t.why).trim().length === 0) issues.push(`Missing WHY for ${t.symbol || "unknown"} from ${d.endpoint}`);
    if (!t.how || String(t.how).trim().length === 0) issues.push(`Missing HOW for ${t.symbol || "unknown"} from ${d.endpoint}`);
  }
}

if (issues.length === 0) {
  console.log("\nTRADE PIPELINE VALID - SYSTEM LIVE");
  process.exit(0);
}

console.log("\nTRADE PIPELINE BROKEN");
console.log("ISSUES:");
issues.forEach((i) => console.log("-", i));
process.exit(1);
