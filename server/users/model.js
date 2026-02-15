// User model using PostgreSQL (Supabase)
const bcrypt = require('bcrypt');
const { pool } = require('../db/pg');
const { encrypt, decrypt } = require('../utils/encryption');

// Register new user
const register = async (username, email, password, is_admin = 0) => {
  const hash = await bcrypt.hash(password, 10);
  const result = await pool.query(
    'INSERT INTO users (username, email, password, is_admin) VALUES ($1, $2, $3, $4) RETURNING id',
    [username, email, hash, is_admin]
  );
  const id = result.rows[0].id;
  return { id, username, email, is_admin };
};

// Find user by username or email
const findByUsernameOrEmail = async (identifier) => {
  const result = await pool.query(
    'SELECT * FROM users WHERE username = $1 OR email = $2',
    [identifier, identifier]
  );
  return result.rows[0] || null;
};

// Find user by id
const findById = async (id) => {
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0] || null;
};

// List all users (admin)
const listAll = async () => {
  const result = await pool.query(
    'SELECT id, username, email, is_admin, is_active, last_login, created_at, broker_type, broker_status, broker_connected_at FROM users'
  );
  return result.rows;
};

// Update user password
const updatePassword = async (id, newPassword) => {
  const hash = await bcrypt.hash(newPassword, 10);
  const result = await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hash, id]);
  return result.rowCount > 0;
};

// Delete user (admin)
const deleteUser = async (id) => {
  const result = await pool.query('DELETE FROM users WHERE id = $1', [id]);
  return result.rowCount > 0;
};

// Update user details (admin)
const updateUser = async (id, updates) => {
  const allowedFields = ['username', 'email', 'is_admin', 'is_active'];
  const fields = [];
  const values = [];
  let paramIndex = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      fields.push(`${key} = $${paramIndex++}`);
      values.push(value);
    }
  }

  if (fields.length === 0) return false;

  fields.push('updated_at = NOW()');
  values.push(id);

  const result = await pool.query(
    `UPDATE users SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
    values
  );
  return result.rowCount > 0;
};

// Record login
const recordLogin = async (id, ipAddress) => {
  const result = await pool.query(
    'UPDATE users SET last_login = NOW(), login_count = login_count + 1 WHERE id = $1',
    [id]
  );
  logActivity(id, 'login', 'User logged in', ipAddress);
  return result.rowCount > 0;
};

// Store Saxo tokens for user (encrypted)
const saveSaxoTokens = async (userId, accessToken, refreshToken, expiresAt) => {
  const result = await pool.query(
    `UPDATE users SET
      saxo_access_token = $1, saxo_refresh_token = $2,
      saxo_token_expires = $3, saxo_connected_at = NOW(), updated_at = NOW()
    WHERE id = $4`,
    [encrypt(accessToken), encrypt(refreshToken), expiresAt, userId]
  );
  logActivity(userId, 'saxo_connect', 'Connected Saxo account');
  return result.rowCount > 0;
};

// Get Saxo tokens for user (decrypted)
const getSaxoTokens = async (userId) => {
  const result = await pool.query(
    'SELECT saxo_access_token, saxo_refresh_token, saxo_token_expires FROM users WHERE id = $1',
    [userId]
  );
  const row = result.rows[0];
  if (!row || !row.saxo_access_token) return null;
  return {
    accessToken: decrypt(row.saxo_access_token),
    refreshToken: decrypt(row.saxo_refresh_token),
    expiresAt: row.saxo_token_expires
  };
};

// Clear Saxo tokens for user
const clearSaxoTokens = async (userId) => {
  const result = await pool.query(
    `UPDATE users SET saxo_access_token = NULL, saxo_refresh_token = NULL,
      saxo_token_expires = NULL, updated_at = NOW() WHERE id = $1`,
    [userId]
  );
  logActivity(userId, 'saxo_disconnect', 'Disconnected Saxo account');
  return result.rowCount > 0;
};

// Broker connection management (monitoring-only)
const saveBrokerConnection = async (userId, brokerType, accessToken, refreshToken, status = 'connected') => {
  const encryptedAccess = accessToken ? encrypt(accessToken) : null;
  const encryptedRefresh = refreshToken ? encrypt(refreshToken) : null;
  const result = await pool.query(
    `UPDATE users SET broker_type = $1, broker_access_token = $2, broker_refresh_token = $3,
      broker_connected_at = NOW(), broker_status = $4, updated_at = NOW() WHERE id = $5`,
    [brokerType, encryptedAccess, encryptedRefresh, status, userId]
  );
  logActivity(userId, 'broker_connect', `Connected broker: ${brokerType}`);
  return result.rowCount > 0;
};

const getBrokerConnection = async (userId) => {
  const result = await pool.query(
    `SELECT broker_type, broker_access_token, broker_refresh_token, broker_connected_at, broker_status
     FROM users WHERE id = $1`,
    [userId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    brokerType: row.broker_type || null,
    accessToken: row.broker_access_token ? decrypt(row.broker_access_token) : null,
    refreshToken: row.broker_refresh_token ? decrypt(row.broker_refresh_token) : null,
    connectedAt: row.broker_connected_at,
    status: row.broker_status || 'disconnected'
  };
};

const clearBrokerConnection = async (userId) => {
  const result = await pool.query(
    `UPDATE users SET broker_type = NULL, broker_access_token = NULL, broker_refresh_token = NULL,
      broker_connected_at = NULL, broker_status = 'disconnected', updated_at = NOW() WHERE id = $1`,
    [userId]
  );
  logActivity(userId, 'broker_disconnect', 'Disconnected broker');
  return result.rowCount > 0;
};

const updateBrokerStatus = async (userId, status) => {
  const result = await pool.query(
    'UPDATE users SET broker_status = $1, updated_at = NOW() WHERE id = $2',
    [status, userId]
  );
  return result.rowCount > 0;
};

// Check if user has Saxo connected
const hasSaxoConnected = async (userId) => {
  const result = await pool.query(
    'SELECT saxo_access_token, saxo_token_expires FROM users WHERE id = $1',
    [userId]
  );
  const row = result.rows[0];
  if (!row || !row.saxo_access_token) return false;
  const expires = new Date(row.saxo_token_expires);
  return expires > new Date();
};

// Activity logging (fire-and-forget)
const logActivity = (userId, action, details, ipAddress = null, userAgent = null) => {
  pool.query(
    'INSERT INTO activity_log (user_id, action, details, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5)',
    [userId, action, details, ipAddress, userAgent]
  ).catch(() => {});
};

// Get activity log (admin)
const getActivityLog = async (limit = 100, userId = null) => {
  let query = `
    SELECT al.*, u.username
    FROM activity_log al
    LEFT JOIN users u ON al.user_id = u.id
  `;
  const params = [];
  let paramIndex = 1;

  if (userId) {
    query += ` WHERE al.user_id = $${paramIndex++}`;
    params.push(userId);
  }

  query += ` ORDER BY al.created_at DESC LIMIT $${paramIndex}`;
  params.push(limit);

  const result = await pool.query(query, params);
  return result.rows;
};

// Store Perplexity API preferences for user (encrypted key)
const savePplxSettings = async (userId, apiKey, model = 'sonar-pro') => {
  const encryptedKey = apiKey ? encrypt(apiKey) : null;
  const normalizedModel = model || null;
  const result = await pool.query(
    'UPDATE users SET pplx_api_key = $1, pplx_model = $2, updated_at = NOW() WHERE id = $3',
    [encryptedKey, normalizedModel, userId]
  );
  logActivity(userId, 'pplx_update', 'Updated Perplexity settings');
  return result.rowCount > 0;
};

// Get Perplexity API preferences for user
const getPplxSettings = async (userId) => {
  const result = await pool.query(
    'SELECT pplx_api_key, pplx_model FROM users WHERE id = $1',
    [userId]
  );
  const row = result.rows[0];
  if (!row) return { apiKey: null, model: null };
  return {
    apiKey: row.pplx_api_key ? decrypt(row.pplx_api_key) : null,
    model: row.pplx_model || null
  };
};

// Get dashboard stats (admin)
const getStats = async () => {
  const [totalR, activeR, adminsR, brokerR, todayR, loginsR] = await Promise.all([
    pool.query('SELECT COUNT(*) as total FROM users'),
    pool.query('SELECT COUNT(*) as active FROM users WHERE is_active = 1'),
    pool.query('SELECT COUNT(*) as admins FROM users WHERE is_admin = 1'),
    pool.query('SELECT COUNT(*) as "brokerConnected" FROM users WHERE broker_type IS NOT NULL'),
    pool.query("SELECT COUNT(*) as today FROM users WHERE created_at::date = CURRENT_DATE"),
    pool.query("SELECT COUNT(*) as logins FROM activity_log WHERE action = 'login' AND created_at::date = CURRENT_DATE"),
  ]);

  return {
    totalUsers: parseInt(totalR.rows[0].total),
    activeUsers: parseInt(activeR.rows[0].active),
    adminCount: parseInt(adminsR.rows[0].admins),
    brokerConnected: parseInt(brokerR.rows[0].brokerConnected),
    newToday: parseInt(todayR.rows[0].today),
    loginsToday: parseInt(loginsR.rows[0].logins),
  };
};

// Settings management
const getSetting = async (key) => {
  const result = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return result.rows[0]?.value ?? null;
};

const setSetting = async (key, value) => {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, value]
  );
  return true;
};

const getAllSettings = async () => {
  const result = await pool.query('SELECT key, value FROM settings');
  const settings = {};
  result.rows.forEach(row => settings[row.key] = row.value);
  return settings;
};

module.exports = {
  register,
  findByUsernameOrEmail,
  findById,
  listAll,
  updatePassword,
  deleteUser,
  updateUser,
  recordLogin,
  saveSaxoTokens,
  getSaxoTokens,
  clearSaxoTokens,
  hasSaxoConnected,
  savePplxSettings,
  getPplxSettings,
  saveBrokerConnection,
  getBrokerConnection,
  clearBrokerConnection,
  updateBrokerStatus,
  logActivity,
  getActivityLog,
  getStats,
  getSetting,
  setSetting,
  getAllSettings,
};
