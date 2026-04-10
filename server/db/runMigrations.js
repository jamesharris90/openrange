const fs = require("fs");
const path = require("path");
const pool = require("./pool");

async function runMigrations() {
  const migrationsDir = path.join(__dirname, "migrations");

  if (!fs.existsSync(migrationsDir)) {
    console.log("No migrations folder found");
    return;
  }

  const files = fs.readdirSync(migrationsDir).sort();
  let timeoutDisabled = false;
  const failures = [];

  try {
    await pool.query("SET statement_timeout = 0");
    timeoutDisabled = true;

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file)).toString();

      try {
        console.log(`[Migration] Running: ${file}`);
        await pool.query(sql);
        console.log(`[Migration] Completed: ${file}`);
      } catch (err) {
        failures.push({ file, error: err.message });
        console.error("[Migration] failed, continuing startup in degraded mode:", file, err.message);
      }
    }
  } catch (err) {
    failures.push({ file: 'bootstrap', error: err.message });
    console.error("[Migration] bootstrap failed, continuing startup in degraded mode:", err.message);
  } finally {
    if (timeoutDisabled) {
      try {
        await pool.query("SET statement_timeout = 5000");
      } catch (err) {
        console.error("[Migration] Failed to restore statement timeout", err);
      }
    }
  }

  if (failures.length) {
    console.warn('[Migration] completed with failures', { failures });
  }
}

module.exports = runMigrations;
