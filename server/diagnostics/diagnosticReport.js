const fs = require('fs/promises');

function formatEndpointLine(result) {
  const marker = result.ok ? 'OK' : 'FAIL';
  const details = result.ok
    ? `${result.status} ${result.responseTimeMs}ms type=${result.responseType} len=${result.arrayLength ?? 'n/a'}`
    : `${result.status} ${result.error || 'request failed'}`;
  return `${result.endpoint.padEnd(24, '.')} ${marker} (${details})`;
}

function formatPageLine(pageResult) {
  const extra = pageResult.emptyDataDependencies.length
    ? ` empty=${pageResult.emptyDataDependencies.join(',')}`
    : '';
  return `${pageResult.page.padEnd(20, '.')} ${pageResult.status}${extra}`;
}

function generateTextReport(report) {
  const lines = [];
  lines.push('OPENRANGE SYSTEM AUDIT');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Base URL: ${report.baseUrl}`);
  lines.push('');
  lines.push('Endpoints');
  report.endpoints.forEach((endpoint) => lines.push(formatEndpointLine(endpoint)));
  lines.push('');
  lines.push('Pages');
  report.pages.forEach((page) => lines.push(formatPageLine(page)));
  lines.push('');
  lines.push('Data Quality');
  lines.push(`Symbols missing catalysts: ${report.dataQuality.symbolsMissingCatalyst}`);
  lines.push(`Rows missing symbols: ${report.dataQuality.rowsMissingSymbol}`);
  lines.push(`Rows missing timestamps: ${report.dataQuality.rowsMissingTimestamp}`);
  lines.push(`Signals returning 0.00 expected move: ${report.dataQuality.expectedMoveZeroRows}`);
  lines.push(`Contract violations: ${report.dataQuality.contractViolations}`);
  lines.push(`Charts missing OHLC: ${report.chartValidation.missingOhlcRows}`);
  lines.push(`Chart engine status: ${report.chartValidation.status}`);
  lines.push(`Sparkline check: ${report.sparklineValidation.message}`);
  lines.push(`Catalyst verification: ${report.catalystVerification.message}`);
  return lines.join('\n');
}

async function writeJsonReport(filePath, report) {
  const payload = JSON.stringify(report, null, 2);
  await fs.writeFile(filePath, payload, 'utf8');
}

module.exports = {
  generateTextReport,
  writeJsonReport,
};
