const fs = require('fs');
const { execSync } = require('child_process');

function run(cmd) {
  try {
    return String(execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }) || '').trim();
  } catch {
    return '';
  }
}

function parseLines(text) {
  return String(text || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function main() {
  const targetPattern = 'prepDataRepair.js|openrange_autoloop.js|pipeline_unification_lock.js|score_calibration_phases_0_8.js|sip_priority_phases_0_6.js|earningsForceInjection.js|earningsOutcomeBackfill.js|openrange_density_expansion_cycle.js';
  const pidsRaw = run(`pgrep -f '${targetPattern}' || true`);
  const pids = parseLines(pidsRaw).filter((p) => /^\d+$/.test(p));

  const rogue = [];
  for (const pid of pids) {
    const cmd = run(`ps -p ${pid} -o command= || true`);
    if (!cmd) continue;
    if (cmd.includes('pgrep -f')) continue;
    if (cmd.includes('build_phase1_runtime.js')) continue;
    rogue.push({ pid: Number(pid), cmd });
  }

  const lsofRaw = run("lsof -nP -iTCP -sTCP:LISTEN | grep -E '(3000|3001|3011|3012|3016|3023)' || true");
  const listeners = parseLines(lsofRaw);
  const backendListeners = listeners.filter((line) => /:(3001|3011|3012|3016|3023)\s/.test(line));

  const out = {
    timestamp: new Date().toISOString(),
    active_processes: {
      rogue_query_output: rogue,
      lsof_lines: listeners,
    },
    active_ports: backendListeners,
    rogue_loops_running: rogue.length > 0,
    topology_summary: {
      backend_listener_count: backendListeners.length,
      topology_unambiguous: backendListeners.length === 1,
    },
  };

  out.pass = !out.rogue_loops_running && out.topology_summary.topology_unambiguous;

  fs.writeFileSync('/Users/jamesharris/Server/logs/go_live_phase1_runtime.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ pass: out.pass, rogue_count: rogue.length, backend_listener_count: out.topology_summary.backend_listener_count }));
}

main();
