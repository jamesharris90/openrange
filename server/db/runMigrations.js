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
}

module.exports = runMigrations;
