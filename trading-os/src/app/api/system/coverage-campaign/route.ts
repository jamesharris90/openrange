import { promises as fs } from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { API_BASE } from "@/lib/apiBase";

type JsonValue = string | number | boolean | null | JsonRecord | JsonValue[];
type JsonRecord = { [key: string]: JsonValue | undefined };

const BACKFILL_DIR_CANDIDATES = [
  process.env.COVERAGE_CAMPAIGN_BACKFILL_DIR,
  path.resolve(process.cwd(), "../server/logs/backfill"),
  path.resolve(process.cwd(), "server/logs/backfill"),
  path.resolve(process.cwd(), "../logs/backfill"),
].filter((value): value is string => Boolean(value && value.trim()));

let serverEnvCache: Record<string, string> | null = null;

function buildBackfillPaths(backfillDir: string) {
  return {
    backfillDir,
    statusPath: path.join(backfillDir, "coverage_completion_campaign_status.json"),
    checkpointPath: path.join(backfillDir, "coverage_completion_campaign_checkpoint.json"),
    hourlyPath: path.join(backfillDir, "coverage_completion_campaign_hourly.jsonl"),
    stdoutPath: path.join(backfillDir, "coverage_completion_campaign.stdout.log"),
  };
}

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveBackfillPaths() {
  for (const candidate of BACKFILL_DIR_CANDIDATES) {
    const paths = buildBackfillPaths(candidate);
    if (await pathExists(paths.statusPath)) {
      return paths;
    }
  }

  return buildBackfillPaths(BACKFILL_DIR_CANDIDATES[0] || path.resolve(process.cwd(), "../server/logs/backfill"));
}

function parseDotEnv(content: string) {
  const values: Record<string, string> = {};

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

async function readAdjacentServerEnv() {
  if (serverEnvCache) {
    return serverEnvCache;
  }

  const candidates = [
    path.resolve(process.cwd(), "../server/.env"),
    path.resolve(process.cwd(), "server/.env"),
  ];

  for (const candidate of candidates) {
    try {
      const content = await fs.readFile(candidate, "utf8");
      serverEnvCache = parseDotEnv(content);
      return serverEnvCache;
    } catch {
      continue;
    }
  }

  serverEnvCache = {};
  return serverEnvCache;
}

function asJsonRecord(value: unknown): JsonRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

async function readJsonFile(filePath: string): Promise<JsonRecord | null> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return asJsonRecord(JSON.parse(content));
  } catch {
    return null;
  }
}

async function readFileStats(filePath: string) {
  try {
    const stats = await fs.stat(filePath);
    return {
      exists: true,
      updatedAt: stats.mtime.toISOString(),
      sizeBytes: stats.size,
    };
  } catch {
    return {
      exists: false,
      updatedAt: null,
      sizeBytes: 0,
    };
  }
}

async function readJsonLinesTail(filePath: string, limit = 12): Promise<JsonRecord[]> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-limit)
      .map((line) => {
        try {
          return asJsonRecord(JSON.parse(line)) ?? { raw: line };
        } catch {
          return { raw: line };
        }
      });
  } catch {
    return [];
  }
}

async function readJsonLines(filePath: string): Promise<JsonRecord[]> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return asJsonRecord(JSON.parse(line)) ?? { raw: line };
        } catch {
          return { raw: line };
        }
      });
  } catch {
    return [];
  }
}

async function readTextTail(filePath: string, limit = 40) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return content
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .slice(-limit);
  } catch {
    return [];
  }
}

async function readBackendCoverageCampaign() {
  const target = `${API_BASE}/api/system/coverage-campaign`;
  try {
    const response = await fetch(target, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    return asJsonRecord(payload);
  } catch {
    return null;
  }
}

function hasUsableCoveragePayload(payload: JsonRecord | null) {
  if (!payload || payload.success !== true) {
    return false;
  }

  const status = asJsonRecord(payload.status);
  const checkpoint = asJsonRecord(payload.checkpoint);
  const hourly = payload.hourly;

  const backendExplicitlyFailed = Boolean(
    status && (
      status.status === "failed"
      || typeof status.error === "string"
    )
  );

  if (backendExplicitlyFailed) {
    return false;
  }

  const hasLiveStatus = Boolean(
    status && (
      typeof status.phase === "string"
      || typeof status.missing_news_count === "number"
      || typeof status.missing_earnings_count === "number"
      || typeof status.resolved_news_symbols === "number"
      || typeof status.in_progress === "boolean"
      || typeof status.completed === "boolean"
    )
  );

  const hasCheckpointProgress = Boolean(
    checkpoint && (
      Array.isArray(asJsonRecord(checkpoint.news)?.attempted_symbols)
      || Array.isArray(asJsonRecord(checkpoint.news)?.resolved_symbols)
      || asJsonRecord(checkpoint.earnings)?.summary
    )
  );

  return Boolean(
    hasLiveStatus
    || hasCheckpointProgress
    || (Array.isArray(hourly) && hourly.length > 0)
  );
}

async function readSharedCoverageCampaign() {
  const serverEnv = await readAdjacentServerEnv();
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || serverEnv.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || serverEnv.SUPABASE_SERVICE_ROLE_KEY || serverEnv.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data, error } = await supabase
    .from("coverage_campaign_state")
    .select("state_key, payload, updated_at")
    .in("state_key", ["status", "checkpoint", "hourly"]);

  if (error || !data?.length) {
    return null;
  }

  const stateMap = new Map(data.map((row) => [String(row.state_key), row]));
  const status = asJsonRecord(stateMap.get("status")?.payload) ?? null;
  const checkpoint = asJsonRecord(stateMap.get("checkpoint")?.payload) ?? null;
  const allHourly = Array.isArray(stateMap.get("hourly")?.payload)
    ? stateMap.get("hourly")!.payload
      .map((entry: unknown) => asJsonRecord(entry))
      .filter((entry: JsonRecord | null): entry is JsonRecord => Boolean(entry))
    : [];
  const hourly = allHourly.slice(-12);
  const liveStatus = deriveLiveStatus(status, checkpoint);
  const summary = deriveProgressSummary(liveStatus, checkpoint, allHourly);

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    status: liveStatus,
    checkpoint,
    summary,
    hourly,
    stdoutTail: [],
    files: {
      status: { exists: false, updatedAt: null, sizeBytes: 0 },
      checkpoint: { exists: false, updatedAt: null, sizeBytes: 0 },
      hourly: { exists: false, updatedAt: null, sizeBytes: 0 },
      stdout: { exists: false, updatedAt: null, sizeBytes: 0 },
    },
    source: {
      type: "database-direct",
      shared: {
        statusUpdatedAt: stateMap.get("status")?.updated_at ?? null,
        checkpointUpdatedAt: stateMap.get("checkpoint")?.updated_at ?? null,
        hourlyUpdatedAt: stateMap.get("hourly")?.updated_at ?? null,
      },
    },
  };
}

function getArrayLength(value: JsonValue | undefined) {
  return Array.isArray(value) ? value.length : undefined;
}

function getNestedRecord(value: JsonRecord | null, key: string) {
  return asJsonRecord(value?.[key]);
}

function getNumber(value: JsonRecord | null, key: string) {
  const candidate = value?.[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}

function getBoolean(value: JsonRecord | null, key: string) {
  const candidate = value?.[key];
  return typeof candidate === "boolean" ? candidate : undefined;
}

function getString(value: JsonRecord | null, key: string) {
  const candidate = value?.[key];
  return typeof candidate === "string" && candidate.trim() ? candidate : undefined;
}

function deriveLiveStatus(status: JsonRecord | null, checkpoint: JsonRecord | null) {
  if (!status) {
    return status;
  }

  const nextStatus = { ...status };
  const checkpointNews = asJsonRecord(checkpoint?.news) ?? {};
  const checkpointEarnings = asJsonRecord(checkpoint?.earnings) ?? {};
  const checkpointSupervisor = asJsonRecord(checkpoint?.supervisor) ?? {};
  const runtime = getNestedRecord(status, "runtime");
  const precheck = getNestedRecord(status, "precheck");
  const postcheck = getNestedRecord(status, "postcheck");
  const phases = getNestedRecord(status, "phases");
  const newsPhase = getNestedRecord(phases, "news");
  const attemptedCount = getArrayLength(checkpointNews.attempted_symbols);
  const resolvedCount = getArrayLength(checkpointNews.resolved_symbols);
  const unresolvedCount = getArrayLength(checkpointNews.unresolved_symbols);

  if (typeof attemptedCount === "number") {
    nextStatus.attempted_news_symbols = attemptedCount;
  }
  if (typeof resolvedCount === "number") {
    const priorResolved = Number(status.resolved_news_symbols || 0);
    nextStatus.resolved_news_symbols = resolvedCount;
    if (typeof status.missing_news_count === "number" && resolvedCount >= priorResolved) {
      nextStatus.missing_news_count = Math.max(0, status.missing_news_count - (resolvedCount - priorResolved));
    }
  }
  if (typeof unresolvedCount === "number") {
    nextStatus.unresolved_news_symbols = unresolvedCount;
  }

  if (typeof checkpointSupervisor.no_progress_cycles === "number") {
    nextStatus.no_progress_cycles = checkpointSupervisor.no_progress_cycles;
  }
  if (typeof checkpointSupervisor.retry_attempted_news === "boolean") {
    nextStatus.retry_attempted_news = checkpointSupervisor.retry_attempted_news;
  }
  if (typeof checkpointSupervisor.effective_news_batch_size === "number") {
    nextStatus.news_batch_size = checkpointSupervisor.effective_news_batch_size;
  }
  if (typeof nextStatus.news_batch_size !== "number") {
    const runtimeBatchSize = getNumber(runtime, "newsBatchSize");
    const phaseBatchSize = getNumber(newsPhase, "batch_size");
    if (typeof runtimeBatchSize === "number") {
      nextStatus.news_batch_size = runtimeBatchSize;
    } else if (typeof phaseBatchSize === "number") {
      nextStatus.news_batch_size = phaseBatchSize;
    }
  }
  if (typeof nextStatus.no_progress_cycles !== "number") {
    const runtimeNoProgress = getNumber(runtime, "noProgressCycles");
    if (typeof runtimeNoProgress === "number") {
      nextStatus.no_progress_cycles = runtimeNoProgress;
    }
  }
  if (typeof nextStatus.retry_attempted_news !== "boolean") {
    const runtimeRetry = getBoolean(runtime, "retryAttemptedNews");
    if (typeof runtimeRetry === "boolean") {
      nextStatus.retry_attempted_news = runtimeRetry;
    }
  }
  if (typeof nextStatus.missing_news_count !== "number") {
    const currentMissingNews = getNumber(postcheck, "missing_news_count") ?? getNumber(precheck, "missing_news_count");
    if (typeof currentMissingNews === "number") {
      nextStatus.missing_news_count = currentMissingNews;
    }
  }
  if (typeof nextStatus.missing_earnings_count !== "number") {
    const currentMissingEarnings = getNumber(postcheck, "missing_earnings_count") ?? getNumber(precheck, "missing_earnings_count");
    if (typeof currentMissingEarnings === "number") {
      nextStatus.missing_earnings_count = currentMissingEarnings;
    }
  }
  if (typeof nextStatus.recent_ipo_exemptions !== "number") {
    const currentIpos = getNumber(postcheck, "recent_ipo_exemptions") ?? getNumber(precheck, "recent_ipo_exemptions");
    if (typeof currentIpos === "number") {
      nextStatus.recent_ipo_exemptions = currentIpos;
    }
  }

  const checkpointResolvedCount = typeof resolvedCount === "number" ? resolvedCount : undefined;
  const precheckMissingNews = getNumber(precheck, "missing_news_count");
  const postcheckMissingNews = getNumber(postcheck, "missing_news_count");
  const postcheckNewsProgress = getNumber(postcheck, "news_progress") ?? 0;

  const liveNewsBaseline = typeof precheckMissingNews === "number"
    ? precheckMissingNews
    : typeof postcheckMissingNews === "number"
      ? postcheckMissingNews + postcheckNewsProgress
      : undefined;

  if (typeof checkpointResolvedCount === "number") {
    nextStatus.news_progress = checkpointResolvedCount;
  } else if (typeof nextStatus.news_progress !== "number") {
    const newsProgress = getNumber(postcheck, "news_progress");
    if (typeof newsProgress === "number") {
      nextStatus.news_progress = newsProgress;
    }
  }

  if (typeof liveNewsBaseline === "number") {
    const liveMissingNews = Math.max(0, liveNewsBaseline - (checkpointResolvedCount || 0));
    nextStatus.missing_news_count = liveMissingNews;
  }
  if (typeof nextStatus.earnings_progress !== "number") {
    const earningsProgress = getNumber(postcheck, "earnings_progress");
    if (typeof earningsProgress === "number") {
      nextStatus.earnings_progress = earningsProgress;
    }
  }
  if (typeof nextStatus.phase !== "string") {
    const explicitPhase = getString(status, "phase");
    if (explicitPhase) {
      nextStatus.phase = explicitPhase;
    } else if (getBoolean(checkpointEarnings, "completed")) {
      nextStatus.phase = "completed";
    } else if (getBoolean(checkpointNews, "completed")) {
      nextStatus.phase = "earnings";
    } else if (newsPhase) {
      nextStatus.phase = "news";
    } else {
      nextStatus.phase = "running";
    }
  }
  if (typeof nextStatus.completed !== "boolean") {
    const completed = getBoolean(status, "completed") ?? getBoolean(checkpointEarnings, "completed") ?? false;
    nextStatus.completed = completed;
  }
  if (typeof nextStatus.in_progress !== "boolean") {
    nextStatus.in_progress = !Boolean(nextStatus.completed);
  }
  if (typeof checkpoint?.updated_at === "string") {
    nextStatus.generated_at = checkpoint.updated_at;
  }

  return nextStatus;
}

function deriveProgressSummary(status: JsonRecord | null, checkpoint: JsonRecord | null, allHourly: JsonRecord[]) {
  const checkpointCreatedAt = Date.parse(String(checkpoint?.created_at || ""));
  const campaignHourly = allHourly.filter((entry) => {
    const generatedAt = Date.parse(String(entry?.generated_at || ""));
    if (Number.isNaN(generatedAt)) {
      return false;
    }
    if (Number.isNaN(checkpointCreatedAt)) {
      return true;
    }
    return generatedAt >= checkpointCreatedAt;
  });

  const baselineEntry = campaignHourly.find((entry) => entry?.phase === "cycle_start") || campaignHourly[0] || null;
  const baselineNews = typeof baselineEntry?.missing_news_count === "number" ? baselineEntry.missing_news_count : null;
  const baselineEarnings = typeof baselineEntry?.missing_earnings_count === "number" ? baselineEntry.missing_earnings_count : null;
  const currentNews = typeof status?.missing_news_count === "number" ? status.missing_news_count : null;
  const currentEarnings = typeof status?.missing_earnings_count === "number" ? status.missing_earnings_count : null;

  return {
    baseline: {
      missingNewsCount: baselineNews,
      missingEarningsCount: baselineEarnings,
      generatedAt: baselineEntry?.generated_at || checkpoint?.created_at || null,
    },
    current: {
      missingNewsCount: currentNews,
      missingEarningsCount: currentEarnings,
      generatedAt: status?.generated_at || checkpoint?.updated_at || null,
    },
    completion: {
      newsPercent: baselineNews !== null && currentNews !== null && baselineNews > 0
        ? ((baselineNews - currentNews) / baselineNews) * 100
        : null,
      earningsPercent: baselineEarnings !== null && currentEarnings !== null && baselineEarnings > 0
        ? ((baselineEarnings - currentEarnings) / baselineEarnings) * 100
        : null,
    },
  };
}

export async function GET() {
  try {
    const sharedPayload = await readSharedCoverageCampaign();
    if (sharedPayload?.success === true) {
      return Response.json(sharedPayload);
    }

    const backendPayload = await readBackendCoverageCampaign();
    if (hasUsableCoveragePayload(backendPayload)) {
      const backendSource = asJsonRecord(backendPayload?.source) ?? {};
      return Response.json({
        ...backendPayload,
        source: {
          ...backendSource,
          backend: API_BASE,
        },
      });
    }

    const { backfillDir, statusPath, checkpointPath, hourlyPath, stdoutPath } = await resolveBackfillPaths();
    const [status, checkpoint, allHourly, hourly, stdoutTail, statusFile, checkpointFile, hourlyFile, stdoutFile] = await Promise.all([
      readJsonFile(statusPath),
      readJsonFile(checkpointPath),
      readJsonLines(hourlyPath),
      readJsonLinesTail(hourlyPath),
      readTextTail(stdoutPath),
      readFileStats(statusPath),
      readFileStats(checkpointPath),
      readFileStats(hourlyPath),
      readFileStats(stdoutPath),
    ]);

    const liveStatus = deriveLiveStatus(status, checkpoint);
    const summary = deriveProgressSummary(liveStatus, checkpoint, allHourly);

    return Response.json({
      success: true,
      generatedAt: new Date().toISOString(),
      status: liveStatus,
      checkpoint,
      summary,
      hourly,
      stdoutTail,
      files: {
        status: statusFile,
        checkpoint: checkpointFile,
        hourly: hourlyFile,
        stdout: stdoutFile,
      },
      source: {
        backfillDir,
      },
    });
  } catch (error) {
    return Response.json({
      success: false,
      generatedAt: new Date().toISOString(),
      status: null,
      checkpoint: null,
      summary: null,
      hourly: [],
      stdoutTail: [],
      files: {},
      error: error instanceof Error ? error.message : "Failed to load coverage campaign status",
    });
  }
}