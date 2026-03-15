const { runSystemAudit } = require('./diagnostics/systemAudit');

async function main() {
  try {
    const { textReport, reportPath, mirroredPath } = await runSystemAudit();
    console.log(textReport);
    console.log('');
    console.log(`JSON report saved: ${reportPath}`);
    console.log(`JSON report mirrored: ${mirroredPath}`);
  } catch (error) {
    console.error('System audit failed:', error);
    process.exitCode = 1;
  }
}

main();
