const { PDFParse } = require('pdf-parse');
const XLSX = require('xlsx');
const logger = require('../../logger');

// ═══════════════════════════════════════════════════════════════════
// TICKER MAP — Instrument name → ticker symbol
// ═══════════════════════════════════════════════════════════════════

const TICKER_MAP = {
  'tesla inc': 'TSLA',
  'blackstone mortgage trust': 'BXMT',
  'ondas inc': 'ONDS',
  'adlai nortye limited': 'ANL',
  'alumis inc': 'ALMS',
  'axt inc': 'AXTI',
  'brand engagement network': 'BNAI',
  'datavault ai inc': 'DTVT',
  'digital currency x technology': 'DCXC',
  'fastly inc': 'FSLY',
  'ginkgo bioworks holdings': 'DNA',
  'greenwich lifesciences': 'GLSI',
  'ionq inc': 'IONQ',
  'lyft inc': 'LYFT',
  'once upon a farm': 'OUAF',
  'opera ltd': 'OPRA',
  'palladyne ai corp': 'PDYN',
  'pbf energy inc': 'PBF',
  'redwood trust inc': 'RWT',
  'skywater technology': 'SKYT',
  'super micro computer': 'SMCI',
  'tal education group': 'TAL',
  'tharimmune inc': 'THAR',
  'the kraft heinz co': 'KHC',
  'under armour inc': 'UAA',
};

function lookupTicker(instrumentName) {
  if (!instrumentName) return null;
  const lower = instrumentName.toLowerCase().replace(/[.\-]/g, '').trim();
  for (const [key, ticker] of Object.entries(TICKER_MAP)) {
    if (lower.includes(key)) return ticker;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function parseNum(val) {
  if (val == null) return null;
  if (typeof val === 'number') return val;
  const str = val.toString().replace(/,/g, '').trim();
  const n = parseFloat(str);
  return isNaN(n) ? null : n;
}

function normaliseRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.toLowerCase().trim()] = v;
  }
  return out;
}

function parseSaxoDate(dateStr) {
  if (!dateStr) return null;
  const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const m = months[parts[1].toLowerCase()];
  if (!m) return dateStr;
  return `${parts[2]}-${m}-${parts[0].padStart(2, '0')}`;
}

function formatExcelDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 16);
  const str = val.toString().trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 16);
  if (/^\d{1,2}-\w{3}-\d{4}$/.test(str)) return parseSaxoDate(str);
  // DD/MM/YYYY or MM/DD/YYYY
  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const [, a, b, y] = slashMatch;
    // Assume DD/MM/YYYY (Saxo UK format)
    return `${y}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`;
  }
  return str;
}

function buildResult(format, trades, warnings, currency = 'USD') {
  const totalPnl = trades.reduce((s, t) => s + (t.pnlDollar || 0), 0);
  const totalCosts = trades.reduce((s, t) => s + (t.commission || 0), 0);
  return {
    broker: format,
    currency,
    reportPeriod: null,
    trades,
    holdings: [],
    warnings,
    summary: {
      totalPnl: +totalPnl.toFixed(2),
      totalCosts: +totalCosts.toFixed(2),
      tradeCount: trades.length,
      holdingsCount: 0,
      completeCount: trades.filter(t => t.status === 'complete').length,
      incompleteCount: trades.filter(t => t.status === 'incomplete').length,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// FORMAT DETECTION
// ═══════════════════════════════════════════════════════════════════

// Saxo Transactions format headers (CSV or XLSX)
const SAXO_TRANSACTION_HEADERS = [
  'trade date', 'instrument', 'open/close', 'quantity', 'price',
];

// Saxo Closed Positions format headers (XLSX)
const SAXO_CLOSED_POSITION_HEADERS = [
  'instrument', 'closepositionid',
];

function detectSaxoTransactions(headers) {
  const lower = headers.map(h => h.toLowerCase().trim());
  const has = (needle) => lower.some(h => h.includes(needle));
  return has('trade date') && has('instrument') && (has('open/close') || has('open / close'));
}

function detectSaxoClosedPositions(headers) {
  const lower = headers.map(h => h.toLowerCase().trim());
  const has = (needle) => lower.some(h => h.includes(needle));
  return has('instrument') && (has('close type') || has('closetype') || has('closepositionid'));
}

function detectManualCsv(headers) {
  const lower = headers.map(h => h.toLowerCase().trim());
  const has = (needle) => lower.some(h => h === needle);
  return has('ticker') || has('symbol') || has('entry') || has('entry_price');
}

// ═══════════════════════════════════════════════════════════════════
// SAXO TRANSACTIONS ADAPTER (FIFO matching)
// ═══════════════════════════════════════════════════════════════════
// Saxo "Transactions" export has one row per execution:
//   Trade Date | Value Date | Product | Symbol | Instrument | Open/Close | Buy/Sell |
//   Quantity | Price | Booked Amount | Realized P/L | ...
// We filter to Stock/CFD Stock, separate OPEN/CLOSE rows, group by
// Instrument, and FIFO-match into trades.

function adaptSaxoTransactions(rows) {
  const warnings = [];
  const allHeaders = rows.length > 0 ? Object.keys(rows[0]) : [];
  logger.info(`[Saxo Transactions] Headers: ${JSON.stringify(allHeaders)}`);
  logger.info(`[Saxo Transactions] Total rows: ${rows.length}`);

  // Normalise all rows
  const normalised = rows.map(r => normaliseRow(r));

  // Find actual header keys (case-insensitive partial matching)
  const findKey = (norm, ...needles) => {
    for (const needle of needles) {
      const key = Object.keys(norm).find(k => k.includes(needle));
      if (key) return key;
    }
    return null;
  };

  const sample = normalised[0] || {};
  const kProduct = findKey(sample, 'product');
  const kInstrument = findKey(sample, 'instrument');
  const kOpenClose = findKey(sample, 'open/close', 'open / close');
  const kBuySell = findKey(sample, 'buy/sell', 'buy / sell');
  const kQty = findKey(sample, 'quantity');
  const kPrice = findKey(sample, 'price');
  const kTradeDate = findKey(sample, 'trade date');
  const kRealizedPnl = findKey(sample, 'realized p/l', 'realized p&l', 'realized pnl');
  const kBookedAmount = findKey(sample, 'booked amount');
  const kSymbol = findKey(sample, 'symbol');
  const kBookedCosts = findKey(sample, 'booked cost', 'total cost');

  logger.info(`[Saxo Transactions] Key mapping: product=${kProduct}, instrument=${kInstrument}, open/close=${kOpenClose}, buy/sell=${kBuySell}, qty=${kQty}, price=${kPrice}, date=${kTradeDate}, pnl=${kRealizedPnl}, symbol=${kSymbol}`);

  // Filter to tradeable products (Stock, CFD Stock)
  const tradeableProducts = ['stock', 'cfd stock', 'cfd', 'share'];
  const filtered = normalised.filter(r => {
    if (!kProduct) return true; // No product column — include all
    const product = (r[kProduct] || '').toString().toLowerCase();
    // Skip non-tradeable rows
    if (product.includes('cash') || product.includes('subscription') || product.includes('billing') || product.includes('fee')) return false;
    if (tradeableProducts.some(p => product.includes(p))) return true;
    return true; // Include unknown products
  });

  logger.info(`[Saxo Transactions] Rows after product filter: ${filtered.length} (excluded ${rows.length - filtered.length})`);

  // Separate into OPEN and CLOSE rows
  const openRows = [];
  const closeRows = [];
  const unknownRows = [];

  for (const row of filtered) {
    const openClose = (row[kOpenClose] || '').toString().toLowerCase().trim();
    const instrument = (row[kInstrument] || '').toString().trim();
    if (!instrument) continue;

    const qty = Math.abs(parseNum(row[kQty]) || 0);
    const price = parseNum(row[kPrice]) || 0;
    const tradeDate = formatExcelDate(row[kTradeDate]);
    const buySell = (row[kBuySell] || '').toString().toLowerCase().trim();
    const realizedPnl = parseNum(row[kRealizedPnl]);
    const bookedAmount = parseNum(row[kBookedAmount]);
    const bookedCosts = parseNum(row[kBookedCosts]);
    const symbol = row[kSymbol] ? row[kSymbol].toString().trim() : null;

    const entry = { instrument, qty, price, tradeDate, buySell, realizedPnl, bookedAmount, bookedCosts, symbol };

    if (openClose.includes('open')) {
      openRows.push(entry);
    } else if (openClose.includes('close')) {
      closeRows.push(entry);
    } else {
      unknownRows.push(entry);
    }
  }

  logger.info(`[Saxo Transactions] OPEN rows: ${openRows.length}, CLOSE rows: ${closeRows.length}, Unknown: ${unknownRows.length}`);

  if (openRows.length === 0 && closeRows.length === 0) {
    warnings.push(`No OPEN/CLOSE rows found. Open/Close column: "${kOpenClose}". Unique values: ${[...new Set(filtered.map(r => r[kOpenClose]))].join(', ')}`);
  }

  // Group by instrument
  const byInstrument = {};
  for (const row of [...openRows, ...closeRows]) {
    if (!byInstrument[row.instrument]) byInstrument[row.instrument] = { opens: [], closes: [] };
  }
  for (const row of openRows) byInstrument[row.instrument].opens.push(row);
  for (const row of closeRows) byInstrument[row.instrument].closes.push(row);

  // FIFO match per instrument
  const trades = [];

  for (const [instrument, { opens, closes }] of Object.entries(byInstrument)) {
    // Sort by trade date
    opens.sort((a, b) => (a.tradeDate || '').localeCompare(b.tradeDate || ''));
    closes.sort((a, b) => (a.tradeDate || '').localeCompare(b.tradeDate || ''));

    // Resolve ticker: use Symbol column first, then TICKER_MAP, then fail explicitly
    const symbol = opens[0]?.symbol || closes[0]?.symbol;
    const ticker = symbol ? symbol.replace(/:.*$/, '').replace(/_NEW$/, '').toUpperCase()
      : lookupTicker(instrument);

    const missing = [];
    if (!ticker) missing.push('ticker');

    // FIFO matching
    let openIdx = 0;
    let openRemaining = 0;
    let currentOpen = null;

    let closeIdx = 0;

    while (openIdx < opens.length && closeIdx < closes.length) {
      if (!currentOpen) {
        currentOpen = opens[openIdx];
        openRemaining = currentOpen.qty;
      }

      const close = closes[closeIdx];
      const matchQty = Math.min(openRemaining, close.qty);
      const closeRemaining = close.qty - matchQty;

      const entryPrice = currentOpen.price;
      const exitPrice = close.price;

      // Calculate weighted commission from booked costs
      const openCostPer = (currentOpen.bookedCosts || currentOpen.bookedAmount || 0);
      const closeCostPer = (close.bookedCosts || close.bookedAmount || 0);
      const commission = Math.abs(openCostPer) + Math.abs(closeCostPer);

      // Use Saxo's realized P/L if available (more accurate), else calculate
      const pnlDollar = close.realizedPnl != null ? close.realizedPnl
        : +((exitPrice - entryPrice) * matchQty - commission).toFixed(4);
      const pnlPercent = entryPrice > 0 ? +(((exitPrice - entryPrice) / entryPrice) * 100).toFixed(2) : null;

      trades.push({
        instrument,
        ticker: ticker || '',
        productType: 'stock',
        side: currentOpen.buySell === 'sell' ? 'short' : 'long',
        qty: matchQty,
        entryPrice,
        exitPrice,
        pnlDollar,
        pnlPercent,
        commission: +commission.toFixed(4),
        openedAt: currentOpen.tradeDate,
        closedAt: close.tradeDate,
        currency: 'USD',
        missing: [...missing],
        status: 'complete',
      });

      openRemaining -= matchQty;
      if (openRemaining <= 0) {
        openIdx++;
        currentOpen = null;
        openRemaining = 0;
      }
      if (closeRemaining <= 0) {
        closeIdx++;
      } else {
        closes[closeIdx] = { ...close, qty: closeRemaining };
      }
    }

    // Unmatched opens → open trades
    if (currentOpen && openRemaining > 0) {
      trades.push({
        instrument, ticker: ticker || '', productType: 'stock',
        side: currentOpen.buySell === 'sell' ? 'short' : 'long',
        qty: openRemaining, entryPrice: currentOpen.price, exitPrice: null,
        pnlDollar: null, pnlPercent: null, commission: 0,
        openedAt: currentOpen.tradeDate, closedAt: null, currency: 'USD',
        missing: [...missing, 'exitPrice', 'closedAt'], status: 'incomplete',
      });
    }
    for (let i = openIdx + (currentOpen ? 1 : 0); i < opens.length; i++) {
      trades.push({
        instrument, ticker: ticker || '', productType: 'stock',
        side: opens[i].buySell === 'sell' ? 'short' : 'long',
        qty: opens[i].qty, entryPrice: opens[i].price, exitPrice: null,
        pnlDollar: null, pnlPercent: null, commission: 0,
        openedAt: opens[i].tradeDate, closedAt: null, currency: 'USD',
        missing: [...missing, 'exitPrice', 'closedAt'], status: 'incomplete',
      });
    }

    // Unmatched closes without opens
    for (let i = closeIdx; i < closes.length; i++) {
      trades.push({
        instrument, ticker: ticker || '', productType: 'stock',
        side: closes[i].buySell === 'buy' ? 'short' : 'long',
        qty: closes[i].qty, entryPrice: null, exitPrice: closes[i].price,
        pnlDollar: closes[i].realizedPnl, pnlPercent: null, commission: 0,
        openedAt: null, closedAt: closes[i].tradeDate, currency: 'USD',
        missing: [...missing, 'entryPrice', 'openedAt'], status: 'incomplete',
      });
    }
  }

  trades.sort((a, b) => (a.openedAt || '').localeCompare(b.openedAt || ''));
  logger.info(`[Saxo Transactions] Trades reconstructed: ${trades.length} (${trades.filter(t => t.status === 'complete').length} complete, ${trades.filter(t => t.status === 'incomplete').length} incomplete)`);

  return { trades, warnings };
}

// ═══════════════════════════════════════════════════════════════════
// SAXO CLOSED POSITIONS ADAPTER
// ═══════════════════════════════════════════════════════════════════
// "Closed positions" sheet/section with pre-matched trades:
//   Instrument | ClosePositionId | Close Type | Open date | Close Date |
//   Quantity | Open price | Close Price | Realized P/L

function adaptSaxoClosedPositions(rows) {
  const warnings = [];
  const trades = [];

  logger.info(`[Saxo Closed Positions] Processing ${rows.length} rows`);

  for (const row of rows) {
    const norm = normaliseRow(row);
    const instrument = (norm['instrument'] || '').toString().trim();
    if (!instrument || /^total$/i.test(instrument)) continue;

    const ticker = lookupTicker(instrument);
    const closeType = norm['close type'] || norm['closetype'] || 'Sell';
    const openDate = formatExcelDate(norm['open date'] || norm['opendate']);
    const closeDate = formatExcelDate(norm['close date'] || norm['closedate']);
    const qty = parseNum(norm['quantity']);
    const openPrice = parseNum(norm['open price'] || norm['openprice']);
    const closePrice = parseNum(norm['close price'] || norm['closeprice']);
    const openBooked = parseNum(norm['open booked amount'] || norm['openbookedamount']);
    const closeBooked = parseNum(norm['close booked amount'] || norm['closebookedamount']);
    const realizedPnl = parseNum(norm['realized p/l'] || norm['realized p&l'] || norm['realizedp/l'] || norm['realized pnl'] || norm['p/l'] || norm['pnl']);

    if (!openDate && !closeDate) {
      warnings.push(`Skipping "${instrument}": no dates found`);
      continue;
    }

    const missing = [];
    if (!ticker) missing.push('ticker');

    const pnlPercent = openPrice > 0
      ? +(((closePrice - openPrice) / openPrice) * 100).toFixed(2)
      : null;

    trades.push({
      instrument,
      ticker: ticker || '',
      productType: 'stock',
      side: /buy/i.test(closeType.toString()) ? 'short' : 'long',
      qty,
      entryPrice: openPrice,
      exitPrice: closePrice,
      pnlDollar: realizedPnl,
      commission: Math.abs((openBooked || 0) + (closeBooked || 0)),
      pnlPercent,
      openedAt: openDate,
      closedAt: closeDate,
      currency: 'GBP',
      missing,
      status: qty && openPrice && closePrice ? 'complete' : 'incomplete',
    });
  }

  logger.info(`[Saxo Closed Positions] Trades: ${trades.length}`);
  return { trades, warnings };
}

// ═══════════════════════════════════════════════════════════════════
// MANUAL CSV ADAPTER
// ═══════════════════════════════════════════════════════════════════
// Simple schema: ticker, qty, entry, exit, pnl, side, etc.

function adaptManualCsv(rows, headerKeys) {
  const warnings = [];
  const trades = [];

  const aliases = {
    ticker: ['ticker', 'symbol', 'stock', 'instrument'],
    side: ['side', 'direction', 'type', 'action'],
    qty: ['qty', 'quantity', 'shares', 'size', 'amount'],
    entryPrice: ['entry', 'entry_price', 'entryprice', 'buy_price', 'buyprice', 'open_price', 'openprice', 'open price', 'price'],
    exitPrice: ['exit', 'exit_price', 'exitprice', 'sell_price', 'sellprice', 'close_price', 'closeprice', 'close price'],
    pnlDollar: ['pnl', 'pnl_dollar', 'profit', 'profit_loss', 'pl', 'p&l', 'p/l', 'realized p/l', 'realized pnl'],
    commission: ['commission', 'fee', 'fees', 'cost', 'costs'],
    openedAt: ['opened_at', 'openedat', 'open_date', 'opendate', 'entry_date', 'entrydate', 'date', 'trade_date', 'open date'],
    closedAt: ['closed_at', 'closedat', 'close_date', 'closedate', 'exit_date', 'exitdate', 'close date'],
  };

  const colMap = {};
  const lowerHeaders = headerKeys.map(h => h.toLowerCase().trim());
  for (const [field, alts] of Object.entries(aliases)) {
    const match = lowerHeaders.find(h => alts.includes(h));
    if (match) colMap[field] = match;
  }

  logger.info(`[Manual CSV] Column mapping: ${JSON.stringify(colMap)}`);

  if (!colMap.ticker && !colMap.entryPrice) {
    warnings.push(`Could not map columns. Headers: [${headerKeys.join(', ')}]`);
    return { trades, warnings };
  }

  for (const row of rows) {
    const norm = normaliseRow(row);
    const get = (field) => colMap[field] ? norm[colMap[field]] : null;

    const rawTicker = (get('ticker') || '').toString().trim();
    const ticker = lookupTicker(rawTicker) || rawTicker.toUpperCase();
    if (!ticker || /^total$/i.test(ticker)) continue;

    const qty = parseNum(get('qty'));
    const entryPrice = parseNum(get('entryPrice'));
    const exitPrice = parseNum(get('exitPrice'));
    const pnlDollar = parseNum(get('pnlDollar'));
    const commission = parseNum(get('commission')) || 0;
    const openedAt = formatExcelDate(get('openedAt'));
    const closedAt = formatExcelDate(get('closedAt'));
    const sideRaw = (get('side') || 'long').toString().toLowerCase();

    const missing = [];
    if (!ticker) missing.push('ticker');
    if (!qty) missing.push('quantity');
    if (!entryPrice) missing.push('entryPrice');
    if (!exitPrice) missing.push('exitPrice');
    if (!openedAt) missing.push('openedAt');
    if (!closedAt) missing.push('closedAt');

    trades.push({
      instrument: rawTicker || ticker,
      ticker,
      productType: 'stock',
      side: sideRaw.includes('short') || sideRaw === 'sell' ? 'short' : 'long',
      qty, entryPrice, exitPrice, pnlDollar, pnlPercent: null,
      commission, openedAt, closedAt, currency: 'USD', missing,
      status: qty && entryPrice && exitPrice ? 'complete' : 'incomplete',
    });
  }

  return { trades, warnings };
}

// ═══════════════════════════════════════════════════════════════════
// EXCEL PARSER — entry point for .xls / .xlsx
// ═══════════════════════════════════════════════════════════════════

function parseExcel(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  logger.info(`[Excel] Sheets: ${workbook.SheetNames.join(', ')}`);

  const allTrades = [];
  const allWarnings = [];
  let detected = false;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
    if (rows.length === 0) {
      logger.info(`[Excel] Sheet "${sheetName}": empty, skipping`);
      continue;
    }

    const headers = Object.keys(rows[0]);
    logger.info(`[Excel] Sheet "${sheetName}": ${rows.length} rows, headers: ${JSON.stringify(headers)}`);

    // Log first 3 rows for debugging
    for (let i = 0; i < Math.min(3, rows.length); i++) {
      logger.info(`[Excel] Sheet "${sheetName}" row ${i}: ${JSON.stringify(rows[i])}`);
    }

    // Detect format
    if (detectSaxoTransactions(headers)) {
      logger.info(`[Excel] FORMAT DETECTED: Saxo Transactions in sheet "${sheetName}"`);
      const result = adaptSaxoTransactions(rows);
      allTrades.push(...result.trades);
      allWarnings.push(...result.warnings);
      detected = true;
      break; // Saxo Transactions is the full dataset
    }

    if (detectSaxoClosedPositions(headers)) {
      logger.info(`[Excel] FORMAT DETECTED: Saxo Closed Positions in sheet "${sheetName}"`);
      const result = adaptSaxoClosedPositions(rows);
      allTrades.push(...result.trades);
      allWarnings.push(...result.warnings);
      detected = true;
      continue; // May have more sheets
    }

    if (detectManualCsv(headers)) {
      logger.info(`[Excel] FORMAT DETECTED: Manual CSV format in sheet "${sheetName}"`);
      const result = adaptManualCsv(rows, headers);
      allTrades.push(...result.trades);
      allWarnings.push(...result.warnings);
      detected = true;
      continue;
    }
  }

  if (!detected) {
    const allHeaders = workbook.SheetNames.map(name => {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: null });
      return `Sheet "${name}": [${rows.length > 0 ? Object.keys(rows[0]).join(', ') : 'empty'}]`;
    });
    const msg = `Could not detect format.\n\nDetected headers:\n${allHeaders.join('\n')}\n\nSupported formats:\n- Saxo Transactions (Trade Date, Instrument, Open/Close, Quantity, Price)\n- Saxo Closed Positions (Instrument, ClosePositionId, Close Type, Open date)\n- Manual CSV (ticker/symbol, qty, entry, exit)`;
    throw new Error(msg);
  }

  return buildResult('excel', allTrades, allWarnings, 'GBP');
}

// ═══════════════════════════════════════════════════════════════════
// CSV PARSER — entry point for .csv text
// ═══════════════════════════════════════════════════════════════════

function parseCsv(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    return buildResult('csv', [], ['CSV has no data rows']);
  }

  // Parse into row objects using first line as headers
  const headerLine = lines[0];
  const headers = headerLine.split(',').map(h => h.trim().replace(/^['"]|['"]$/g, ''));

  logger.info(`[CSV] Headers: ${JSON.stringify(headers)}`);
  logger.info(`[CSV] Total rows: ${lines.length - 1}`);

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/^['"]|['"]$/g, ''));
    const row = {};
    headers.forEach((h, idx) => { row[h] = cols[idx] || null; });
    rows.push(row);
  }

  // Log first 3 rows
  for (let i = 0; i < Math.min(3, rows.length); i++) {
    logger.info(`[CSV] Row ${i}: ${JSON.stringify(rows[i])}`);
  }

  // Detect format
  if (detectSaxoTransactions(headers)) {
    logger.info(`[CSV] FORMAT DETECTED: Saxo Transactions`);
    const result = adaptSaxoTransactions(rows);
    return buildResult('saxo_transactions', result.trades, result.warnings);
  }

  if (detectSaxoClosedPositions(headers)) {
    logger.info(`[CSV] FORMAT DETECTED: Saxo Closed Positions`);
    const result = adaptSaxoClosedPositions(rows);
    return buildResult('saxo_closed_positions', result.trades, result.warnings, 'GBP');
  }

  if (detectManualCsv(headers)) {
    logger.info(`[CSV] FORMAT DETECTED: Manual CSV`);
    const result = adaptManualCsv(rows, headers);
    return buildResult('csv', result.trades, result.warnings);
  }

  // Format not detected — give detailed error
  const msg = `Could not detect CSV format.\n\nDetected headers:\n[${headers.join(', ')}]\n\nSupported formats:\n- Saxo Transactions (Trade Date, Instrument, Open/Close, Quantity, Price)\n- Saxo Closed Positions (Instrument, ClosePositionId, Close Type, Open date)\n- Manual CSV (ticker/symbol, qty, entry, exit)`;
  throw new Error(msg);
}

// ═══════════════════════════════════════════════════════════════════
// TEXT PARSER — auto-detect pasted text
// ═══════════════════════════════════════════════════════════════════

function parseText(text) {
  // Detect Saxo execution log format
  if (text.includes('trade executed to') && text.includes('Position')) {
    logger.info(`[Text] FORMAT DETECTED: Saxo Execution Log`);
    return parseSaxoExecutionLog(text);
  }

  // Try as CSV
  const firstLine = text.split('\n')[0].trim();
  if (firstLine.includes(',')) {
    logger.info(`[Text] Attempting CSV parse`);
    return parseCsv(text);
  }

  // Tab-separated? Convert to CSV
  if (firstLine.includes('\t')) {
    logger.info(`[Text] Detected tab-separated, converting to CSV`);
    const csvText = text.split('\n').map(l => l.split('\t').join(',')).join('\n');
    return parseCsv(csvText);
  }

  // Fallback: try Saxo execution log if it has Saxo-style dates
  if (/\d{1,2}-\w{3}-\d{4}/.test(text)) {
    logger.info(`[Text] Attempting Saxo Execution Log (date pattern detected)`);
    return parseSaxoExecutionLog(text);
  }

  throw new Error(`Could not detect format from pasted text.\n\nFirst line: "${firstLine.slice(0, 100)}"\n\nSupported formats:\n- Saxo Execution Logs (Position XXXX: Share trade executed to Buy ...)\n- CSV with headers (ticker, qty, entry, exit, etc.)\n- Tab-separated with headers`);
}

// ═══════════════════════════════════════════════════════════════════
// SAXO EXECUTION LOG TEXT PARSER
// ═══════════════════════════════════════════════════════════════════

function parseSaxoExecutionLog(text) {
  const executions = [];
  const warnings = [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  let currentDate = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const dateMatch = line.match(/^(\d{1,2}-\w{3}-\d{4})$/);
    if (dateMatch) {
      currentDate = parseSaxoDate(dateMatch[1]);
      continue;
    }

    const timeMatch = line.match(/^(\d{2}:\d{2}:\d{2})$/);
    if (timeMatch && currentDate) {
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const execLine = lines[j];
        const execMatch = execLine.match(
          /Position\s+(\d+):\s+(?:Share|CFD)\s+trade\s+executed\s+to\s+(Buy|Sell)\s+(\d+)\s+(\S+?)(?::x\w+)?\s+@\s+([\d.]+),\s*cost\s+([\d.]+)/i
        );
        if (execMatch) {
          const time = timeMatch[1];
          const ticker = execMatch[4].replace(/_NEW$/, '');
          executions.push({
            positionId: execMatch[1],
            date: currentDate,
            time,
            dateTime: `${currentDate}T${time}`,
            side: execMatch[2].toLowerCase(),
            qty: parseInt(execMatch[3]),
            ticker: ticker.toUpperCase(),
            price: parseFloat(execMatch[5]),
            cost: parseFloat(execMatch[6]),
            currency: 'USD',
            productType: execLine.includes('CFD trade') ? 'cfd' : 'stock',
          });
          break;
        }
      }
      continue;
    }
  }

  executions.sort((a, b) => a.dateTime.localeCompare(b.dateTime));
  logger.info(`[Saxo Execution Log] Executions parsed: ${executions.length}`);

  const trades = matchExecutionsToTrades(executions);

  return {
    ...buildResult('saxo_execution_log', trades, warnings),
    executions,
  };
}

function matchExecutionsToTrades(executions) {
  const byTicker = {};
  for (const exec of executions) {
    if (!byTicker[exec.ticker]) byTicker[exec.ticker] = [];
    byTicker[exec.ticker].push(exec);
  }

  const trades = [];

  for (const [ticker, execs] of Object.entries(byTicker)) {
    const buys = execs.filter(e => e.side === 'buy');
    const sells = execs.filter(e => e.side === 'sell');

    let buyIdx = 0;
    let sellIdx = 0;
    let buyRemaining = 0;
    let currentBuy = null;

    while (buyIdx < buys.length && sellIdx < sells.length) {
      if (!currentBuy) {
        currentBuy = { ...buys[buyIdx] };
        buyRemaining = currentBuy.qty;
      }

      const sell = sells[sellIdx];
      const matchQty = Math.min(buyRemaining, sell.qty);

      const entryPrice = currentBuy.price;
      const exitPrice = sell.price;
      const pnl = +(((exitPrice - entryPrice) * matchQty) - (currentBuy.cost + sell.cost)).toFixed(4);
      const pnlPercent = entryPrice > 0 ? +(((exitPrice - entryPrice) / entryPrice) * 100).toFixed(2) : null;

      trades.push({
        instrument: ticker, ticker, productType: currentBuy.productType,
        side: 'long', qty: matchQty, entryPrice, exitPrice,
        pnlDollar: pnl, pnlPercent,
        commission: +(currentBuy.cost + sell.cost).toFixed(4),
        openedAt: currentBuy.dateTime, closedAt: sell.dateTime,
        currency: 'USD', missing: [], status: 'complete',
      });

      buyRemaining -= matchQty;
      const sellRemaining = sell.qty - matchQty;

      if (buyRemaining <= 0) { buyIdx++; currentBuy = null; buyRemaining = 0; }
      if (sellRemaining <= 0) { sellIdx++; }
      else { sells[sellIdx] = { ...sell, qty: sellRemaining }; }
    }

    // Unmatched buys
    if (currentBuy && buyRemaining > 0) {
      trades.push({
        instrument: ticker, ticker, productType: currentBuy.productType,
        side: 'long', qty: buyRemaining, entryPrice: currentBuy.price, exitPrice: null,
        pnlDollar: null, pnlPercent: null, commission: currentBuy.cost,
        openedAt: currentBuy.dateTime, closedAt: null, currency: 'USD',
        missing: ['exitPrice', 'closedAt'], status: 'incomplete',
      });
    }
    for (let i = buyIdx + (currentBuy ? 1 : 0); i < buys.length; i++) {
      trades.push({
        instrument: ticker, ticker, productType: buys[i].productType,
        side: 'long', qty: buys[i].qty, entryPrice: buys[i].price, exitPrice: null,
        pnlDollar: null, pnlPercent: null, commission: buys[i].cost,
        openedAt: buys[i].dateTime, closedAt: null, currency: 'USD',
        missing: ['exitPrice', 'closedAt'], status: 'incomplete',
      });
    }

    // Unmatched sells
    for (let i = sellIdx; i < sells.length; i++) {
      trades.push({
        instrument: ticker, ticker, productType: sells[i].productType,
        side: 'short', qty: sells[i].qty, entryPrice: sells[i].price, exitPrice: null,
        pnlDollar: null, pnlPercent: null, commission: sells[i].cost,
        openedAt: sells[i].dateTime, closedAt: null, currency: 'USD',
        missing: ['exitPrice', 'closedAt'], status: 'incomplete',
      });
    }
  }

  trades.sort((a, b) => (a.openedAt || '').localeCompare(b.openedAt || ''));
  return trades;
}

// ═══════════════════════════════════════════════════════════════════
// PDF PARSER
// ═══════════════════════════════════════════════════════════════════

async function parsePdf(buffer) {
  const parser = new PDFParse({ data: buffer, verbosity: 0 });
  await parser.load();
  const result = await parser.getText();
  await parser.destroy();
  logger.info(`[PDF] Parsed: ${result.total} pages, ${result.text.length} chars`);
  return parseSaxoPortfolioPdf(result.text);
}

function parseSaxoPortfolioPdf(text) {
  const trades = [];
  const holdings = [];
  const warnings = [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const isSaxo = text.includes('Saxo Capital Markets') || text.includes('SAXO');
  if (!isSaxo) warnings.push('PDF does not appear to be from Saxo. Parsing may be inaccurate.');

  const currencyMatch = text.match(/Currency:\s*(\w{3})/);
  const currency = currencyMatch ? currencyMatch[1] : 'GBP';

  const periodMatch = text.match(/Reporting period[:\s]*(\d{2}-\w{3}-\d{4})\s*[-–]\s*(\d{2}-\w{3}-\d{4})/);
  const reportPeriod = periodMatch ? { from: periodMatch[1], to: periodMatch[2] } : null;

  // Try: extract "Closed positions" table
  const closedPositions = extractClosedPositions(lines);

  if (closedPositions.length > 0) {
    for (const cp of closedPositions) {
      const ticker = lookupTicker(cp.instrument);
      const missing = [];
      if (!ticker) missing.push('ticker');

      const pnlPercent = cp.openPrice > 0
        ? +(((cp.closePrice - cp.openPrice) / cp.openPrice) * 100).toFixed(2) : null;

      trades.push({
        instrument: cp.instrument, ticker: ticker || '',
        productType: cp.productType || 'stock',
        side: cp.closeType === 'Buy' ? 'short' : 'long',
        qty: cp.qty, entryPrice: cp.openPrice, exitPrice: cp.closePrice,
        pnlDollar: cp.realizedPnl,
        commission: Math.abs((cp.openBookedAmount || 0) + (cp.closeBookedAmount || 0)),
        pnlPercent, openedAt: cp.openDate, closedAt: cp.closeDate,
        currency, missing, status: 'complete',
      });
    }
  } else {
    // Fallback: P/L breakdown
    const plSection = extractPlBreakdown(lines);
    for (const item of plSection) {
      const ticker = lookupTicker(item.instrument);
      const missing = [];
      if (!ticker) missing.push('ticker');
      if (!item.qty) missing.push('quantity');
      if (!item.entryPrice) missing.push('entryPrice');
      if (!item.exitPrice) missing.push('exitPrice');
      if (!item.openedAt) missing.push('openedAt');
      if (!item.closedAt) missing.push('closedAt');

      trades.push({
        instrument: item.instrument, ticker: ticker || '',
        productType: item.productType || 'stock', side: 'long',
        qty: item.qty || null, entryPrice: item.entryPrice || null, exitPrice: item.exitPrice || null,
        pnlDollar: item.pnl, commission: Math.abs(item.costs || 0),
        pnlPercent: item.returnPct || null, openedAt: item.openedAt || null, closedAt: item.closedAt || null,
        currency, missing,
        status: item.qty && item.entryPrice && item.exitPrice ? 'complete' : 'incomplete',
      });
    }
  }

  // Holdings
  const holdingsData = extractHoldings(lines);
  for (const h of holdingsData) {
    const ticker = lookupTicker(h.instrument);
    const existingTrade = trades.find(t => t.instrument === h.instrument);
    if (existingTrade) {
      if (h.qty) existingTrade.qty = h.qty;
      if (h.openPrice) existingTrade.entryPrice = h.openPrice;
      if (h.currentPrice) existingTrade.exitPrice = h.currentPrice;
      existingTrade.missing = existingTrade.missing.filter(
        m => !(m === 'quantity' && h.qty) && !(m === 'entryPrice' && h.openPrice) && !(m === 'exitPrice' && h.currentPrice)
      );
      if (existingTrade.qty && existingTrade.entryPrice) {
        existingTrade.status = existingTrade.exitPrice ? 'complete' : 'incomplete';
      }
    } else {
      const missing = [];
      if (!ticker) missing.push('ticker');
      if (!h.openedAt) missing.push('openedAt');
      holdings.push({
        instrument: h.instrument, ticker: ticker || '',
        qty: h.qty, entryPrice: h.openPrice, currentPrice: h.currentPrice,
        unrealizedPnl: h.unrealizedPnl, currency: h.instrumentCurrency || currency,
        missing, status: 'open',
      });
    }
  }

  const totalPnl = trades.reduce((s, t) => s + (t.pnlDollar || 0), 0);
  const totalCosts = trades.reduce((s, t) => s + (t.commission || 0), 0);

  return {
    broker: 'saxo', currency, reportPeriod, trades, holdings, warnings,
    summary: {
      totalPnl: +totalPnl.toFixed(2), totalCosts: +totalCosts.toFixed(2),
      tradeCount: trades.length, holdingsCount: holdings.length,
      completeCount: trades.filter(t => t.status === 'complete').length,
      incompleteCount: trades.filter(t => t.status === 'incomplete').length,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// PDF sub-parsers (Closed Positions, P/L Breakdown, Holdings)
// ═══════════════════════════════════════════════════════════════════

function extractClosedPositions(lines) {
  const items = [];
  let inSection = false;
  let productType = 'stock';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^Closed positions$/i.test(line)) { inSection = true; continue; }
    if (inSection && /^Stocks$/i.test(line)) { productType = 'stock'; continue; }
    if (inSection && /^CFDs$/i.test(line)) { productType = 'cfd'; continue; }
    if (inSection && /^(Transactions|Holdings|Cash|Cost summary|Account Summary|Account value|Non Instrument Related)/i.test(line)) { inSection = false; continue; }
    if (!inSection) continue;
    if (/^(Instrument|ClosePositionId|Close Type|Open date|Close Date|Quantity|Open price|Close Price|Total)/i.test(line)) continue;

    // Single-line match
    const match = line.match(
      /^(.+?)\s+(\d{8,12})\s+(Buy|Sell)\s+(\d{1,2}-\w{3}-\d{4})\s+(\d{1,2}-\w{3}-\d{4})\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)\s+([-\d,.]+)\s+([-\d,.]+)\s+([-\d,.]+)/i
    );
    if (match) {
      items.push({
        instrument: match[1].trim(), positionId: match[2], closeType: match[3],
        openDate: parseSaxoDate(match[4]), closeDate: parseSaxoDate(match[5]),
        qty: parseFloat(match[6].replace(',', '')),
        openPrice: parseFloat(match[7].replace(',', '')),
        closePrice: parseFloat(match[8].replace(',', '')),
        openBookedAmount: parseFloat(match[9].replace(',', '')),
        closeBookedAmount: parseFloat(match[10].replace(',', '')),
        realizedPnl: parseFloat(match[11].replace(',', '')),
        productType,
      });
      continue;
    }

    // Multi-line: instrument name then data
    if (/^[A-Za-z]/.test(line) && line.length > 3 && !/^(Total|Grand|Instrument|Open|Close|Quantity|Realized)/i.test(line)) {
      const nextLines = lines.slice(i + 1, i + 4).join(' ');
      const dataMatch = nextLines.match(
        /(\d{8,12})\s+(Buy|Sell)\s+(\d{1,2}-\w{3}-\d{4})\s+(\d{1,2}-\w{3}-\d{4})\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)\s+([-\d,.]+)\s+([-\d,.]+)\s+([-\d,.]+)/i
      );
      if (dataMatch) {
        items.push({
          instrument: line.trim(), positionId: dataMatch[1], closeType: dataMatch[2],
          openDate: parseSaxoDate(dataMatch[3]), closeDate: parseSaxoDate(dataMatch[4]),
          qty: parseFloat(dataMatch[5].replace(',', '')),
          openPrice: parseFloat(dataMatch[6].replace(',', '')),
          closePrice: parseFloat(dataMatch[7].replace(',', '')),
          openBookedAmount: parseFloat(dataMatch[8].replace(',', '')),
          closeBookedAmount: parseFloat(dataMatch[9].replace(',', '')),
          realizedPnl: parseFloat(dataMatch[10].replace(',', '')),
          productType,
        });
        i += 3;
        continue;
      }
    }
  }
  return items;
}

function extractPlBreakdown(lines) {
  const items = [];
  let productType = 'stock';
  let inSection = false;

  for (const line of lines) {
    if (/^CFDs$/i.test(line)) { productType = 'cfd'; inSection = true; continue; }
    if (/^Stocks$/i.test(line)) { productType = 'stock'; inSection = true; continue; }
    if (/^(Non Instrument Related|Holdings|Cost summary|Account Summary|Account value)/i.test(line)) { inSection = false; continue; }
    if (/^(Total|Grand Total)$/i.test(line)) continue;
    if (!inSection) continue;
    if (/^(Instrument|Income|Costs|P\/L|% Return|Product type)/i.test(line)) continue;

    const match = line.match(/^(.+?)\s+([\d.,-]+)\s+([\d.,-]+)\s+([\d.,-]+)(?:\s+([\d.,-]+)\s*%)?/);
    if (match) {
      const instrument = match[1].replace(/\s*-\s*(ADR|ISIN:.*)$/, '').trim();
      if (/^\d/.test(instrument) || instrument.length < 3 || /^total$/i.test(instrument)) continue;
      items.push({
        instrument, productType,
        income: parseFloat(match[2].replace(',', '')),
        costs: parseFloat(match[3].replace(',', '')),
        pnl: parseFloat(match[4].replace(',', '')),
        returnPct: match[5] ? parseFloat(match[5].replace(',', '')) : null,
        qty: null, entryPrice: null, exitPrice: null, openedAt: null, closedAt: null,
      });
    }
  }
  return items;
}

function extractHoldings(lines) {
  const items = [];
  let inHoldings = false;
  let inStocks = false;

  for (const line of lines) {
    if (/^Holdings/i.test(line)) { inHoldings = true; continue; }
    if (inHoldings && /^Stocks$/i.test(line)) { inStocks = true; continue; }
    if (/^(Cash|Cost summary|Cost explanation)/i.test(line)) { inHoldings = false; inStocks = false; continue; }
    if (/^(Instrument|currency|Total)$/i.test(line)) continue;
    if (!inStocks) continue;

    const match = line.match(/^(.+?)\s+(?:\(ISIN:\s*\S+\)\s+)?(\w{3})\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([-\d.]+)%?\s+([-\d.]+)\s+([\d.]+)/);
    if (match) {
      items.push({
        instrument: match[1].replace(/\s*\(ISIN:.*?\)/, '').trim(),
        instrumentCurrency: match[2], qty: parseInt(match[3]),
        conversionRate: parseFloat(match[4]), openPrice: parseFloat(match[5]),
        currentPrice: parseFloat(match[6]), priceChangePct: parseFloat(match[7]),
        unrealizedPnl: parseFloat(match[8]), marketValue: parseFloat(match[9]),
      });
    }
  }
  return items;
}

// ═══════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════

module.exports = { parsePdf, parseExcel, parseSaxoPortfolioPdf, parseSaxoExecutionLog, parseCsv, parseText };
