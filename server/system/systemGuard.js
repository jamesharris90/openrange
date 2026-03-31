const { runValidation } = require('./buildValidator');
const { systemGuard: legacySystemGuard } = require('../guards/systemGuard');

let inFlight = false;

function applyBlock(reason, detail) {
  global.systemBlocked = true;
  global.systemBlockedReason = reason;
  global.systemBlockedAt = new Date().toISOString();
  global.systemBlockedDetail = detail;
}

async function systemGuard() {
  if (inFlight) {
    console.log('[SYSTEM_GUARD_V2] run skipped (already in flight)');
    return;
  }

  inFlight = true;
  if (typeof global.systemBlocked !== 'boolean') {
    global.systemBlocked = false;
  }

  try {
    const port = Number(process.env.PORT || 3007);
    const baseUrl = `http://127.0.0.1:${port}`;
    const validation = await runValidation({ includeEndpointChecks: true, baseUrl });

    if (validation.status === 'FAIL') {
      applyBlock('build_validation_failed', {
        failures: validation.failedChecks,
        timestamp: validation.timestamp,
      });
      console.error('[SYSTEM_GUARD_V2] validation failed - writes blocked', {
        failures: validation.failures,
      });
    } else if (global.systemBlockedReason === 'build_validation_failed') {
      global.systemBlocked = false;
      global.systemBlockedReason = null;
      global.systemBlockedAt = null;
      global.systemBlockedDetail = null;
      console.log('[SYSTEM_GUARD_V2] validation passed - block cleared');
    } else {
      console.log('[SYSTEM_GUARD_V2] validation passed');
    }

    await legacySystemGuard();
  } catch (error) {
    applyBlock('build_validation_exception', error.message);
    console.error('[SYSTEM_GUARD_V2] fatal failure - writes blocked', error.message);
  } finally {
    inFlight = false;
  }
}

module.exports = {
  systemGuard,
};