const express = require('express');
const jwt = require('jsonwebtoken');
const { queryWithTimeout } = require('../db/pg');
const { runPremarketNewsletter, buildNewsletterPayload, ensureNewsletterEngineTables } = require('../engines/newsletterEngine');
const { hasAdminAccess } = require('../middleware/requireAdminAccess');
const {
  EMAIL_TYPES,
  defaultEmailPreferences,
  normalizeEmailPreferences,
  getSubscriberPreferencesByEmail,
  upsertSubscriberPreferences,
  unsubscribeEmail,
} = require('../services/newsletterService');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

function success(data, meta) {
  const payload = { success: true, data };
  if (meta) payload.meta = meta;
  return payload;
}

function failure(error, data = []) {
  return { success: false, data, error: String(error || 'Unknown error') };
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function getToken(req) {
  const header = String(req.get('Authorization') || '');
  if (!header.startsWith('Bearer ')) return null;
  return header.slice(7).trim();
}

function getUserFromToken(req) {
  const token = getToken(req);
  if (!token) return null;

  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (_error) {
    return null;
  }
}

function getNyDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    weekday: get('weekday'),
  };
}

function nextWeekdayRunLabel(hour, minute) {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const now = new Date();
  const current = getNyDateParts(now);
  const nowMinutes = (current.hour * 60) + current.minute;
  const targetMinutes = (hour * 60) + minute;

  const weekdayIndex = dayNames.indexOf(current.weekday);
  const isWeekday = weekdayIndex >= 1 && weekdayIndex <= 5;
  let daysToAdd = 0;

  if (!isWeekday) {
    if (weekdayIndex === 6) daysToAdd = 2;
    if (weekdayIndex === 0) daysToAdd = 1;
  } else if (nowMinutes >= targetMinutes) {
    daysToAdd = weekdayIndex === 5 ? 3 : 1;
  }

  const run = new Date(now.getTime() + (daysToAdd * 24 * 60 * 60 * 1000));
  const runParts = getNyDateParts(run);
  const mm = String(runParts.month).padStart(2, '0');
  const dd = String(runParts.day).padStart(2, '0');
  return `${runParts.year}-${mm}-${dd} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ET`;
}

router.get('/api/newsletter/preview', async (req, res) => {
  try {
    const payload = await buildNewsletterPayload();
    return res.json(success(payload));
  } catch (error) {
    return res.status(500).json(failure(error.message || 'Failed to build newsletter preview'));
  }
});

router.post('/api/newsletter/subscribe', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const timezone = req.body?.timezone ? String(req.body.timezone).trim() : null;
  const requestedPrefs = req.body?.emailPreferences;

  if (!isValidEmail(email)) {
    return res.status(400).json(failure('Valid email is required'));
  }

  try {
    await ensureNewsletterEngineTables();

    const nextPrefs = normalizeEmailPreferences({
      ...defaultEmailPreferences(),
      ...(requestedPrefs && typeof requestedPrefs === 'object' ? requestedPrefs : {}),
    });

    const subscriber = await upsertSubscriberPreferences({
      email,
      enabled: true,
      timezone,
      emailPreferences: nextPrefs,
    });

    return res.json(success(subscriber));
  } catch (error) {
    return res.status(500).json(failure(error.message || 'Failed to subscribe email'));
  }
});

async function handleGetPreferences(req, res) {
  const authUser = getUserFromToken(req);
  const email = String(authUser?.email || '').trim().toLowerCase();

  if (!isValidEmail(email)) {
    return res.status(401).json(failure('Authentication required'));
  }

  try {
    const subscriber = await getSubscriberPreferencesByEmail(email);
    if (!subscriber) {
      return res.json(success({
        email,
        isActive: false,
        timezone: null,
        emailPreferences: normalizeEmailPreferences({
          [EMAIL_TYPES.MORNING_BEACON_BRIEF]: false,
          [EMAIL_TYPES.PREMARKET_MOVERS]: false,
          [EMAIL_TYPES.SECTOR_ROTATION_UPDATE]: false,
          [EMAIL_TYPES.EVENING_REVIEW]: false,
          [EMAIL_TYPES.HIGH_CONVICTION_ALERTS]: false,
        }),
      }));
    }

    return res.json(success(subscriber));
  } catch (error) {
    return res.status(500).json(failure(error.message || 'Failed to load email preferences'));
  }
}

router.get('/api/newsletter/preferences', handleGetPreferences);
router.get('/api/email/preferences', handleGetPreferences);

async function handleUpdatePreferences(req, res) {
  const authUser = getUserFromToken(req);
  const email = String(authUser?.email || '').trim().toLowerCase();

  if (!isValidEmail(email)) {
    return res.status(401).json(failure('Authentication required'));
  }

  try {
    const current = await getSubscriberPreferencesByEmail(email);
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const emailType = payload.emailType ? String(payload.emailType).trim().toLowerCase() : null;
    const enabled = payload.enabled === undefined ? undefined : Boolean(payload.enabled);
    const timezone = payload.timezone ? String(payload.timezone).trim() : (current?.timezone || null);

    let nextPreferences = normalizeEmailPreferences(current?.emailPreferences || defaultEmailPreferences());

    if (payload.emailPreferences && typeof payload.emailPreferences === 'object') {
      nextPreferences = normalizeEmailPreferences({ ...nextPreferences, ...payload.emailPreferences });
    }

    if (emailType && Object.values(EMAIL_TYPES).includes(emailType) && enabled !== undefined) {
      nextPreferences[emailType] = enabled;
    }

    const isActive = payload.isActive === undefined
      ? (current?.isActive !== undefined ? current.isActive : true)
      : Boolean(payload.isActive);

    const subscriber = await upsertSubscriberPreferences({
      email,
      enabled: isActive,
      timezone,
      emailPreferences: nextPreferences,
    });

    return res.json(success(subscriber));
  } catch (error) {
    return res.status(500).json(failure(error.message || 'Failed to update email preferences'));
  }
}

router.put('/api/newsletter/preferences', handleUpdatePreferences);
router.post('/api/email/preferences', handleUpdatePreferences);

router.post('/api/newsletter/unsubscribe', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const emailType = req.body?.emailType ? String(req.body.emailType).trim().toLowerCase() : null;

  if (!isValidEmail(email)) {
    return res.status(400).json(failure('Valid email is required'));
  }

  try {
    const subscriber = await unsubscribeEmail({ email, emailType });
    if (!subscriber) {
      return res.status(404).json(failure('Subscriber not found'));
    }

    return res.json(success(subscriber));
  } catch (error) {
    return res.status(500).json(failure(error.message || 'Failed to unsubscribe'));
  }
});

router.post('/api/newsletter/send', async (req, res) => {
  const access = await hasAdminAccess(req);
  if (!access.ok) {
    return res.status(401).json(failure('Unauthorized'));
  }

  try {
    const result = await runPremarketNewsletter({ sendEmail: true });
    return res.json(success(result));
  } catch (error) {
    return res.status(500).json(failure(error.message || 'Failed to send newsletter'));
  }
});

router.get('/api/newsletter/diagnostics', async (req, res) => {
  const access = await hasAdminAccess(req);
  if (!access.ok) {
    return res.status(401).json(failure('Unauthorized'));
  }

  try {
    await ensureNewsletterEngineTables();

    const [briefRows, historyRows, subscriberRows] = await Promise.all([
      queryWithTimeout(
        `SELECT id, as_of_date, created_at, signals, narrative, email_status
         FROM morning_briefings
         ORDER BY created_at DESC NULLS LAST
         LIMIT 5`,
        [],
        { timeoutMs: 7000, label: 'routes.newsletter.diagnostics.morning_brief', maxRetries: 0 }
      ).catch(() => ({ rows: [] })),
      queryWithTimeout(
        `SELECT sent_at, campaign_type, campaign_key, audience, recipients_count, status, provider_id, metadata
         FROM newsletter_send_history
         ORDER BY sent_at DESC NULLS LAST
         LIMIT 10`,
        [],
        { timeoutMs: 7000, label: 'routes.newsletter.diagnostics.send_history', maxRetries: 0 }
      ).catch(() => ({ rows: [] })),
      queryWithTimeout(
        `SELECT COUNT(*)::int AS total
         FROM newsletter_subscribers
         WHERE is_active = TRUE`,
        [],
        { timeoutMs: 7000, label: 'routes.newsletter.diagnostics.subscriber_count', maxRetries: 0 }
      ).catch(() => ({ rows: [{ total: 0 }] })),
    ]);

    const latestBrief = briefRows.rows?.[0] || null;
    const latestEmailStatus = latestBrief?.email_status && typeof latestBrief.email_status === 'object'
      ? latestBrief.email_status
      : {};
    const signals = Array.isArray(latestBrief?.signals) ? latestBrief.signals : [];

    const latestSelectedTickers = signals
      .map((row) => String(row?.symbol || '').toUpperCase())
      .filter(Boolean)
      .slice(0, 5);

    const lastFailure = (briefRows.rows || []).find((row) => {
      const status = row?.email_status && typeof row.email_status === 'object' ? row.email_status : {};
      return status.sent === false && status.reason;
    }) || null;

    return res.json(success({
      scheduler: {
        timezone: 'America/New_York',
        morningBriefCron: '0 8 * * 1-5',
        newsletterCron: '15 8 * * 1-5',
        weekdayOnly: true,
        nextMorningBriefRun: nextWeekdayRunLabel(8, 0),
        nextNewsletterRun: nextWeekdayRunLabel(8, 15),
      },
      summary: {
        subscriberCount: subscriberRows.rows?.[0]?.total || 0,
        lastMorningBriefRun: latestBrief?.created_at || null,
        lastSendCount: Number(latestEmailStatus.recipientsCount || 0),
        lastFailure: lastFailure
          ? {
              createdAt: lastFailure.created_at || null,
              reason: lastFailure.email_status?.reason || 'unknown',
              detail: lastFailure.email_status?.detail || null,
            }
          : null,
      },
      latestRun: {
        id: latestBrief?.id || null,
        createdAt: latestBrief?.created_at || null,
        selectedTickers: latestSelectedTickers,
        mcpEnhancementStatus: latestEmailStatus.mcpEnhancementStatus || latestBrief?.narrative?._meta?.source || 'unknown',
      },
      sendHistory: historyRows.rows || [],
    }));
  } catch (error) {
    return res.status(500).json(failure(error.message || 'Failed to load newsletter diagnostics'));
  }
});

module.exports = router;
