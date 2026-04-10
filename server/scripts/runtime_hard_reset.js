const { execSync } = require('child_process');
const fs = require('fs');

function sh(cmd) {
  try {
    return String(execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] })).trim();
  } catch {
    return '';
  }
}

function lines(s) {
  return s ? s.split(/\n+/).map((x) => x.trim()).filter(Boolean) : [];
}

const log = {
  timestamp: new Date().toISOString(),
  phase: 'PHASE_0_RUNTIME_RESET',
  targets: {},
  actions: [],
  post: {},
};

const portPids = lines(sh('lsof -tiTCP:3001 -sTCP:LISTEN || true'));
const roguePatterns = 'drift_validation_runner|runCalibration|prepDataRepair|core_fix_lock_run|watchlist_session_lock_run|goLivePhases1to4|fullReadinessAudit|runIntelNewsNow';
const rogueList = lines(sh(`pgrep -af "${roguePatterns}" || true`));
const roguePids = Array.from(new Set(rogueList.map((l) => l.split(' ')[0]).filter(Boolean)));

log.targets.port3001_pids = portPids;
log.targets.rogue_matches = rogueList;

const killSet = Array.from(new Set([...portPids, ...roguePids])).filter(Boolean);
for (const pidStr of killSet) {
  const pid = Number(pidStr);
  if (!Number.isFinite(pid)) continue;
  try {
    process.kill(pid, 'SIGTERM');
    log.actions.push({ pid, signal: 'SIGTERM', status: 'sent' });
  } catch (e) {
    log.actions.push({ pid, signal: 'SIGTERM', status: 'error', error: String(e.message || e) });
  }
}

if (killSet.length) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
}

const still3001 = lines(sh('lsof -tiTCP:3001 -sTCP:LISTEN || true'));
const stillRogue = lines(sh(`pgrep -af "${roguePatterns}" || true`));

log.post.port3001_pids = still3001;
log.post.rogue_matches = stillRogue;
log.success = still3001.length === 0;

fs.mkdirSync('/Users/jamesharris/Server/logs', { recursive: true });
fs.writeFileSync('/Users/jamesharris/Server/logs/runtime_reset.json', JSON.stringify(log, null, 2));

console.log(JSON.stringify({
  success: log.success,
  killed: log.actions.length,
  still3001: still3001.length,
  stillRogue: stillRogue.length,
}, null, 2));

if (!log.success) {
  process.exit(1);
}
