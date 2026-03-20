/* eslint-disable no-control-regex */
// @ts-nocheck

import crypto from "crypto";

const SOURCE_PRIORITY: Record<string, number> = {
  "businesswire.com": 5,
  "reuters.com": 5,
  "globenewswire.com": 4,
  "prnewswire.com": 4,
  "newsfilecorp.com": 3,
  "seekingalpha.com": 3,
  "marketwatch.com": 3,
  "finnhub.io": 2,
  "youtube.com": 1,
};

function normalizeWhitespace(input: string) {
  return input.replace(/\s+/g, " ").trim();
}

export function normalizeTitle(input: unknown): string {
  const raw = String(input || "").toLowerCase();
  return normalizeWhitespace(raw.replace(/[^a-z0-9\s]/g, " "));
}

export function normalizeText(input: unknown): string {
  const raw = String(input || "").toLowerCase();
  const stripped = raw.replace(/<[^>]*>/g, " ").replace(/[^a-z0-9\s]/g, " ");
  return normalizeWhitespace(stripped);
}

export function splitSymbols(input: unknown): string[] {
  const raw = String(input || "").trim();
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((part) => String(part || "").trim().toUpperCase())
        .filter((part) => /^[A-Z0-9.\-^]+$/.test(part))
    )
  );
}

function qualityScore(row: any): number {
  const site = String(row?.site || "").trim().toLowerCase();
  const publisher = String(row?.publisher || "").trim().toLowerCase();
  const sourceKey = site || publisher;
  const sourceScore = SOURCE_PRIORITY[sourceKey] ?? 0;

  const titleLen = String(row?.title || "").trim().length;
  const textLen = String(row?.text || "").trim().length;
  const hasImage = row?.image ? 1 : 0;

  return sourceScore * 100 + Math.min(titleLen, 200) + Math.min(textLen, 1200) + hasImage * 25;
}

function contentHash(title: string, text: string): string {
  return crypto.createHash("sha256").update(`${title}|${text}`).digest("hex");
}

export function dedupeNewsRows(rows: any[]) {
  const keptByHash = new Map<string, any>();
  const rejected: any[] = [];

  for (const row of rows) {
    const normalized_title = normalizeTitle(row?.title);
    const normalized_text = normalizeText(row?.text);

    if (!normalized_title || normalized_title.length < 8) {
      rejected.push({ reason: "low_content_title", row });
      continue;
    }

    const textLen = normalized_text.length;
    if (textLen > 0 && textLen < 40) {
      rejected.push({ reason: "low_content_text", row });
      continue;
    }

    const dedupe_hash = contentHash(normalized_title, normalized_text);
    const candidate = {
      ...row,
      normalized_title,
      normalized_text,
      dedupe_hash,
      quality_score: qualityScore(row),
    };

    const existing = keptByHash.get(dedupe_hash);
    if (!existing) {
      keptByHash.set(dedupe_hash, candidate);
      continue;
    }

    if (candidate.quality_score > existing.quality_score) {
      rejected.push({ reason: "duplicate_replaced_lower_quality", dedupe_hash, dropped: existing, kept: candidate });
      keptByHash.set(dedupe_hash, candidate);
    } else {
      rejected.push({ reason: "duplicate_lower_quality", dedupe_hash, dropped: candidate, kept: existing });
    }
  }

  return {
    kept: Array.from(keptByHash.values()),
    rejected,
  };
}
