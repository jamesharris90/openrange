// User routes for registration, login, profile, admin, password reset
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const model = require('./model');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Get client IP helper
function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.connection?.remoteAddress ||
    req.ip ||
    'unknown';
}

// Input validation functions
function validateUsername(username) {
  if (typeof username !== 'string') return 'Username must be a string';
  if (username.length < 3 || username.length > 20) return 'Username must be 3-20 characters';
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) return 'Username can only contain letters, numbers, hyphens, and underscores';
  return null;
}

function validateEmail(email) {
  if (typeof email !== 'string') return 'Email must be a string';
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return 'Invalid email format';
  if (email.length > 255) return 'Email is too long';
  return null;
}

function validatePassword(password) {
  if (typeof password !== 'string') return 'Password must be a string';
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (password.length > 128) return 'Password is too long';
  if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number';
  return null;
}

function validatePplxModel(model) {
  if (model === undefined || model === null || model === '') return null;
  if (typeof model !== 'string') return 'Model must be a string';
  if (model.length < 2 || model.length > 100) return 'Model must be 2-100 characters';
  return null;
}

// Register
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });

  // Validate username
  const usernameError = validateUsername(username);
  if (usernameError) return res.status(400).json({ error: usernameError });

  // Validate email
  const emailError = validateEmail(email);
  if (emailError) return res.status(400).json({ error: emailError });

  // Validate password
  const passwordError = validatePassword(password);
  if (passwordError) return res.status(400).json({ error: passwordError });

  try {
    const user = await model.register(username, email, password);
    res.json({ success: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) return res.status(400).json({ error: 'All fields required' });
  try {
    const user = await model.findByUsernameOrEmail(identifier);
    if (!user) return res.status(401).json({ error: 'User not found' });

    // Check if user is active
    if (user.is_active === 0) {
      return res.status(403).json({ error: 'Account is deactivated. Contact support.' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      // Log failed attempt
      model.logActivity(user.id, 'login_failed', 'Invalid password attempt', getClientIp(req));
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Record successful login
    await model.recordLogin(user.id, getClientIp(req));

    const token = jwt.sign({
      id: user.id,
      username: user.username,
      email: user.email,
      is_admin: user.is_admin
    }, JWT_SECRET, { expiresIn: '24h' });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        is_admin: user.is_admin
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Auth middleware
function requireAuth(req, res, next) {
  const token = req.get('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Get profile
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const user = await model.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ id: user.id, username: user.username, email: user.email, is_admin: user.is_admin });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Perplexity settings for current user
router.get('/pplx/settings', requireAuth, async (req, res) => {
  try {
    const { apiKey, model: storedModel } = await model.getPplxSettings(req.user.id);
    res.json({ hasKey: !!apiKey, model: storedModel || 'sonar-pro' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save Perplexity settings for current user
router.post('/pplx/settings', requireAuth, async (req, res) => {
  const { apiKey, model: requestedModel } = req.body || {};

  if (apiKey !== undefined && apiKey !== null && typeof apiKey !== 'string') {
    return res.status(400).json({ error: 'API key must be a string' });
  }

  const modelError = validatePplxModel(requestedModel);
  if (modelError) return res.status(400).json({ error: modelError });

  const normalizedKey = apiKey === '' ? null : apiKey;
  const normalizedModel = requestedModel === '' ? null : (requestedModel || 'sonar-pro');

  try {
    await model.savePplxSettings(req.user.id, normalizedKey, normalizedModel);
    res.json({ success: true, hasKey: !!normalizedKey, model: normalizedModel || 'sonar-pro' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update password (user)
router.post('/update-password', requireAuth, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword) return res.status(400).json({ error: 'New password required' });

  // Validate password
  const passwordError = validatePassword(newPassword);
  if (passwordError) return res.status(400).json({ error: passwordError });

  try {
    await model.updatePassword(req.user.id, newPassword);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List all users (admin)
router.get('/admin/list', requireAuth, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admin only' });
  try {
    const users = await model.listAll();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete user (admin)
router.post('/admin/delete', requireAuth, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admin only' });
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'User id required' });
  try {
    await model.deleteUser(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Forgot password (request reset)
// In production, send email with token. Here, just return a reset token.
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  try {
    const user = await model.findByUsernameOrEmail(email);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const resetToken = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '1h' });
    // In production, email this token as a link
    res.json({ resetToken });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset password (with token)
router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password required' });

  // Validate password
  const passwordError = validatePassword(newPassword);
  if (passwordError) return res.status(400).json({ error: passwordError });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    await model.updatePassword(payload.id, newPassword);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: 'Invalid or expired token' });
  }
});

// ============================================
// ADMIN ROUTES
// ============================================

// Admin middleware
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    model.logActivity(req.user?.id, 'admin_access_denied', 'Attempted admin access', getClientIp(req));
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Get dashboard stats
router.get('/admin/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const stats = await model.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single user by ID
router.get('/admin/user/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const user = await model.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Remove password from response
    const { password, saxo_access_token, saxo_refresh_token, broker_access_token, broker_refresh_token, ...safeUser } = user;
    safeUser.broker = {
      type: user.broker_type || null,
      status: user.broker_status || 'disconnected',
      connectedAt: user.broker_connected_at || null
    };

    res.json(safeUser);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update user (admin)
router.post('/admin/update', requireAuth, requireAdmin, async (req, res) => {
  const { id, username, email, is_admin, is_active } = req.body;
  if (!id) return res.status(400).json({ error: 'User ID required' });

  // Validate username if provided
  if (username) {
    const usernameError = validateUsername(username);
    if (usernameError) return res.status(400).json({ error: usernameError });
  }

  // Validate email if provided
  if (email) {
    const emailError = validateEmail(email);
    if (emailError) return res.status(400).json({ error: emailError });
  }

  try {
    const updates = {};
    if (username !== undefined) updates.username = username;
    if (email !== undefined) updates.email = email;
    if (is_admin !== undefined) updates.is_admin = is_admin ? 1 : 0;
    if (is_active !== undefined) updates.is_active = is_active ? 1 : 0;

    await model.updateUser(id, updates);
    model.logActivity(req.user.id, 'admin_update_user', `Updated user ${id}: ${JSON.stringify(updates)}`, getClientIp(req));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create user (admin)
router.post('/admin/create', requireAuth, requireAdmin, async (req, res) => {
  const { username, email, password, is_admin } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email and password required' });
  }

  // Validate inputs
  const usernameError = validateUsername(username);
  if (usernameError) return res.status(400).json({ error: usernameError });

  const emailError = validateEmail(email);
  if (emailError) return res.status(400).json({ error: emailError });

  const passwordError = validatePassword(password);
  if (passwordError) return res.status(400).json({ error: passwordError });

  try {
    const user = await model.register(username, email, password, is_admin ? 1 : 0);
    model.logActivity(req.user.id, 'admin_create_user', `Created user: ${username}`, getClientIp(req));
    res.json({ success: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Reset user password (admin)
router.post('/admin/reset-password', requireAuth, requireAdmin, async (req, res) => {
  const { id, newPassword } = req.body;
  if (!id || !newPassword) return res.status(400).json({ error: 'User ID and new password required' });

  const passwordError = validatePassword(newPassword);
  if (passwordError) return res.status(400).json({ error: passwordError });

  try {
    await model.updatePassword(id, newPassword);
    model.logActivity(req.user.id, 'admin_reset_password', `Reset password for user ${id}`, getClientIp(req));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get activity log (admin)
router.get('/admin/activity', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const userId = req.query.userId || null;
    const log = await model.getActivityLog(Math.min(limit, 500), userId);
    res.json(log);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get/Set settings (admin)
router.get('/admin/settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    const settings = await model.getAllSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/settings', requireAuth, requireAdmin, async (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'Setting key required' });

  try {
    await model.setSetting(key, value);
    model.logActivity(req.user.id, 'admin_update_setting', `Updated setting: ${key}`, getClientIp(req));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
