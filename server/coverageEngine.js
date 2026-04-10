#!/usr/bin/env node

const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '.env') });
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
}

const { runCoverageEngine } = require('./v2/services/coverageEngine');

runCoverageEngine()
  .then((report) => {
    console.log(JSON.stringify(report, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });