import axios from 'axios';
import { pool } from '../../db/pg';

const FMP_API_KEY = process.env.FMP_API_KEY || '';
const FMP_BASE = 'https://financialmodelingprep.com/stable';

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

  const calendarUrl = `${FMP_BASE}/earnings-calendar?symbol=${encodeURIComponent(safeSymbol)}&limit=12&apikey=${FMP_API_KEY}`;
  const calendarResponse = await axios.get(calendarUrl, { timeout: 15000, validateStatus: () => true });
  if (calendarResponse.status !== 200 || !Array.isArray(calendarResponse.data) || calendarResponse.data.length === 0) {
    return null;
  }

  const latest = [...calendarResponse.data]
    .filter((item) => item && (item.date || item.reportDate || item.fiscalDateEnding))
    .sort((a, b) => new Date(b.date || b.reportDate || b.fiscalDateEnding).getTime() - new Date(a.date || a.reportDate || a.fiscalDateEnding).getTime())[0];

  if (!latest) return null;

  const profile = await fetchCompanyProfile(safeSymbol);
  const epsEstimate = toNumber(latest.epsEstimated ?? latest.epsEstimate ?? latest.estimatedEps);
  const epsActual = toNumber(latest.eps ?? latest.epsActual ?? latest.actualEps);
  const revEstimate = toNumber(latest.revenueEstimated ?? latest.revenueEstimate ?? latest.estimatedRevenue);
  const revActual = toNumber(latest.revenue ?? latest.revenueActual ?? latest.actualRevenue);

  const row: EarningsEventRecord = {
    symbol: safeSymbol,
    report_date: String(latest.date || latest.reportDate || latest.fiscalDateEnding).slice(0, 10),
    report_time: latest.time || latest.reportTime || null,
    eps_estimate: epsEstimate,
    eps_actual: epsActual,
    rev_estimate: revEstimate,
    rev_actual: revActual,
    eps_surprise_pct: calcSurprisePct(epsActual, epsEstimate),
    rev_surprise_pct: calcSurprisePct(revActual, revEstimate),
    guidance_direction: normalizeGuidanceDirection(latest.guidance || latest.guidanceDirection),
    market_cap: toNumber(profile?.mktCap ?? profile?.marketCap),
    float: toNumber(profile?.sharesOutstanding ?? profile?.floatShares),
    sector: profile?.sector ? String(profile.sector) : null,
    industry: profile?.industry ? String(profile.industry) : null,
  };

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
  return result.rows[0] || row;
}