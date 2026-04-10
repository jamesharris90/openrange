import axios from 'axios';
import { pool } from '../../db/pg';

const FMP_API_KEY = process.env.FMP_API_KEY || '';
const FMP_BASE = 'https://financialmodelingprep.com/stable';
const MAX_EARNINGS_ROWS = 12;

export interface EarningsEventRecord {
  id?: number;
  symbol: string;
  report_date: string;
  report_time: string | null;
  eps_estimate: number | null;
  eps_actual: number | null;
  rev_estimate: number | null;
  rev_actual: number | null;
  eps_surprise_pct: number | null;
  rev_surprise_pct: number | null;
  guidance_direction: string | null;
  market_cap: number | null;
  float: number | null;
  sector: string | null;
  industry: string | null;
}

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function calcSurprisePct(actual: number | null, estimate: number | null): number | null {
  if (actual == null || estimate == null || estimate === 0) return null;
  return ((actual - estimate) / Math.abs(estimate)) * 100;
}

function normalizeGuidanceDirection(raw: unknown): string | null {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return null;
  if (value.includes('raise') || value.includes('up')) return 'raised';
  if (value.includes('lower') || value.includes('down')) return 'lowered';
  if (value.includes('reaffirm')) return 'reaffirmed';
  return null;
}

function normalizeReportDate(item: Record<string, unknown>): string | null {
  const rawDate = item.date || item.reportDate || item.fiscalDateEnding || item.report_date;
  const text = String(rawDate || '').trim();
  return text ? text.slice(0, 10) : null;
}

function normalizeEarningsRows(payload: unknown, symbol: string): Record<string, unknown>[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .filter((item) => item && typeof item === 'object')
    .map((item) => item as Record<string, unknown>)
    .filter((item) => {
      const itemSymbol = String(item.symbol || symbol).trim().toUpperCase();
      return itemSymbol === symbol && Boolean(normalizeReportDate(item));
    })
    .sort((left, right) => {
      const leftDate = Date.parse(normalizeReportDate(left) || '');
      const rightDate = Date.parse(normalizeReportDate(right) || '');
      return rightDate - leftDate;
    })
    .slice(0, MAX_EARNINGS_ROWS);
}

async function replaceSymbolEarningsRows(symbol: string, rows: EarningsEventRecord[]) {
  await pool.query('DELETE FROM earnings_events WHERE symbol = $1', [symbol]);

  const insertSql = `
    INSERT INTO earnings_events (
      symbol, report_date, report_time,
      eps_estimate, eps_actual, rev_estimate, rev_actual,
      eps_surprise_pct, rev_surprise_pct, guidance_direction,
      market_cap, float, sector, industry
    ) VALUES (
      $1, $2, $3,
      $4, $5, $6, $7,
      $8, $9, $10,
      $11, $12, $13, $14
    )
    RETURNING *
  `;

  const insertedRows: EarningsEventRecord[] = [];
  for (const row of rows) {
    const values = [
      row.symbol,
      row.report_date,
      row.report_time,
      row.eps_estimate,
      row.eps_actual,
      row.rev_estimate,
      row.rev_actual,
      row.eps_surprise_pct,
      row.rev_surprise_pct,
      row.guidance_direction,
      row.market_cap,
      row.float,
      row.sector,
      row.industry,
    ];

    const result = await pool.query(insertSql, values);
    insertedRows.push((result.rows[0] || row) as EarningsEventRecord);
  }

  return insertedRows;
}

async function fetchCompanyProfile(symbol: string) {
  if (!FMP_API_KEY) return null;
  const url = `${FMP_BASE}/profile?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_API_KEY}`;
  const response = await axios.get(url, { timeout: 15000, validateStatus: () => true });
  if (response.status !== 200 || !Array.isArray(response.data) || response.data.length === 0) {
    return null;
  }
  return response.data[0];
}

export async function ingestEarningsEvent(symbol: string): Promise<EarningsEventRecord | null> {
  const safeSymbol = String(symbol || '').trim().toUpperCase();
  if (!safeSymbol) return null;
  if (!FMP_API_KEY) return null;

  const today = new Date();
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - 730);
  const to = new Date(today);
  to.setUTCDate(to.getUTCDate() + 180);

  const earningsUrl = `${FMP_BASE}/earnings-calendar?from=${from.toISOString().slice(0, 10)}&to=${to.toISOString().slice(0, 10)}&apikey=${FMP_API_KEY}`;
  const earningsResponse = await axios.get(earningsUrl, { timeout: 15000, validateStatus: () => true });
  const normalizedRows = normalizeEarningsRows((Array.isArray(earningsResponse.data) ? earningsResponse.data : []).filter((item) => {
    const candidate = String(item?.symbol || '').trim().toUpperCase();
    return candidate === safeSymbol;
  }), safeSymbol);
  if (earningsResponse.status !== 200 || normalizedRows.length === 0) {
    return null;
  }

  const profile = await fetchCompanyProfile(safeSymbol);

  const rows: EarningsEventRecord[] = normalizedRows.map((item) => {
    const epsEstimate = toNumber(item.epsEstimated ?? item.epsEstimate ?? item.estimatedEps);
    const epsActual = toNumber(item.eps ?? item.epsActual ?? item.actualEps);
    const revEstimate = toNumber(item.revenueEstimated ?? item.revenueEstimate ?? item.estimatedRevenue);
    const revActual = toNumber(item.revenue ?? item.revenueActual ?? item.actualRevenue);

    return {
      symbol: safeSymbol,
      report_date: normalizeReportDate(item) as string,
      report_time: String(item.time || item.reportTime || '').trim() || null,
      eps_estimate: epsEstimate,
      eps_actual: epsActual,
      rev_estimate: revEstimate,
      rev_actual: revActual,
      eps_surprise_pct: calcSurprisePct(epsActual, epsEstimate),
      rev_surprise_pct: calcSurprisePct(revActual, revEstimate),
      guidance_direction: normalizeGuidanceDirection(item.guidance || item.guidanceDirection),
      market_cap: toNumber(profile?.mktCap ?? profile?.marketCap),
      float: toNumber(profile?.sharesOutstanding ?? profile?.floatShares),
      sector: profile?.sector ? String(profile.sector) : null,
      industry: profile?.industry ? String(profile.industry) : null,
    };
  });

  const insertedRows = await replaceSymbolEarningsRows(safeSymbol, rows);
  const latestHistorical = insertedRows.find((row) => Date.parse(row.report_date) <= Date.now());
  return latestHistorical || insertedRows[0] || null;
}