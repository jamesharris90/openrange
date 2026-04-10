const { runSystemValidation } = require('./systemValidation');

function formatLine(label, value) {
  return `✔ ${label}: ${value}`;
}

async function main() {
  const result = await runSystemValidation();

  console.log(formatLine('Lifecycle', result.lifecycle_overlap));
  console.log(formatLine('Decisions', result.decision_count));
  console.log(formatLine('Signals', result.signals_recent));
  console.log(formatLine('Stocks in Play', result.stocks_in_play_count));

  if (result.status === 'FAIL') {
    console.log('❌ SYSTEM FAILURE DETECTED');
    process.exit(1);
  }

  console.log('SYSTEM OPERATIONAL');
  process.exit(0);
}

main().catch((error) => {
  console.error('[SYSTEM_CHECK] fatal', error.message);
  console.log('❌ SYSTEM FAILURE DETECTED');
  process.exit(1);
});
