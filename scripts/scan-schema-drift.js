const fs = require("fs");
const path = require("path");

const root = process.cwd();

function scan(dir) {
  let results = [];
  fs.readdirSync(dir).forEach((file) => {
    const full = path.join(dir, file);

    if (fs.statSync(full).isDirectory()) {
      if (["node_modules", ".git", ".venv", "dist", "build"].includes(file)) {
        return;
      }
      results.push(...scan(full));
    } else {
      if (file.endsWith(".js") || file.endsWith(".ts")) {
        const text = fs.readFileSync(full, "utf8");
        const matches = text.match(/from\(["'](.*?)["']\)/g);

        if (matches) {
          matches.forEach((m) => {
            results.push({
              file: full,
              query: m,
            });
          });
        }
      }
    }
  });

  return results;
}

const report = scan(root);

fs.mkdirSync("system_reports", { recursive: true });
fs.writeFileSync("system_reports/schema_drift_report.json", JSON.stringify(report, null, 2));

console.log("Schema drift report generated");
