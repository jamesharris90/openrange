const { pool } = require('../db/pg');

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const ALLOWED_EXCHANGES = new Set(['NASDAQ', 'NYSE', 'AMEX', 'CBOE']);

function validatePresetData(data) {
  const errors = [];

  if (data.name !== undefined && (typeof data.name !== 'string' || !data.name.trim())) {
    errors.push('name must be a non-empty string');
  }
  if (data.minPrice !== undefined && data.minPrice !== null && isNaN(Number(data.minPrice))) {
    errors.push('minPrice must be a number or null');
  }
  if (data.maxPrice !== undefined && data.maxPrice !== null && isNaN(Number(data.maxPrice))) {
    errors.push('maxPrice must be a number or null');
  }
  if (data.minMarketCap !== undefined && data.minMarketCap !== null && isNaN(Number(data.minMarketCap))) {
    errors.push('minMarketCap must be a number or null');
  }
  if (data.maxMarketCap !== undefined && data.maxMarketCap !== null && isNaN(Number(data.maxMarketCap))) {
    errors.push('maxMarketCap must be a number or null');
  }
  if (data.exchanges !== undefined) {
    if (!Array.isArray(data.exchanges)) {
      errors.push('exchanges must be an array');
    } else {
      const bad = data.exchanges.filter(e => !ALLOWED_EXCHANGES.has(String(e).toUpperCase()));
      if (bad.length) errors.push(`unknown exchanges: ${bad.join(', ')}`);
    }
  }
  if (data.sectors !== undefined && data.sectors !== null && !Array.isArray(data.sectors)) {
    errors.push('sectors must be an array or null');
  }

  return errors;
}

function sanitizePreset(data) {
  return {
    name: data.name ? String(data.name).trim() : undefined,
    minPrice: data.minPrice != null ? Number(data.minPrice) : null,
    maxPrice: data.maxPrice != null ? Number(data.maxPrice) : null,
    minMarketCap: data.minMarketCap != null ? Number(data.minMarketCap) : null,
    maxMarketCap: data.maxMarketCap != null ? Number(data.maxMarketCap) : null,
    exchanges: Array.isArray(data.exchanges)
      ? data.exchanges.map(e => String(e).toUpperCase())
      : undefined,
    sectors: Array.isArray(data.sectors) ? data.sectors : null,
    includeEtfs: data.includeEtfs != null ? Boolean(data.includeEtfs) : undefined,
    includeSpacs: data.includeSpacs != null ? Boolean(data.includeSpacs) : undefined,
    includeWarrants: data.includeWarrants != null ? Boolean(data.includeWarrants) : undefined,
    isDefault: data.isDefault != null ? Boolean(data.isDefault) : undefined,
  };
}

function rowToPreset(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    minPrice: row.min_price != null ? Number(row.min_price) : null,
    maxPrice: row.max_price != null ? Number(row.max_price) : null,
    minMarketCap: row.min_market_cap != null ? Number(row.min_market_cap) : null,
    maxMarketCap: row.max_market_cap != null ? Number(row.max_market_cap) : null,
    exchanges: row.exchanges || ['NASDAQ', 'NYSE', 'AMEX'],
    sectors: row.sectors || null,
    includeEtfs: Boolean(row.include_etfs),
    includeSpacs: Boolean(row.include_spacs),
    includeWarrants: Boolean(row.include_warrants),
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Preset CRUD
// ---------------------------------------------------------------------------

async function getPresetsForUser(userId) {
  const result = await pool.query(
    'SELECT * FROM user_presets WHERE user_id = $1 ORDER BY is_default DESC, created_at ASC',
    [userId]
  );
  return result.rows.map(rowToPreset);
}

async function getActivePreset(userId) {
  const result = await pool.query(
    `SELECT p.* FROM user_presets p
     JOIN users u ON u.active_preset_id = p.id
     WHERE u.id = $1`,
    [userId]
  );
  if (!result.rows.length) return null;
  return rowToPreset(result.rows[0]);
}

async function getPresetById(presetId, userId) {
  const result = await pool.query(
    'SELECT * FROM user_presets WHERE id = $1 AND user_id = $2',
    [presetId, userId]
  );
  if (!result.rows.length) return null;
  return rowToPreset(result.rows[0]);
}

async function createPreset(userId, data) {
  const errors = validatePresetData(data);
  if (errors.length) throw Object.assign(new Error(errors.join('; ')), { status: 400 });

  const s = sanitizePreset(data);

  // If this will be default, unset existing defaults first
  if (s.isDefault) {
    await pool.query(
      'UPDATE user_presets SET is_default = FALSE WHERE user_id = $1',
      [userId]
    );
  }

  const result = await pool.query(
    `INSERT INTO user_presets
      (user_id, name, min_price, max_price, min_market_cap, max_market_cap,
       exchanges, sectors, include_etfs, include_spacs, include_warrants, is_default)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      userId,
      s.name || 'My Preset',
      s.minPrice ?? null,
      s.maxPrice ?? null,
      s.minMarketCap ?? null,
      s.maxMarketCap ?? null,
      s.exchanges ?? ['NASDAQ', 'NYSE', 'AMEX'],
      s.sectors ?? null,
      s.includeEtfs ?? false,
      s.includeSpacs ?? false,
      s.includeWarrants ?? false,
      s.isDefault ?? false,
    ]
  );

  const preset = rowToPreset(result.rows[0]);

  // Auto-set as active if it's the user's first preset or marked default
  const activePreset = await getActivePreset(userId);
  if (!activePreset || s.isDefault) {
    await setActivePreset(userId, preset.id);
  }

  return preset;
}

async function updatePreset(presetId, userId, data) {
  const errors = validatePresetData(data);
  if (errors.length) throw Object.assign(new Error(errors.join('; ')), { status: 400 });

  const s = sanitizePreset(data);
  const fields = [];
  const values = [];
  let idx = 1;

  if (s.name !== undefined)           { fields.push(`name = $${idx++}`);             values.push(s.name); }
  if ('minPrice' in s)                { fields.push(`min_price = $${idx++}`);         values.push(s.minPrice); }
  if ('maxPrice' in s)                { fields.push(`max_price = $${idx++}`);         values.push(s.maxPrice); }
  if ('minMarketCap' in s)            { fields.push(`min_market_cap = $${idx++}`);    values.push(s.minMarketCap); }
  if ('maxMarketCap' in s)            { fields.push(`max_market_cap = $${idx++}`);    values.push(s.maxMarketCap); }
  if (s.exchanges !== undefined)      { fields.push(`exchanges = $${idx++}`);         values.push(s.exchanges); }
  if ('sectors' in s)                 { fields.push(`sectors = $${idx++}`);           values.push(s.sectors); }
  if (s.includeEtfs !== undefined)    { fields.push(`include_etfs = $${idx++}`);      values.push(s.includeEtfs); }
  if (s.includeSpacs !== undefined)   { fields.push(`include_spacs = $${idx++}`);     values.push(s.includeSpacs); }
  if (s.includeWarrants !== undefined){ fields.push(`include_warrants = $${idx++}`);  values.push(s.includeWarrants); }
  if (s.isDefault !== undefined)      { fields.push(`is_default = $${idx++}`);        values.push(s.isDefault); }

  if (!fields.length) throw Object.assign(new Error('No valid fields to update'), { status: 400 });

  fields.push(`updated_at = NOW()`);

  // Unset other defaults if setting this one as default
  if (s.isDefault) {
    await pool.query(
      'UPDATE user_presets SET is_default = FALSE WHERE user_id = $1 AND id != $2',
      [userId, presetId]
    );
  }

  values.push(presetId, userId);
  const result = await pool.query(
    `UPDATE user_presets SET ${fields.join(', ')}
     WHERE id = $${idx++} AND user_id = $${idx++}
     RETURNING *`,
    values
  );
  if (!result.rows.length) return null;
  return rowToPreset(result.rows[0]);
}

async function deletePreset(presetId, userId) {
  // Clear active_preset_id if this was the active one
  await pool.query(
    'UPDATE users SET active_preset_id = NULL WHERE id = $1 AND active_preset_id = $2',
    [userId, presetId]
  );
  const result = await pool.query(
    'DELETE FROM user_presets WHERE id = $1 AND user_id = $2 RETURNING id',
    [presetId, userId]
  );
  return result.rowCount > 0;
}

async function setActivePreset(userId, presetId) {
  const result = await pool.query(
    'UPDATE users SET active_preset_id = $1 WHERE id = $2 RETURNING id',
    [presetId, userId]
  );
  return result.rowCount > 0;
}

// ---------------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------------

async function getWatchlist(userId) {
  const result = await pool.query(
    'SELECT symbol FROM user_watchlists WHERE user_id = $1 ORDER BY added_at ASC',
    [userId]
  );
  return result.rows.map(r => r.symbol);
}

async function addToWatchlist(userId, symbol) {
  const clean = String(symbol || '').trim().toUpperCase();
  if (!clean) throw Object.assign(new Error('symbol is required'), { status: 400 });
  await pool.query(
    'INSERT INTO user_watchlists (user_id, symbol) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [userId, clean]
  );
  return clean;
}

async function removeFromWatchlist(userId, symbol) {
  const clean = String(symbol || '').trim().toUpperCase();
  const result = await pool.query(
    'DELETE FROM user_watchlists WHERE user_id = $1 AND symbol = $2',
    [userId, clean]
  );
  return result.rowCount > 0;
}

// ---------------------------------------------------------------------------
// Profile (user + presets + watchlist)
// ---------------------------------------------------------------------------

async function getProfile(userId) {
  const userResult = await pool.query(
    'SELECT id, username, email, is_admin, trading_timezone, active_preset_id, created_at FROM users WHERE id = $1',
    [userId]
  );
  if (!userResult.rows.length) return null;
  const user = userResult.rows[0];

  const [presets, watchlist] = await Promise.all([
    getPresetsForUser(userId),
    getWatchlist(userId),
  ]);

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    isAdmin: Boolean(user.is_admin),
    tradingTimezone: user.trading_timezone || 'Europe/London',
    activePresetId: user.active_preset_id,
    universePresets: presets,
    watchlist,
    createdAt: user.created_at,
  };
}

async function updateProfile(userId, data) {
  const allowed = ['tradingTimezone'];
  const fields = [];
  const values = [];
  let idx = 1;

  if (data.tradingTimezone !== undefined) {
    fields.push(`trading_timezone = $${idx++}`);
    values.push(String(data.tradingTimezone));
  }

  if (!fields.length) throw Object.assign(new Error('No valid fields to update'), { status: 400 });

  values.push(userId);
  const result = await pool.query(
    `UPDATE users SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING id`,
    values
  );
  return result.rowCount > 0;
}

module.exports = {
  getPresetsForUser,
  getActivePreset,
  getPresetById,
  createPreset,
  updatePreset,
  deletePreset,
  setActivePreset,
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  getProfile,
  updateProfile,
};
