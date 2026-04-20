#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

const role = String(process.env.OPENRANGE_SERVICE_ROLE || 'backend').trim().toLowerCase();

function getPositiveIntEnv(name, fallback) {
  const rawValue = Number(process.env[name]);
  return Number.isFinite(rawValue) && rawValue > 0 ? Math.floor(rawValue) : fallback;
}

const coverageWorkerArgs = [
  'scripts/runCoverageCompletionCampaign.js',
  '--unsafe',
  '--loop',
  '--skip-health-check',
  `--news-batch-size=${getPositiveIntEnv('COVERAGE_CAMPAIGN_NEWS_BATCH_SIZE', 8)}`,
  `--news-concurrency=${getPositiveIntEnv('COVERAGE_CAMPAIGN_NEWS_CONCURRENCY', 2)}`,
  `--max-news-symbols=${getPositiveIntEnv('COVERAGE_CAMPAIGN_MAX_NEWS_SYMBOLS', 24)}`,
  '--inter-symbol-delay-ms=0',
  '--inter-batch-delay-ms=0',
  '--cycle-sleep-ms=0',
  `--max-articles-per-symbol=${getPositiveIntEnv('COVERAGE_CAMPAIGN_MAX_ARTICLES_PER_SYMBOL', 4)}`,
  `--max-news-attempts-per-symbol=${getPositiveIntEnv('COVERAGE_CAMPAIGN_MAX_NEWS_ATTEMPTS_PER_SYMBOL', 1)}`,
];

const commandMap = {
  backend: ['node', ['index.js']],
  'coverage-worker': ['node', coverageWorkerArgs],
  'phase2-worker': ['node', ['scripts/runPhase2Worker.js']],
  'beacon-nightly-worker': ['node', ['beaconNightlyWorker.js']],
};

const selected = commandMap[role] || commandMap.backend;
const [command, args] = selected;

const child = spawn(command, args, {
  cwd: path.resolve(__dirname, '..'),
  stdio: 'inherit',
  env: process.env,
});

console.log(`[launcher] Role: ${role} -> Spawning: ${command} ${args.join(' ')}`);
console.log(`[launcher] Working Directory: ${path.resolve(__dirname, '..')}`);

child.on('spawn', () => {
  console.log(`[launcher] Child process successfully spawned (PID: ${child.pid})`);
});

child.on('error', (err) => {
  console.error('[launcher] FATAL: Failed to spawn child process:', err);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
