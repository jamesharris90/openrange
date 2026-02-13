// User model using SQLite
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const path = require('path');

const dbPath = path.join(__dirname, '../users.db');
const db = new sqlite3.Database(dbPath);

// Encryption for sensitive data (Saxo tokens)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex').slice(0, 32);
const IV_LENGTH = 16;

function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
  if (!text) return null;
  try {
    const parts = text.split(':');
    const iv = Buffer.from(parts.shift(), 'hex');
    const encryptedText = Buffer.from(parts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (e) {
    return null;
  }
}

// Create users table if not exists
const init = () => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    last_login DATETIME,
    login_count INTEGER DEFAULT 0,
    saxo_access_token TEXT,
    saxo_refresh_token TEXT,
    saxo_token_expires DATETIME,
    saxo_connected_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Create activity log table
  db.run(`CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    details TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // Create settings table
  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Run migrations for existing databases
  migrateDatabase();
};

// Migration function for existing databases
const migrateDatabase = () => {
  // Check and add new columns if they don't exist
  const newColumns = [
    { name: 'is_active', type: 'INTEGER DEFAULT 1' },
    { name: 'last_login', type: 'DATETIME' },
    { name: 'login_count', type: 'INTEGER DEFAULT 0' },
    { name: 'saxo_access_token', type: 'TEXT' },
    { name: 'saxo_refresh_token', type: 'TEXT' },
    { name: 'saxo_token_expires', type: 'DATETIME' },
    { name: 'saxo_connected_at', type: 'DATETIME' },
    { name: 'updated_at', type: 'DATETIME DEFAULT CURRENT_TIMESTAMP' },
    { name: 'pplx_api_key', type: 'TEXT' },
    { name: 'pplx_model', type: 'TEXT' }
  ];

  newColumns.forEach(col => {
    db.run(`ALTER TABLE users ADD COLUMN ${col.name} ${col.type}`, (err) => {
      // Ignore error if column already exists
    });
  });
};

// Register new user
const register = async (username, email, password, is_admin = 0) => {
  const hash = await bcrypt.hash(password, 10);
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO users (username, email, password, is_admin) VALUES (?, ?, ?, ?)',
      [username, email, hash, is_admin],
      function (err) {
        if (err) return reject(err);
        resolve({ id: this.lastID, username, email, is_admin });
      }
    );
  });
};

// Find user by username or email
const findByUsernameOrEmail = (identifier) => {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM users WHERE username = ? OR email = ?',
      [identifier, identifier],
      (err, row) => {
        if (err) return reject(err);
        resolve(row);
      }
    );
  });
};

// Find user by id
const findById = (id) => {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
};

// List all users (admin)
const listAll = () => {
  return new Promise((resolve, reject) => {
    db.all('SELECT id, username, email, is_admin, created_at FROM users', [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
};

// Update user password
const updatePassword = async (id, newPassword) => {
  const hash = await bcrypt.hash(newPassword, 10);
  return new Promise((resolve, reject) => {
    db.run('UPDATE users SET password = ? WHERE id = ?', [hash, id], function (err) {
      if (err) return reject(err);
      resolve(this.changes > 0);
    });
  });
};

// Delete user (admin)
const deleteUser = (id) => {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM users WHERE id = ?', [id], function (err) {
      if (err) return reject(err);
      resolve(this.changes > 0);
    });
  });
};

// Update user details (admin)
const updateUser = (id, updates) => {
  const allowedFields = ['username', 'email', 'is_admin', 'is_active'];
  const fields = [];
  const values = [];

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) return Promise.resolve(false);

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);

  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
      values,
      function (err) {
        if (err) return reject(err);
        resolve(this.changes > 0);
      }
    );
  });
};

// Record login
const recordLogin = (id, ipAddress) => {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP, login_count = login_count + 1 WHERE id = ?',
      [id],
      function (err) {
        if (err) return reject(err);
        // Log the activity
        logActivity(id, 'login', 'User logged in', ipAddress);
        resolve(this.changes > 0);
      }
    );
  });
};

// Store Saxo tokens for user (encrypted)
const saveSaxoTokens = (userId, accessToken, refreshToken, expiresAt) => {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE users SET
        saxo_access_token = ?,
        saxo_refresh_token = ?,
        saxo_token_expires = ?,
        saxo_connected_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [encrypt(accessToken), encrypt(refreshToken), expiresAt, userId],
      function (err) {
        if (err) return reject(err);
        logActivity(userId, 'saxo_connect', 'Connected Saxo account');
        resolve(this.changes > 0);
      }
    );
  });
};

// Get Saxo tokens for user (decrypted)
const getSaxoTokens = (userId) => {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT saxo_access_token, saxo_refresh_token, saxo_token_expires FROM users WHERE id = ?',
      [userId],
      (err, row) => {
        if (err) return reject(err);
        if (!row || !row.saxo_access_token) return resolve(null);
        resolve({
          accessToken: decrypt(row.saxo_access_token),
          refreshToken: decrypt(row.saxo_refresh_token),
          expiresAt: row.saxo_token_expires
        });
      }
    );
  });
};

// Clear Saxo tokens for user
const clearSaxoTokens = (userId) => {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE users SET
        saxo_access_token = NULL,
        saxo_refresh_token = NULL,
        saxo_token_expires = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [userId],
      function (err) {
        if (err) return reject(err);
        logActivity(userId, 'saxo_disconnect', 'Disconnected Saxo account');
        resolve(this.changes > 0);
      }
    );
  });
};

// Check if user has Saxo connected
const hasSaxoConnected = (userId) => {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT saxo_access_token, saxo_token_expires FROM users WHERE id = ?',
      [userId],
      (err, row) => {
        if (err) return reject(err);
        if (!row || !row.saxo_access_token) return resolve(false);
        // Check if token is expired
        const expires = new Date(row.saxo_token_expires);
        resolve(expires > new Date());
      }
    );
  });
};

// Activity logging
const logActivity = (userId, action, details, ipAddress = null, userAgent = null) => {
  db.run(
    'INSERT INTO activity_log (user_id, action, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)',
    [userId, action, details, ipAddress, userAgent]
  );
};

// Get activity log (admin)
const getActivityLog = (limit = 100, userId = null) => {
  return new Promise((resolve, reject) => {
    let query = `
      SELECT al.*, u.username
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
    `;
    const params = [];

    if (userId) {
      query += ' WHERE al.user_id = ?';
      params.push(userId);
    }

    query += ' ORDER BY al.created_at DESC LIMIT ?';
    params.push(limit);

    db.all(query, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
};

// Store Perplexity API preferences for user (encrypted key)
const savePplxSettings = (userId, apiKey, model = 'sonar-pro') => {
  const encryptedKey = apiKey ? encrypt(apiKey) : null;
  const normalizedModel = model || null;

  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE users SET
        pplx_api_key = ?,
        pplx_model = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [encryptedKey, normalizedModel, userId],
      function (err) {
        if (err) return reject(err);
        logActivity(userId, 'pplx_update', 'Updated Perplexity settings');
        resolve(this.changes > 0);
      }
    );
  });
};

// Get Perplexity API preferences for user
const getPplxSettings = (userId) => {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT pplx_api_key, pplx_model FROM users WHERE id = ?',
      [userId],
      (err, row) => {
        if (err) return reject(err);
        if (!row) return resolve({ apiKey: null, model: null });
        resolve({
          apiKey: row.pplx_api_key ? decrypt(row.pplx_api_key) : null,
          model: row.pplx_model || null
        });
      }
    );
  });
};

// Get dashboard stats (admin)
const getStats = () => {
  return new Promise((resolve, reject) => {
    const stats = {};

    db.get('SELECT COUNT(*) as total FROM users', [], (err, row) => {
      if (err) return reject(err);
      stats.totalUsers = row.total;

      db.get('SELECT COUNT(*) as active FROM users WHERE is_active = 1', [], (err, row) => {
        if (err) return reject(err);
        stats.activeUsers = row.active;

        db.get('SELECT COUNT(*) as admins FROM users WHERE is_admin = 1', [], (err, row) => {
          if (err) return reject(err);
          stats.adminCount = row.admins;

          db.get('SELECT COUNT(*) as saxo FROM users WHERE saxo_access_token IS NOT NULL', [], (err, row) => {
            if (err) return reject(err);
            stats.saxoConnected = row.saxo;

            db.get('SELECT COUNT(*) as today FROM users WHERE date(created_at) = date("now")', [], (err, row) => {
              if (err) return reject(err);
              stats.newToday = row.today;

              db.get('SELECT COUNT(*) as logins FROM activity_log WHERE action = "login" AND date(created_at) = date("now")', [], (err, row) => {
                if (err) return reject(err);
                stats.loginsToday = row.logins;
                resolve(stats);
              });
            });
          });
        });
      });
    });
  });
};

// Settings management
const getSetting = (key) => {
  return new Promise((resolve, reject) => {
    db.get('SELECT value FROM settings WHERE key = ?', [key], (err, row) => {
      if (err) return reject(err);
      resolve(row ? row.value : null);
    });
  });
};

const setSetting = (key, value) => {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
      [key, value],
      function (err) {
        if (err) return reject(err);
        resolve(true);
      }
    );
  });
};

const getAllSettings = () => {
  return new Promise((resolve, reject) => {
    db.all('SELECT key, value FROM settings', [], (err, rows) => {
      if (err) return reject(err);
      const settings = {};
      rows.forEach(row => settings[row.key] = row.value);
      resolve(settings);
    });
  });
};

init();

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
  logActivity,
  getActivityLog,
  getStats,
  getSetting,
  setSetting,
  getAllSettings,
  db
};
