const { queryWithTimeout } = require('../db/pg');

const TICKER_CLASSIFICATIONS_TABLE = 'ticker_classifications';

const STOCK_CLASSIFICATIONS = Object.freeze({
  COMMON_STOCK: 'COMMON_STOCK',
  SPAC_SHELL: 'SPAC_SHELL',
  UNITS_WARRANTS_RIGHTS: 'UNITS_WARRANTS_RIGHTS',
  PREFERRED_NOTES: 'PREFERRED_NOTES',
  ETF_FUND_TRUST: 'ETF_FUND_TRUST',
  PENNY_STOCK: 'PENNY_STOCK',
  OTHER: 'OTHER',
});

const INSTRUMENT_DETAILS = Object.freeze({
  COMMON_STOCK: 'COMMON_STOCK',
  ADR: 'ADR',
  REIT: 'REIT',
  ETF: 'ETF',
  CLOSED_END_FUND: 'CLOSED_END_FUND',
  FUND: 'FUND',
  TRUST: 'TRUST',
  UNIT: 'UNIT',
  WARRANT: 'WARRANT',
  RIGHT: 'RIGHT',
  PREFERRED: 'PREFERRED',
  NOTE: 'NOTE',
  SPAC_COMMON: 'SPAC_COMMON',
  OTHER: 'OTHER',
});

const LISTING_TYPES = Object.freeze({
  COMMON_STOCK: 'COMMON_STOCK',
  UNIT: 'UNIT',
  WARRANT: 'WARRANT',
  RIGHT: 'RIGHT',
  PREFERRED: 'PREFERRED',
  NOTE: 'NOTE',
  ETF: 'ETF',
  FUND: 'FUND',
  TRUST: 'TRUST',
  OTHER: 'OTHER',
});

let ensureSchemaPromise = null;

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase();
}

function toNullableString(value) {
  const text = String(value || '').trim();
  return text || null;
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getListingType(symbol, companyName = '', industry = '') {
  const source = `${companyName} ${industry}`.toUpperCase();

  if (/\bWARRANT(S)?\b/.test(source)) {
    return LISTING_TYPES.WARRANT;
  }
  if (/\bRIGHT(S)?\b/.test(source)) {
    return LISTING_TYPES.RIGHT;
  }
  if (/\bUNIT(S)?\b/.test(source)) {
    return LISTING_TYPES.UNIT;
  }
  if (/\bPREFERRED\b|\bDEPOSITARY\b/.test(source)) {
    return LISTING_TYPES.PREFERRED;
  }
  if (/\bNOTE(S)?\b|\bDEBENTURE(S)?\b/.test(source)) {
    return LISTING_TYPES.NOTE;
  }
  if (/\bETF\b/.test(source)) {
    return LISTING_TYPES.ETF;
  }
  if (/\bFUND\b/.test(source)) {
    return LISTING_TYPES.FUND;
  }
  if (/\bTRUST\b/.test(source)) {
    return LISTING_TYPES.TRUST;
  }

  const upperSymbol = normalizeSymbol(symbol);
  if (/U$/.test(upperSymbol) && /ACQUISITION|UNIT/.test(source)) {
    return LISTING_TYPES.UNIT;
  }
  if (/W$/.test(upperSymbol) && /ACQUISITION|WARRANT/.test(source)) {
    return LISTING_TYPES.WARRANT;
  }
  if (/R$/.test(upperSymbol) && /ACQUISITION|RIGHT/.test(source)) {
    return LISTING_TYPES.RIGHT;
  }

  return LISTING_TYPES.COMMON_STOCK;
}

function getInstrumentDetail(symbol, companyName = '', industry = '', sector = '', exchange = '') {
  const combined = `${companyName} ${industry} ${sector} ${exchange}`.toUpperCase();
  const listingType = getListingType(symbol, companyName, industry);

  if (/\bADR\b|\bADS\b|\bDEPOSITARY RECEIPT\b/.test(combined)) {
    return INSTRUMENT_DETAILS.ADR;
  }

  if (/\bREIT\b|\bREAL ESTATE INVESTMENT TRUST\b/.test(combined)) {
    return INSTRUMENT_DETAILS.REIT;
  }

  if (/\bETF\b|\bEXCHANGE TRADED FUND\b|\bEXCHANGE-TRADED FUND\b|\bINDEX FUND\b/.test(combined)) {
    return INSTRUMENT_DETAILS.ETF;
  }

  if (/\bCLOSED-END FUND\b|\bCLOSED END FUND\b/.test(combined)) {
    return INSTRUMENT_DETAILS.CLOSED_END_FUND;
  }

  if (/\bTRUST\b/.test(combined)) {
    return INSTRUMENT_DETAILS.TRUST;
  }

  if (/\bFUND\b/.test(combined)) {
    return INSTRUMENT_DETAILS.FUND;
  }

  if (/\bACQUISITION\b|\bBLANK CHECK\b|\bSPECIAL PURPOSE\b|\bSHELL\b/.test(combined) && listingType === LISTING_TYPES.COMMON_STOCK) {
    return INSTRUMENT_DETAILS.SPAC_COMMON;
  }

  if (listingType === LISTING_TYPES.UNIT) return INSTRUMENT_DETAILS.UNIT;
  if (listingType === LISTING_TYPES.WARRANT) return INSTRUMENT_DETAILS.WARRANT;
  if (listingType === LISTING_TYPES.RIGHT) return INSTRUMENT_DETAILS.RIGHT;
  if (listingType === LISTING_TYPES.PREFERRED) return INSTRUMENT_DETAILS.PREFERRED;
  if (listingType === LISTING_TYPES.NOTE) return INSTRUMENT_DETAILS.NOTE;

  return INSTRUMENT_DETAILS.COMMON_STOCK;
}

function getInstrumentDetailLabel(detail) {
  switch (detail) {
    case INSTRUMENT_DETAILS.ADR:
      return 'ADR';
    case INSTRUMENT_DETAILS.REIT:
      return 'REIT';
    case INSTRUMENT_DETAILS.ETF:
      return 'ETF';
    case INSTRUMENT_DETAILS.CLOSED_END_FUND:
      return 'Closed-End Fund';
    case INSTRUMENT_DETAILS.FUND:
      return 'Fund';
    case INSTRUMENT_DETAILS.TRUST:
      return 'Trust';
    case INSTRUMENT_DETAILS.UNIT:
      return 'Unit';
    case INSTRUMENT_DETAILS.WARRANT:
      return 'Warrant';
    case INSTRUMENT_DETAILS.RIGHT:
      return 'Right';
    case INSTRUMENT_DETAILS.PREFERRED:
      return 'Preferred';
    case INSTRUMENT_DETAILS.NOTE:
      return 'Note';
    case INSTRUMENT_DETAILS.SPAC_COMMON:
      return 'SPAC Common';
    default:
      return 'Common Stock';
  }
}

function classifyTickerRecord(record = {}) {
  const symbol = normalizeSymbol(record.symbol);
  const companyName = toNullableString(record.company_name) || '';
  const industry = toNullableString(record.industry) || '';
  const sector = toNullableString(record.sector);
  const exchange = toNullableString(record.exchange);
  const price = toNullableNumber(record.price);
  const listingType = getListingType(symbol, companyName, industry);
  const instrumentDetail = getInstrumentDetail(symbol, companyName, industry, sector, exchange);
  const source = `${companyName} ${industry}`.toUpperCase();

  let stockClassification = STOCK_CLASSIFICATIONS.COMMON_STOCK;
  let classificationLabel = 'Common Stock';
  let classificationReason = 'This ticker is listed as a common stock, so any missing data is more likely a provider coverage gap than a special instrument limitation.';

  if ([LISTING_TYPES.UNIT, LISTING_TYPES.WARRANT, LISTING_TYPES.RIGHT].includes(listingType)) {
    stockClassification = STOCK_CLASSIFICATIONS.UNITS_WARRANTS_RIGHTS;
    classificationLabel = 'Unit / Warrant / Right';
    classificationReason = 'This ticker is a unit, warrant, or rights listing rather than a standard common stock, so research coverage is intentionally thinner.';
  } else if ([LISTING_TYPES.PREFERRED, LISTING_TYPES.NOTE].includes(listingType)) {
    stockClassification = STOCK_CLASSIFICATIONS.PREFERRED_NOTES;
    classificationLabel = 'Preferred / Note';
    classificationReason = 'This ticker is a preferred share or note-style listing, which typically receives less catalyst and market-structure coverage than common stock.';
  } else if ([LISTING_TYPES.ETF, LISTING_TYPES.FUND, LISTING_TYPES.TRUST].includes(listingType)) {
    stockClassification = STOCK_CLASSIFICATIONS.ETF_FUND_TRUST;
    classificationLabel = 'ETF / Fund / Trust';
    classificationReason = 'This ticker is an ETF, fund, or trust product, so company-specific catalyst coverage may be limited or not applicable.';
  } else if (/\bACQUISITION\b|\bBLANK CHECK\b|\bSPECIAL PURPOSE\b|\bSHELL\b/.test(source)) {
    stockClassification = STOCK_CLASSIFICATIONS.SPAC_SHELL;
    classificationLabel = 'SPAC / Shell';
    classificationReason = 'This ticker is classified as a SPAC or shell company, so direct catalyst, fundamentals, and structured coverage are often limited.';
  } else if (price !== null && price < 5) {
    stockClassification = STOCK_CLASSIFICATIONS.PENNY_STOCK;
    classificationLabel = 'Penny Stock';
    classificationReason = 'This ticker trades below $5, so upstream provider coverage and structured market data are often less complete.';
  } else if (!companyName && !industry && !sector) {
    stockClassification = STOCK_CLASSIFICATIONS.OTHER;
    classificationLabel = 'Other Listing';
    classificationReason = 'This ticker could not be classified cleanly from the available instrument metadata, so data gaps may reflect limited upstream coverage.';
  }

  return {
    symbol,
    stock_classification: stockClassification,
    classification_label: classificationLabel,
    classification_reason: classificationReason,
    listing_type: listingType,
    instrument_detail: instrumentDetail,
    instrument_detail_label: getInstrumentDetailLabel(instrumentDetail),
    source: 'heuristic_v1',
    exchange,
    company_name: companyName || null,
    sector,
    industry: industry || null,
    price,
  };
}

function normalizeTickerClassificationRecord(row = {}, fallback = {}) {
  const normalized = {
    stock_classification: toNullableString(row.stock_classification) || null,
    stock_classification_label: toNullableString(row.classification_label) || null,
    stock_classification_reason: toNullableString(row.classification_reason) || null,
    listing_type: toNullableString(row.listing_type) || null,
    instrument_detail: toNullableString(row.instrument_detail) || null,
    instrument_detail_label: toNullableString(row.instrument_detail_label) || null,
  };

  if (!normalized.stock_classification) {
    const derived = classifyTickerRecord(fallback);
    normalized.stock_classification = derived.stock_classification;
    normalized.stock_classification_label = derived.classification_label;
    normalized.stock_classification_reason = derived.classification_reason;
    normalized.listing_type = derived.listing_type;
    normalized.instrument_detail = derived.instrument_detail;
    normalized.instrument_detail_label = derived.instrument_detail_label;
  }

  return normalized;
}

async function ensureTickerClassificationSchema() {
  if (!ensureSchemaPromise) {
    ensureSchemaPromise = (async () => {
      await queryWithTimeout(
        `CREATE TABLE IF NOT EXISTS public.${TICKER_CLASSIFICATIONS_TABLE} (
           symbol TEXT PRIMARY KEY,
           stock_classification TEXT NOT NULL,
           classification_label TEXT NOT NULL,
           classification_reason TEXT NOT NULL,
           listing_type TEXT NOT NULL,
            instrument_detail TEXT NOT NULL DEFAULT 'COMMON_STOCK',
            instrument_detail_label TEXT NOT NULL DEFAULT 'Common Stock',
           source TEXT NOT NULL DEFAULT 'heuristic_v1',
           updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
         )`,
        [],
        {
          timeoutMs: 3000,
          label: 'ticker_classification.ensure_table',
          maxRetries: 0,
          poolType: 'write',
        }
      );

      await queryWithTimeout(
        `ALTER TABLE public.${TICKER_CLASSIFICATIONS_TABLE}
           ADD COLUMN IF NOT EXISTS instrument_detail TEXT NOT NULL DEFAULT 'COMMON_STOCK'`,
        [],
        {
          timeoutMs: 3000,
          label: 'ticker_classification.ensure_instrument_detail',
          maxRetries: 0,
          poolType: 'write',
        }
      );

      await queryWithTimeout(
        `ALTER TABLE public.${TICKER_CLASSIFICATIONS_TABLE}
           ADD COLUMN IF NOT EXISTS instrument_detail_label TEXT NOT NULL DEFAULT 'Common Stock'`,
        [],
        {
          timeoutMs: 3000,
          label: 'ticker_classification.ensure_instrument_detail_label',
          maxRetries: 0,
          poolType: 'write',
        }
      );

      await queryWithTimeout(
        `CREATE INDEX IF NOT EXISTS idx_ticker_classifications_classification
           ON public.${TICKER_CLASSIFICATIONS_TABLE} (stock_classification)`,
        [],
        {
          timeoutMs: 3000,
          label: 'ticker_classification.ensure_idx_classification',
          maxRetries: 0,
          poolType: 'write',
        }
      );

      await queryWithTimeout(
        `CREATE INDEX IF NOT EXISTS idx_ticker_classifications_listing_type
           ON public.${TICKER_CLASSIFICATIONS_TABLE} (listing_type)`,
        [],
        {
          timeoutMs: 3000,
          label: 'ticker_classification.ensure_idx_listing_type',
          maxRetries: 0,
          poolType: 'write',
        }
      );
    })().catch((error) => {
      ensureSchemaPromise = null;
      throw error;
    });
  }

  return ensureSchemaPromise;
}

async function upsertTickerClassifications(records = []) {
  const payload = records
    .map((record) => classifyTickerRecord(record))
    .filter((record) => record.symbol);

  if (!payload.length) {
    return 0;
  }

  await ensureTickerClassificationSchema();

  const result = await queryWithTimeout(
    `WITH payload AS (
       SELECT *
       FROM json_to_recordset($1::json) AS x(
         symbol text,
         stock_classification text,
         classification_label text,
         classification_reason text,
         listing_type text,
         instrument_detail text,
         instrument_detail_label text,
         source text,
         exchange text,
         company_name text,
         sector text,
         industry text,
         price numeric
       )
     ), upserted AS (
       INSERT INTO public.${TICKER_CLASSIFICATIONS_TABLE} (
         symbol,
         stock_classification,
         classification_label,
         classification_reason,
         listing_type,
         instrument_detail,
         instrument_detail_label,
         source,
         updated_at
       )
       SELECT
         symbol,
         stock_classification,
         classification_label,
         classification_reason,
         listing_type,
         instrument_detail,
         instrument_detail_label,
         source,
         NOW()
       FROM payload
       WHERE NULLIF(BTRIM(symbol), '') IS NOT NULL
       ON CONFLICT (symbol)
       DO UPDATE SET
         stock_classification = EXCLUDED.stock_classification,
         classification_label = EXCLUDED.classification_label,
         classification_reason = EXCLUDED.classification_reason,
         listing_type = EXCLUDED.listing_type,
         instrument_detail = EXCLUDED.instrument_detail,
         instrument_detail_label = EXCLUDED.instrument_detail_label,
         source = EXCLUDED.source,
         updated_at = NOW()
       RETURNING 1
     )
     SELECT COUNT(*)::int AS upserted FROM upserted`,
    [JSON.stringify(payload)],
    {
      timeoutMs: 5000,
      label: 'ticker_classification.upsert',
      maxRetries: 0,
      poolType: 'write',
    }
  );

  return Number(result.rows?.[0]?.upserted || 0);
}

module.exports = {
  TICKER_CLASSIFICATIONS_TABLE,
  STOCK_CLASSIFICATIONS,
  LISTING_TYPES,
  INSTRUMENT_DETAILS,
  classifyTickerRecord,
  normalizeTickerClassificationRecord,
  ensureTickerClassificationSchema,
  upsertTickerClassifications,
};