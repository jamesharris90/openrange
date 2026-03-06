const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function runMigrations() {
  const migrationsDir = path.join(__dirname, "migrations");

  if (!fs.existsSync(migrationsDir)) {
    console.log("No migrations folder found");
    return;
  }

  const files = fs.readdirSync(migrationsDir).sort();
  let timeoutDisabled = false;

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
        console.error(`[Migration] Failed: ${file}`, err);
      }
    }
  } catch (err) {
    console.error("[Migration] Runner failure", err);
  } finally {
    if (timeoutDisabled) {
      try {
        await pool.query("SET statement_timeout = 5000");
      } catch (err) {
        console.error("[Migration] Failed to restore statement timeout", err);
      }
    }
  }
}

module.exports = runMigrations;
