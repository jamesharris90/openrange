const { queryWithTimeout } = require('../db/pg');

const INSIDER_LOOKBACK_DAYS = 30;
const CONGRESSIONAL_LOOKBACK_DAYS = 30;
const CONGRESSIONAL_CLUSTER_DAYS = 14;
const ACTIVIST_LOOKBACK_DAYS = 90;

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function scoreTier(totalScore) {
  if (totalScore >= 60) return 'high';
  if (totalScore >= 30) return 'medium';
  return 'low';
}

function calculateInsiderComponent(rows = []) {
  const buys = rows.filter((row) => String(row.transaction_type || '').toUpperCase().startsWith('P-PURCHASE'));
  const sells = rows.filter((row) => String(row.transaction_type || '').toUpperCase().startsWith('S-SALE'));
  const buyContribution = Math.min(buys.length * 8, 24);
  const sellPenalty = Math.min(sells.length * 3, 10);
  const distinctBuyers = new Set(buys.map((row) => (row.reporting_cik || row.reporting_name || '').trim()).filter(Boolean));
  const cSuiteBuy = buys.some((row) => /\b(CEO|CFO|COO)\b/i.test(String(row.type_of_owner || '')));
  const clusterBuy = distinctBuyers.size >= 3;
  const insiderNetValue = rows.reduce((total, row) => {
    const value = toNumber(row.total_value) || 0;
    if (String(row.transaction_type || '').toUpperCase().startsWith('P-PURCHASE')) return total + value;
    if (String(row.transaction_type || '').toUpperCase().startsWith('S-SALE')) return total - value;
    return total;
  }, 0);

  let component = buyContribution - sellPenalty;
  if (cSuiteBuy) component += 8;
  if (clusterBuy) component += 8;
  component = Math.max(0, Math.min(40, component));

  return {
    component,
    insider_signal_count: buys.length + sells.length,
    insider_net_value: insiderNetValue,
    insider_buy_count: buys.length,
    insider_sell_count: sells.length,
    contributing: [
      ...buys.slice(0, 5).map((row) => ({
        name: row.reporting_name,
        transaction_date: row.transaction_date,
        type: row.transaction_type,
        value: toNumber(row.total_value),
        contribution: 8,
      })),
      ...sells.slice(0, 3).map((row) => ({
        name: row.reporting_name,
        transaction_date: row.transaction_date,
        type: row.transaction_type,
        value: toNumber(row.total_value),
        contribution: -3,
      })),
      ...(cSuiteBuy ? [{ name: 'C-suite', transaction_date: null, type: 'bonus', value: null, contribution: 8 }] : []),
      ...(clusterBuy ? [{ name: 'Insider cluster', transaction_date: null, type: 'bonus', value: null, contribution: 8 }] : []),
    ],
  };
}

function calculateCongressionalComponent(rows = [], options = {}) {
  const distinctMembers = new Set(rows.map((row) => `${row.first_name || ''}|${row.last_name || ''}`.trim()).filter(Boolean));
  const memberContribution = Math.min(distinctMembers.size * 5, 15);
  const clusterMembers = new Set(
    rows
      .filter((row) => row.disclosure_date && new Date(row.disclosure_date) >= new Date(options.clusterWindowStart || '1970-01-01'))
      .map((row) => `${row.first_name || ''}|${row.last_name || ''}`.trim())
      .filter(Boolean)
  );
  const clusterBonus = clusterMembers.size >= 3 ? 5 : 0;
  const congressionalNetValue = rows.reduce((total, row) => total + (toNumber(row.amount_min) || 0), 0);
  const component = Math.max(0, Math.min(25, memberContribution + clusterBonus));

  return {
    component,
    congressional_member_count: distinctMembers.size,
    congressional_net_value: congressionalNetValue,
    contributing: rows.slice(0, 5).map((row) => ({
      member: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
      party: row.party || row.member_party || null,
      trade_date: row.disclosure_date || row.transaction_date,
      type: row.transaction_type,
      contribution: 5,
    })),
  };
}

function calculateInstitutionalComponent(rows = []) {
  const newPositions = rows.filter((row) => row.is_new_position === true);
  const increased = rows.filter((row) => (toNumber(row.shares_change_pct) || 0) > 50);
  const majorFilers = rows.filter((row) => (toNumber(row.market_value) || 0) > 100000000);
  const closed = rows.filter((row) => row.is_sold_out === true);

  const component = Math.max(
    0,
    Math.min(25,
      Math.min(newPositions.length * 5, 10)
      + Math.min(increased.length * 5, 10)
      + (majorFilers.length * 5)
      - Math.min(closed.length * 5, 10)
    )
  );

  const contributing = [];
  newPositions.slice(0, 3).forEach((row) => {
    contributing.push({ filer: row.investor_name, action: 'new_position', value: toNumber(row.market_value), contribution: 5 });
  });
  increased.slice(0, 3).forEach((row) => {
    contributing.push({ filer: row.investor_name, action: 'shares_up_50pct', value: toNumber(row.shares_change_pct), contribution: 5 });
  });
  majorFilers.slice(0, 3).forEach((row) => {
    contributing.push({ filer: row.investor_name, action: 'major_filer', value: toNumber(row.market_value), contribution: 5 });
  });
  closed.slice(0, 2).forEach((row) => {
    contributing.push({ filer: row.investor_name, action: 'closed_position', value: toNumber(row.market_value), contribution: -5 });
  });

  return {
    component,
    institutional_new_positions: newPositions.length,
    institutional_increased_positions: increased.length,
    institutional_closed_positions: closed.length,
    contributing,
  };
}

function calculateActivistComponent(rows = []) {
  const distinctFilers = new Set(rows.map((row) => `${row.cik || ''}|${row.reporting_person || ''}`).filter(Boolean));
  const has13D = rows.some((row) => String(row.form_type || '').toUpperCase().startsWith('SC 13D'));
  const has13G = rows.some((row) => String(row.form_type || '').toUpperCase().startsWith('SC 13G'));
  let component = 0;
  if (has13D) {
    component += 10;
  } else if (has13G) {
    component += 5;
  }
  component += Math.max(0, distinctFilers.size - 1) * 3;
  component = Math.min(10, component);

  return {
    component,
    activist_filing_count: rows.length,
    contributing: rows.slice(0, 5).map((row, index) => ({
      filer: row.reporting_person,
      form_type: row.form_type,
      filing_date: row.filing_date,
      contribution: index === 0 ? (String(row.form_type || '').toUpperCase().startsWith('SC 13D') ? 10 : 5) : 3,
    })),
  };
}

async function loadSymbolInputs(symbol, scoreDate) {
  const insiderPromise = queryWithTimeout(
    `SELECT reporting_cik, reporting_name, type_of_owner, transaction_type, transaction_date, total_value
     FROM insider_trades
     WHERE UPPER(symbol) = UPPER($1)
       AND transaction_date >= $2::date - INTERVAL '${INSIDER_LOOKBACK_DAYS} days'`,
    [symbol, scoreDate],
    { label: 'smart_money.load_insider', timeoutMs: 10000, maxRetries: 0, poolType: 'read' }
  );

  const congressionalPromise = queryWithTimeout(
    `SELECT first_name, last_name, transaction_type, transaction_date, disclosure_date, amount_min
     FROM congressional_trades
     WHERE UPPER(symbol) = UPPER($1)
       AND disclosure_date >= $2::date - INTERVAL '${CONGRESSIONAL_LOOKBACK_DAYS} days'`,
    [symbol, scoreDate],
    { label: 'smart_money.load_congressional', timeoutMs: 10000, maxRetries: 0, poolType: 'read' }
  );

  const institutionalPromise = queryWithTimeout(
    `WITH latest_period AS (
       SELECT MAX(period_end_date) AS period_end_date
       FROM institutional_holdings_13f
       WHERE UPPER(symbol) = UPPER($1)
     )
     SELECT investor_name, is_new_position, is_sold_out, shares_change_pct, market_value
     FROM institutional_holdings_13f
     WHERE UPPER(symbol) = UPPER($1)
       AND period_end_date = (SELECT period_end_date FROM latest_period)`,
    [symbol],
    { label: 'smart_money.load_institutional', timeoutMs: 10000, maxRetries: 0, poolType: 'read' }
  );

  const activistPromise = queryWithTimeout(
    `SELECT cik, reporting_person, form_type, filing_date
     FROM activist_filings
     WHERE UPPER(symbol) = UPPER($1)
       AND filing_date >= $2::date - INTERVAL '${ACTIVIST_LOOKBACK_DAYS} days'`,
    [symbol, scoreDate],
    { label: 'smart_money.load_activist', timeoutMs: 10000, maxRetries: 0, poolType: 'read' }
  );

  const [insider, congressional, institutional, activist] = await Promise.all([
    insiderPromise,
    congressionalPromise,
    institutionalPromise,
    activistPromise,
  ]);

  return {
    insider: insider.rows || [],
    congressional: congressional.rows || [],
    institutional: institutional.rows || [],
    activist: activist.rows || [],
  };
}

async function computeScoreForSymbol(symbol, scoreDate = new Date()) {
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  const normalizedScoreDate = typeof scoreDate === 'string'
    ? scoreDate.slice(0, 10)
    : new Date(scoreDate).toISOString().slice(0, 10);
  const inputs = await loadSymbolInputs(normalizedSymbol, normalizedScoreDate);

  const insider = calculateInsiderComponent(inputs.insider);
  const congressional = calculateCongressionalComponent(inputs.congressional, {
    clusterWindowStart: new Date(new Date(`${normalizedScoreDate}T00:00:00Z`).getTime() - (CONGRESSIONAL_CLUSTER_DAYS * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10),
  });
  const institutional = calculateInstitutionalComponent(inputs.institutional);
  const activist = calculateActivistComponent(inputs.activist);
  const totalScore = Math.min(100, insider.component + congressional.component + institutional.component + activist.component);

  return {
    symbol: normalizedSymbol,
    score_date: normalizedScoreDate,
    total_score: totalScore,
    score_tier: scoreTier(totalScore),
    insider_component: insider.component,
    insider_signal_count: insider.insider_signal_count,
    insider_net_value: insider.insider_net_value,
    insider_buy_count: insider.insider_buy_count,
    insider_sell_count: insider.insider_sell_count,
    congressional_component: congressional.component,
    congressional_member_count: congressional.congressional_member_count,
    congressional_net_value: congressional.congressional_net_value,
    institutional_component: institutional.component,
    institutional_new_positions: institutional.institutional_new_positions,
    institutional_increased_positions: institutional.institutional_increased_positions,
    institutional_closed_positions: institutional.institutional_closed_positions,
    activist_component: activist.component,
    activist_filing_count: activist.activist_filing_count,
    contributing_factors: {
      insider: insider.contributing,
      congressional: congressional.contributing,
      institutional: institutional.contributing,
      activist: activist.contributing,
    },
  };
}

module.exports = {
  calculateActivistComponent,
  calculateCongressionalComponent,
  calculateInstitutionalComponent,
  calculateInsiderComponent,
  computeScoreForSymbol,
  scoreTier,
};