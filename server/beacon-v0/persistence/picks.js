/**
 * Beacon v0 persistence layer.
 * Writes picks from the orchestrator to beacon_v0_picks table.
 */

const crypto = require('crypto');
const { queryWithTimeout } = require('../../db/pg');

function generateRunId() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `v0-${timestamp}-${crypto.randomBytes(4).toString('hex')}`;
}

function normalizePickForStorage(pick) {
  return {
    symbol: String(pick.symbol || '').trim().toUpperCase(),
    pattern: pick.pattern || pick.patternCategory || 'Uncategorized Signal Alignment',
    confidence: pick.confidence || pick.confidenceQualification || 'unqualified',
    reasoning: pick.reasoning || pick.patternDescription || '',
    signalsAligned: pick.signals_aligned || (pick.signals || []).map((signal) => signal.signal),
    metadata: pick.metadata || {
      direction: pick.direction || 'neutral',
      alignment: pick.alignment || null,
      signals: pick.signals || [],
      disqualifiedReasons: pick.disqualifiedReasons || [],
    },
    narrativeThesis: pick.narrative_thesis || null,
    narrativeWatchFor: pick.narrative_watch_for || null,
    narrativeGeneratedAt: pick.narrative_generated_at || null,
    narrativeModel: pick.narrative_model || null,
    narrativeInputTokens: Number.isFinite(Number(pick.narrative_input_tokens)) ? Number(pick.narrative_input_tokens) : null,
    narrativeOutputTokens: Number.isFinite(Number(pick.narrative_output_tokens)) ? Number(pick.narrative_output_tokens) : null,
    narrativeError: pick.narrative_error || null,
  };
}

async function persistPicks(picks, runId = generateRunId()) {
  if (!Array.isArray(picks) || picks.length === 0) {
    return { inserted: 0, runId };
  }

  const normalized = picks.map(normalizePickForStorage).filter((pick) => pick.symbol);
  if (normalized.length === 0) {
    return { inserted: 0, runId };
  }

  const values = [];
  const placeholders = [];

  normalized.forEach((pick, index) => {
    const base = index * 14;
    placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::jsonb, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14})`);
    values.push(
      pick.symbol,
      pick.pattern,
      pick.confidence,
      pick.reasoning,
      pick.signalsAligned,
      JSON.stringify(pick.metadata || {}),
      runId,
      pick.narrativeThesis,
      pick.narrativeWatchFor,
      pick.narrativeGeneratedAt,
      pick.narrativeModel,
      pick.narrativeInputTokens,
      pick.narrativeOutputTokens,
      pick.narrativeError,
    );
  });

  await queryWithTimeout(
    `
      INSERT INTO beacon_v0_picks
        (symbol, pattern, confidence, reasoning, signals_aligned, metadata, run_id,
         narrative_thesis, narrative_watch_for, narrative_generated_at, narrative_model,
         narrative_input_tokens, narrative_output_tokens, narrative_error)
      VALUES ${placeholders.join(', ')}
    `,
    values,
    {
      label: 'beacon_v0.persistence.insert',
      timeoutMs: 10000,
      slowQueryMs: 1000,
      poolType: 'write',
      maxRetries: 1,
    },
  );

  return { inserted: normalized.length, runId };
}

async function getLatestPicks(limit = 20) {
  const boundedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const result = await queryWithTimeout(
    `
      WITH latest_run AS (
        SELECT run_id
        FROM beacon_v0_picks
        ORDER BY created_at DESC
        LIMIT 1
      )
      SELECT
        symbol,
        pattern,
        confidence,
        reasoning,
        signals_aligned,
        metadata,
        narrative_thesis,
        narrative_watch_for,
        narrative_generated_at,
        narrative_model,
        narrative_input_tokens,
        narrative_output_tokens,
        narrative_error,
        run_id,
        created_at
      FROM beacon_v0_picks
      WHERE run_id = (SELECT run_id FROM latest_run)
      ORDER BY symbol ASC
      LIMIT $1
    `,
    [boundedLimit],
    {
      label: 'beacon_v0.persistence.latest',
      timeoutMs: 8000,
      slowQueryMs: 1000,
      poolType: 'read',
      maxRetries: 1,
    },
  );

  return result.rows;
}

module.exports = {
  generateRunId,
  getLatestPicks,
  normalizePickForStorage,
  persistPicks,
};