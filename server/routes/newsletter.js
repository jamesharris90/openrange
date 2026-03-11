const express = require('express');
const { queryWithTimeout } = require('../db/pg');
const { runPremarketNewsletter, buildNewsletterPayload, ensureNewsletterEngineTables } = require('../engines/newsletterEngine');
const { hasAdminAccess } = require('../middleware/requireAdminAccess');

const router = express.Router();

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

router.get('/api/newsletter/preview', async (req, res) => {
  try {
    const payload = await buildNewsletterPayload();
    return res.json({ ok: true, payload });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Failed to build newsletter preview' });
  }
});

router.post('/api/newsletter/subscribe', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!isValidEmail(email)) {
    return res.status(400).json({ ok: false, error: 'Valid email is required' });
  }

  try {
    await ensureNewsletterEngineTables();
    await queryWithTimeout(
      `INSERT INTO newsletter_subscribers (email, is_active, created_at)
       VALUES ($1, TRUE, NOW())
       ON CONFLICT (email)
       DO UPDATE SET is_active = TRUE`,
      [email],
      { timeoutMs: 7000, label: 'routes.newsletter.subscribe', maxRetries: 0 }
    );

    return res.json({ ok: true, email });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Failed to subscribe email' });
  }
});

router.post('/api/newsletter/send', async (req, res) => {
  const access = await hasAdminAccess(req);
  if (!access.ok) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  try {
    const result = await runPremarketNewsletter({ sendEmail: true });
    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Failed to send newsletter' });
  }
});

module.exports = router;
