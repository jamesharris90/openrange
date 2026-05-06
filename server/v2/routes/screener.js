const express = require('express');
const { getLatestScreenerPayload } = require('../services/snapshotService');
const { getTrustedSymbols } = require('../../services/dataTrustService');

const router = express.Router();

function buildWeakEtag(parts = []) {
  const value = parts.filter((part) => part !== null && part !== undefined && part !== '').join(':');
  return `W/"${value || 'empty'}"`;
}

function matchesEtag(headerValue, etag) {
  if (!headerValue || !etag) {
    return false;
  }

  return String(headerValue)
    .split(',')
    .map((value) => value.trim())
    .includes(etag);
}

function applyCacheHeaders(res, etag) {
  res.set('Cache-Control', 'private, no-cache');
  if (etag) {
    res.set('ETag', etag);
  }
}

router.get('/', async (req, res) => {
  console.time('screener_query');
  const startedAt = Date.now();
  try {
    const payload = await getLatestScreenerPayload();
    const trustedOnly = /^(1|true|yes)$/i.test(String(req.query.trusted_only || ''));
    const hasLimitParam = req.query.limit != null;
    const hasOffsetParam = req.query.offset != null;
    const requestedLimit = Number(req.query.limit);
    const requestedOffset = Number(req.query.offset);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(Math.trunc(requestedLimit), 1000)) : null;
    const offset = Number.isFinite(requestedOffset) ? Math.max(0, Math.trunc(requestedOffset)) : 0;

    if (trustedOnly && Array.isArray(payload?.data)) {
      const trustedSymbols = await getTrustedSymbols(payload.data.map((row) => row?.symbol).filter(Boolean));
      payload.data = payload.data.filter((row) => trustedSymbols.has(String(row?.symbol || '').toUpperCase()));
      payload.count = payload.data.length;
      payload.total = payload.data.length;
      payload.meta = {
        ...(payload.meta || {}),
        trusted_only: true,
      };
    }

    if (Array.isArray(payload?.data) && (hasLimitParam || hasOffsetParam)) {
      const total = payload.data.length;
      const pagedRows = payload.data.slice(offset, limit ? offset + limit : undefined);
      payload.data = pagedRows;
      payload.count = pagedRows.length;
      payload.total = total;
      payload.meta = {
        ...(payload.meta || {}),
        pagination: {
          limit: limit || total,
          offset,
          returned: pagedRows.length,
          total,
        },
      };
    }

    const rawUniverseSize = Number(payload?.meta?.raw_universe_size || 0);
    if (rawUniverseSize > 0) {
      console.log('[SCREENER_ROUTE] Universe size:', rawUniverseSize);
    }

    const etag = buildWeakEtag([
      'screener',
      payload?.snapshot_at || payload?.status || 'no_snapshot',
      trustedOnly ? 'trusted' : 'all',
      hasLimitParam ? String(limit || 'none') : 'all',
      String(offset),
    ]);
    applyCacheHeaders(res, etag);
    if (matchesEtag(req.headers['if-none-match'], etag)) {
      return res.status(304).end();
    }

    console.log('[SCREENER_ROUTE] response_ms:', Date.now() - startedAt);
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  } finally {
    console.timeEnd('screener_query');
  }
});

module.exports = router;