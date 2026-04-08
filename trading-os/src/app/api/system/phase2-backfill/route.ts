import { promises as fs } from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

type JsonRecord = Record<string, unknown>;

let serverEnvCache: Record<string, string> | null = null;

const JOB_DIR_CANDIDATES = [
  path.resolve(process.cwd(), "../server/logs/backtests/jobs"),
  path.resolve(process.cwd(), "server/logs/backtests/jobs"),
  path.resolve(process.cwd(), "../logs/backtests/jobs"),
];

const CHECKPOINT_DIR_CANDIDATES = [
  path.resolve(process.cwd(), "../server/logs/backtests/checkpoints"),
  path.resolve(process.cwd(), "server/logs/backtests/checkpoints"),
  path.resolve(process.cwd(), "../logs/backtests/checkpoints"),
];

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
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

function getNumber(record: JsonRecord | null, key: string) {
  const candidate = record?.[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
}

function getString(record: JsonRecord | null, key: string) {
  const candidate = record?.[key];
  return typeof candidate === "string" && candidate.trim() ? candidate : null;
}

function isRecentIsoTimestamp(value: string | null, maxAgeMs = 120000) {
  if (!value) {
    return false;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return false;
  }

  return (Date.now() - parsed) <= maxAgeMs;
}

async function readSharedPhase2Backfill() {
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
    .from("phase2_backfill_state")
    .select("state_key, payload, updated_at")
    .in("state_key", ["status", "checkpoint", "events"]);

  if (error || !data?.length) {
    return null;
  }

  const stateMap = new Map(data.map((row) => [String(row.state_key), row]));
  const status = asRecord(stateMap.get("status")?.payload) ?? null;
  const checkpoint = asRecord(stateMap.get("checkpoint")?.payload) ?? null;
  const events = Array.isArray(stateMap.get("events")?.payload)
    ? stateMap.get("events")!.payload
      .map((entry: unknown) => asRecord(entry))
      .filter((entry: JsonRecord | null): entry is JsonRecord => Boolean(entry))
    : [];

  const processedSymbols = getNumber(checkpoint, "processedSymbols") ?? getNumber(status, "processedSymbols");
  const totalSymbols = getNumber(checkpoint, "totalSymbols") ?? getNumber(status, "totalSymbols");
  const persistedSignals = getNumber(checkpoint, "persistedSignals") ?? getNumber(status, "persistedSignals");
  const peakMemoryMb = getNumber(checkpoint, "peakMemoryMb") ?? getNumber(status, "peakMemoryMb");
  const progressPercent = processedSymbols !== null && totalSymbols && totalSymbols > 0
    ? (processedSymbols / totalSymbols) * 100
    : null;
  const heartbeatAt = getString(status, "heartbeatAt") || stateMap.get("status")?.updated_at || null;

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    status: status ? {
      ...status,
      pidAlive: isRecentIsoTimestamp(heartbeatAt),
    } : null,
    checkpoint,
    summary: {
      processedSymbols,
      totalSymbols,
      persistedSignals,
      peakMemoryMb,
      progressPercent,
      lastCompletedSymbol: getString(checkpoint, "lastCompletedSymbol") || getString(status, "lastCompletedSymbol"),
      resumedFromCheckpoint: Boolean(status?.resumedFromCheckpoint),
    },
    stdoutTail: events
      .slice(-60)
      .map((entry: JsonRecord) => getString(entry, "message") || JSON.stringify(entry)),
    files: {
      status: { exists: false, updatedAt: null, sizeBytes: 0 },
      checkpoint: { exists: false, updatedAt: null, sizeBytes: 0 },
      stdout: { exists: false, updatedAt: null, sizeBytes: 0 },
    },
    source: {
      type: "database-direct",
      shared: {
        statusUpdatedAt: stateMap.get("status")?.updated_at ?? null,
        checkpointUpdatedAt: stateMap.get("checkpoint")?.updated_at ?? null,
        eventsUpdatedAt: stateMap.get("events")?.updated_at ?? null,
      },
    },
  };
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveExistingPath(candidates: string[]) {
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

async function resolveCheckpointPath(preferredPath: string | null, candidates: Array<{ filePath: string; updatedAt: number }>) {
  if (preferredPath && await pathExists(preferredPath)) {
    return preferredPath;
  }
  return candidates[0]?.filePath || null;
}

async function readJsonFile(filePath: string) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return asRecord(JSON.parse(content));
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

async function readTextTail(filePath: string, limit = 60) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return content
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .slice(-limit);
  } catch {
    return [] as string[];
  }
}

async function listCheckpointFiles(dirPath: string) {
  try {
    const entries = await fs.readdir(dirPath);
    const files = await Promise.all(entries
      .filter((entry) => entry.endsWith(".json"))
      .map(async (entry) => {
        const fullPath = path.join(dirPath, entry);
        const stats = await fs.stat(fullPath);
        return {
          filePath: fullPath,
          updatedAt: stats.mtime.getTime(),
        };
      }));

    return files.sort((left, right) => right.updatedAt - left.updatedAt);
  } catch {
    return [] as Array<{ filePath: string; updatedAt: number }>;
  }
}

function isProcessAlive(pid: number | null) {
  if (!pid || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  const shared = await readSharedPhase2Backfill();
  const jobDir = await resolveExistingPath(JOB_DIR_CANDIDATES);
  const checkpointDir = await resolveExistingPath(CHECKPOINT_DIR_CANDIDATES);
  const defaultStatusFile = path.join(jobDir, "phase2-backfill-status.json");
  const defaultStdoutFile = path.join(jobDir, "phase2-backfill.stdout.log");
  const checkpointCandidates = await listCheckpointFiles(checkpointDir);
  const hasLocalFallback = await pathExists(defaultStatusFile) || checkpointCandidates.length > 0;

  if (shared && (Boolean(shared.status && shared.status.pidAlive) || !hasLocalFallback)) {
    return Response.json(shared);
  }

  const status = await readJsonFile(defaultStatusFile);
  const checkpointPath = await resolveCheckpointPath(
    typeof status?.checkpointFile === "string" ? String(status.checkpointFile) : null,
    checkpointCandidates,
  );
  const checkpoint = checkpointPath ? await readJsonFile(checkpointPath) : null;
  const stdoutFile = typeof status?.stdoutFile === "string" ? String(status.stdoutFile) : defaultStdoutFile;
  const stdoutTail = await readTextTail(stdoutFile);

  const pidValue = typeof status?.pid === "number" ? status.pid : null;
  const processedSymbols = typeof checkpoint?.processedSymbols === "number" ? checkpoint.processedSymbols : null;
  const totalSymbols = typeof checkpoint?.totalSymbols === "number" ? checkpoint.totalSymbols : null;
  const persistedSignals = typeof checkpoint?.persistedSignals === "number" ? checkpoint.persistedSignals : null;
  const peakMemoryMb = typeof checkpoint?.peakMemoryMb === "number" ? checkpoint.peakMemoryMb : null;
  const progressPercent = processedSymbols !== null && totalSymbols && totalSymbols > 0
    ? (processedSymbols / totalSymbols) * 100
    : null;

  return Response.json({
    success: true,
    generatedAt: new Date().toISOString(),
    status: status ? {
      ...status,
      pidAlive: isProcessAlive(pidValue),
    } : null,
    checkpoint,
    summary: {
      processedSymbols,
      totalSymbols,
      persistedSignals,
      peakMemoryMb,
      progressPercent,
      lastCompletedSymbol: checkpoint?.lastCompletedSymbol || null,
      resumedFromCheckpoint: Boolean(status?.result && asRecord(status.result)?.resumedFromCheckpoint),
    },
    stdoutTail,
    files: {
      status: await readFileStats(defaultStatusFile),
      checkpoint: checkpointPath ? await readFileStats(checkpointPath) : { exists: false, updatedAt: null, sizeBytes: 0 },
      stdout: await readFileStats(stdoutFile),
    },
  });
}