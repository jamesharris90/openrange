const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const { addDays } = require('./_helpers');
const { runIngest: runFomcIngest } = require('./fomc_ingest');
const { runIngest: runFredEconomicIngest } = require('./fred_economic_ingest');
const { runIngest: runFmpIpoIngest } = require('./fmp_ipo_ingest');
const { runIngest: runFmpSplitsIngest } = require('./fmp_splits_ingest');
const { runIngest: runClinicalTrialsIngest } = require('./clinical_trials_ingest');
const { runIngest: runOpenFdaIngest } = require('./openfda_ingest');
const { runIngest: runFvapElectionsIngest } = require('./fvap_elections_ingest');
const { runIngest: runStaticLoaders } = require('./load_static_calendars');

async function runBackfill(options = {}) {
  const today = options.today || new Date().toISOString().slice(0, 10);
  const dryRun = options.dryRun === true || process.argv.includes('--dry-run');

  const results = {};
  results.fomc = await runFomcIngest({ dryRun });
  results.fred = await runFredEconomicIngest({ dryRun, fromDate: addDays(today, -365), toDate: addDays(today, 90) });
  results.ipo = await runFmpIpoIngest({ dryRun, calendarFrom: addDays(today, -90), calendarTo: addDays(today, 90), docFrom: addDays(today, -30), docTo: addDays(today, 30) });
  results.splits = await runFmpSplitsIngest({ dryRun, fromDate: addDays(today, -90), toDate: addDays(today, 90) });
  results.clinicalTrials = await runClinicalTrialsIngest({ dryRun, maxStudies: 1000 });
  results.openfda = await runOpenFdaIngest({ dryRun });
  results.fvap = await runFvapElectionsIngest({ dryRun });
  results.static = await runStaticLoaders({ dryRun });

  return results;
}

if (require.main === module) {
  runBackfill().then((result) => {
    console.log(JSON.stringify(result, null, 2));
  }).catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  runBackfill,
};