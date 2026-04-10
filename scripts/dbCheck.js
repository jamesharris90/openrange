require("dotenv").config();
require("dotenv").config({ path: require("path").resolve(__dirname, "../server/.env") });
const { createClient } = require("@supabase/supabase-js");
const pool = require("../server/db/pool");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment.");
  process.exit(1);
}

const supabase = url && key ? createClient(url, key) : null;

async function runPgCheck(tables) {
  if (!process.env.DATABASE_URL) {
    return { ran: false, hadError: false };
  }
  let hadError = false;

  try {
    for (const table of tables) {
      console.log("\n====================");
      console.log("TABLE:", table);

      try {
        const exists = await pool.query("SELECT to_regclass($1) IS NOT NULL AS ok", [`public.${table}`]);
        const tableExists = Boolean(exists.rows?.[0]?.ok);

        if (!tableExists) {
          console.log("ROWS:", 0);
          console.log("INFO: table does not exist in public schema");
          continue;
        }

        const countRes = await pool.query(`SELECT COUNT(*)::int AS c FROM ${table}`);
        console.log("ROWS:", Number(countRes.rows?.[0]?.c || 0));
      } catch (error) {
        hadError = true;
        console.error("ERROR:", error.message);
      }
    }

    return { ran: true, hadError };
  } finally {
    await pool.end().catch(() => null);
  }
}

(async () => {
  const tables = [
    "trade_setups",
    "market_metrics",
    "news_articles",
    "earnings_events",
  ];

  const pgResult = await runPgCheck(tables);
  if (pgResult.ran) {
    process.exit(pgResult.hadError ? 1 : 0);
  }

  if (!supabase) {
    console.error("Missing DATABASE_URL and Supabase credentials.");
    process.exit(1);
  }

  let hadError = false;

  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .limit(5);

    console.log("\n====================");
    console.log("TABLE:", table);

    if (error) {
      hadError = true;
      console.error("ERROR:", error.message);
      continue;
    }

    const rows = Array.isArray(data) ? data.length : 0;
    console.log("ROWS:", rows);
  }

  process.exit(hadError ? 1 : 0);
})();
