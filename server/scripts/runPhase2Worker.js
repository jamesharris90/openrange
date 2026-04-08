#!/usr/bin/env node

const { startPhase2Worker } = require('../phase2Worker');

startPhase2Worker().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});