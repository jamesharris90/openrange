/* eslint-disable no-console */
// @ts-nocheck

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import sharedQuery = require("../server/db/pool");

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "server/.env") });

const FMP_API_KEY = process.env.FMP_API_KEY;

if (!FMP_API_KEY) {
  throw new Error("FMP_API_KEY missing");
}

export const pool = sharedQuery;

export function ensureDir(relPath: string) {
  const dir = path.resolve(process.cwd(), relPath);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeJsonLog(relPath: string, payload: unknown) {
  const full = path.resolve(process.cwd(), relPath);
  ensureDir(path.dirname(relPath));
  fs.writeFileSync(full, JSON.stringify(payload, null, 2), "utf8");
  return full;
}

export async function fetchFmp(endpoint: string) {
  const url = `${endpoint}${endpoint.includes("?") ? "&" : "?"}apikey=${encodeURIComponent(FMP_API_KEY || "")}`;
  const response = await fetch(url);
  const text = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch (_error) {
    payload = { parseError: true, raw: text };
  }
  if (!response.ok) {
    throw new Error(`FMP request failed ${response.status} ${url}`);
  }
  if (!Array.isArray(payload)) {
    throw new Error(`FMP payload is not an array for ${endpoint}`);
  }
  return payload;
}

export function toIsoDate(input: unknown): string | null {
  if (!input) return null;
  const v = String(input).trim();
  if (!v) return null;
  const dateOnly = v.match(/^\d{4}-\d{2}-\d{2}$/);
  if (dateOnly) return v;
  const dt = new Date(v.includes("T") ? v : v.replace(" ", "T") + "Z");
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

export function toIsoTimestamp(input: unknown): string | null {
  if (!input) return null;
  const v = String(input).trim();
  if (!v) return null;
  const dt = new Date(v.includes("T") ? v : v.replace(" ", "T") + "Z");
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

export function numberOrNull(input: unknown): number | null {
  if (input === null || input === undefined || input === "") return null;
  const n = Number(input);
  return Number.isFinite(n) ? n : null;
}

export function bigintOrNull(input: unknown): string | null {
  if (input === null || input === undefined || input === "") return null;
  const n = Number(input);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n).toString();
}

export function validateSymbolDiversity(rows: Array<any>, symbolKey: string, minUnique = 10) {
  const symbols = new Set<string>();
  for (const row of rows) {
    const symbol = String(row?.[symbolKey] || "").trim().toUpperCase();
    if (symbol) symbols.add(symbol);
  }
  return {
    uniqueSymbols: symbols.size,
    passed: symbols.size >= minUnique,
  };
}

export function writeRejected(jobName: string, rejected: Array<any>) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const rel = `logs/data-integrity/${jobName}-${ts}.json`;
  writeJsonLog(rel, {
    jobName,
    generatedAt: new Date().toISOString(),
    rejectedCount: rejected.length,
    rejected,
  });
  return rel;
}

export function nowMinusDays(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

export function nowPlusDays(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export async function closePool() {
  await pool.end();
}
