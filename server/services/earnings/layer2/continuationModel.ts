import { pool } from '../../../db/pg';

function toBias(probability: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (probability >= 70) return 'HIGH';
  if (probability >= 40) return 'MEDIUM';
  return 'LOW';
}

export async function calculateContinuationProbability(symbol: string) {
  const safeSymbol = String(symbol || '').trim().toUpperCase();
  if (!safeSymbol) {
    return {
      continuationProbability: 0,
      bias: 'LOW' as const,
    };
  }

  const result = await pool.query(
    `
      SELECT day2_followthrough_pct
      FROM earnings_market_reaction
      WHERE symbol = $1
      ORDER BY report_date DESC, created_at DESC
      LIMIT 8
    `,
    [safeSymbol],
  );

  const rows = Array.isArray(result.rows) ? result.rows : [];
  if (!rows.length) {
    return {
      continuationProbability: 0,
      bias: 'LOW' as const,
    };
  }

  const positives = rows.filter((row) => Number(row?.day2_followthrough_pct) > 0).length;
  const continuationProbability = Math.round((positives / rows.length) * 100);

  return {
    continuationProbability,
    bias: toBias(continuationProbability),
  };
}
