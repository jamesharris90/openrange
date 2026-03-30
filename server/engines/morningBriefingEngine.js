'use strict';

/**
 * Morning Briefing Engine
 *
 * Scheduler orchestrator for the 07:00 UK weekday morning briefing.
 * Delegates to the existing morningBriefEngine for data + email dispatch.
 *
 * Schedule: weekdays 07:00 UK (Europe/London)
 */

const { runMorningBriefEngine } = require('./morningBriefEngine');

const LABEL = '[MORNING_BRIEFING]';

// ─── Main run function ────────────────────────────────────────────────────────

async function runMorningBriefingEngine(options = {}) {
  const t0 = Date.now();
  console.log(`${LABEL} starting`);

  try {
    const result = await runMorningBriefEngine(options);
    const ms = Date.now() - t0;
    console.log(`${LABEL} complete — ${ms}ms`, result?.skipped ? `(skipped: ${result.reason})` : '');
    return { ok: true, ...result, duration_ms: ms };
  } catch (err) {
    const ms = Date.now() - t0;
    console.error(`${LABEL} failed (${ms}ms):`, err.message);
    return { ok: false, error: err.message, duration_ms: ms };
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

let _timer = null;

function startMorningBriefingScheduler() {
  if (_timer) return;
  const cron = require('node-cron');

  // 07:00 UK weekdays
  _timer = cron.schedule('0 7 * * 1-5', () => {
    runMorningBriefingEngine().catch(err =>
      console.error(`${LABEL} scheduled run failed:`, err.message)
    );
  }, { timezone: 'Europe/London' });

  console.log(`${LABEL} scheduler started (07:00 UK weekdays)`);
}

function stopMorningBriefingScheduler() {
  if (_timer) { _timer.stop(); _timer = null; }
}

module.exports = {
  runMorningBriefingEngine,
  startMorningBriefingScheduler,
  stopMorningBriefingScheduler,
};
