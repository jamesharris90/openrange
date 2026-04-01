const { supabaseAdmin } = require('../../services/supabaseClient');

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function getEarningsRows() {
  if (!supabaseAdmin) {
    throw new Error('Supabase admin client unavailable');
  }

  const { data, error } = await supabaseAdmin
    .from('earnings_events')
    .select('symbol, earnings_date, report_date, eps_estimate, eps_actual')
    .order('report_date', { ascending: true })
    .limit(200);

  if (error) {
    throw new Error(error.message || 'Failed to load earnings events');
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (data || [])
    .map((row) => {
      const earningsDate = row.earnings_date || row.report_date || null;
      const earningsAt = earningsDate ? new Date(`${earningsDate}T00:00:00Z`) : null;
      if (!earningsAt || Number.isNaN(earningsAt.getTime()) || earningsAt < today) {
        return null;
      }

      const dayDiff = (earningsAt.getTime() - Date.now()) / 86400000;
      return {
        symbol: row.symbol || null,
        earnings_date: earningsDate,
        eps_estimate: toNumber(row.eps_estimate),
        eps_actual: toNumber(row.eps_actual),
        days_to_earnings: toNumber(dayDiff.toFixed(2)),
      };
    })
    .filter(Boolean)
    .slice(0, 50);
}

module.exports = {
  getEarningsRows,
};