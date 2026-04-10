const { spawn } = require('child_process');

const phases = [
  { name: 'Phase 1', cmd: ['node', 'scripts/openrange_phase1_check.js'] },
  { name: 'Phase 2 Check', cmd: ['DOTENV_CONFIG_PATH=server/.env', 'node', '-r', './server/node_modules/dotenv/config', 'scripts/openrange_phase2_schema_check.js'] },
  { name: 'Phase 3', cmd: ['DOTENV_CONFIG_PATH=server/.env', 'node', '-r', './server/node_modules/dotenv/config', 'scripts/openrange_phase3_force_signals.js'] },
  { name: 'Phase 4', cmd: ['DOTENV_CONFIG_PATH=server/.env', 'node', '-r', './server/node_modules/dotenv/config', 'scripts/openrange_phase4_force_setups.js'] },
  { name: 'Phase 5', cmd: ['DOTENV_CONFIG_PATH=server/.env', 'node', '-r', './server/node_modules/dotenv/config', 'scripts/openrange_phase5_force_outcomes.js'] },
  { name: 'Phase 7', cmd: ['node', 'scripts/openrange_phase7_contract_check.js'] },
];

function runShell(commandParts) {
  return new Promise((resolve) => {
    const command = commandParts.join(' ');
    const proc = spawn('zsh', ['-lc', command], { stdio: 'inherit' });
    proc.on('close', (code) => resolve(code || 0));
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const intervalMs = Number(process.env.OPENRANGE_LOOP_INTERVAL_MS || 45000);
  let cycle = 0;

  while (true) {
    cycle += 1;
    console.log(`\n[OPENRANGE LOOP] cycle=${cycle} started_at=${new Date().toISOString()}`);

    for (const phase of phases) {
      console.log(`[OPENRANGE LOOP] running ${phase.name}`);
      const code = await runShell(phase.cmd);
      if (code !== 0) {
        console.error(`[OPENRANGE LOOP] ${phase.name} failed with code ${code}. Stopping loop.`);
        process.exit(code);
      }
    }

    console.log(`[OPENRANGE LOOP] cycle=${cycle} complete, sleeping ${intervalMs}ms`);
    await wait(intervalMs);
  }
}

main().catch((error) => {
  console.error('[OPENRANGE LOOP] fatal', error.message);
  process.exit(1);
});
