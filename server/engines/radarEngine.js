const db = require('../db');
const logger = require('../logger');

function normalizeClass(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (raw === 'A' || raw.endsWith(' A')) return 'A';
  if (raw === 'B' || raw.endsWith(' B')) return 'B';
  if (raw === 'C' || raw.endsWith(' C')) return 'C';
  return null;
}

async function runRadarEngine() {
  try {
    const result = await db.query(
      `SELECT *
       FROM strategy_signals
       WHERE updated_at >= NOW() - INTERVAL '15 minutes'`,
      []
    );

    const rows = Array.isArray(result?.rows) ? result.rows : [];

    const ranked = rows
      .filter((row) => Number(row?.score) >= 70)
      .sort((a, b) => Number(b?.score || 0) - Number(a?.score || 0));

    const radar = {
      A: [],
      B: [],
      C: [],
    };

    for (const row of ranked) {
      const cls = normalizeClass(row?.class);
      if (!cls) continue;
      radar[cls].push(row);
    }

    return radar;
  } catch (error) {
    logger.error('[ENGINE ERROR] radar run failed', { error: error.message });
    return { A: [], B: [], C: [], error: error.message };
  }
}

module.exports = runRadarEngine;
