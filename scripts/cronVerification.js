require("dotenv").config();
require("dotenv").config({ path: require("path").resolve(__dirname, "../server/.env") });
const fs = require("fs");

const base = "http://localhost:3001";
const headers = { "Content-Type": "application/json" };
if (process.env.PROXY_API_KEY) headers["x-api-key"] = process.env.PROXY_API_KEY;

async function fetchWithTimeout(url, options = {}, timeoutMs = 90000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

(async () => {
  fs.mkdirSync("./logs", { recursive: true });

  let runRes;
  let runBody = {};
  try {
    runRes = await fetchWithTimeout(`${base}/api/cron/run-all`, {
      method: "POST",
      headers,
    });
    runBody = await runRes.json().catch(() => ({}));
  } catch (error) {
    runRes = { status: 0 };
    runBody = { error: error.message };
  }

  await new Promise((resolve) => setTimeout(resolve, 3500));

  const statusRes = await fetchWithTimeout(`${base}/api/system/cron-status`, { headers });
  const statusBody = await statusRes.json().catch(() => ({}));

  const events = Array.isArray(statusBody.recent_runs) ? statusBody.recent_runs : [];
  const successEvents = events.filter((event) => event?.event === "ENGINE_SUCCESS");

  const successByEngine = {};
  for (const event of successEvents) {
    const engine = event?.payload?.engine;
    if (engine) successByEngine[engine] = event.payload;
  }

  const requiredEngines = ["stocks-in-play", "catalyst", "earnings", "intelligence"];
  const requiredCounts = Object.fromEntries(
    requiredEngines.map((name) => [name, Number(successByEngine[name]?.count || 0)])
  );

  const positiveCountEngines = Object.values(requiredCounts).filter((count) => count > 0).length;

  const output = {
    generated_at: new Date().toISOString(),
    run_all: {
      status: runRes.status,
      body: runBody,
    },
    cron_status: {
      status: statusRes.status,
      recent_runs: events.slice(-30),
    },
    verification: {
      engine_success_present_for_required: requiredEngines.every((name) => Boolean(successByEngine[name])),
      required_engine_counts: requiredCounts,
      at_least_two_engines_count_gt_zero: positiveCountEngines >= 2,
    },
  };

  fs.writeFileSync("./logs/cron_verification.json", JSON.stringify(output, null, 2));

  console.log(JSON.stringify(output.verification, null, 2));

  if (
    !output.verification.engine_success_present_for_required ||
    !output.verification.at_least_two_engines_count_gt_zero
  ) {
    process.exit(1);
  }
})();
