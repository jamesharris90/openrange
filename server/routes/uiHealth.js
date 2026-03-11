const fs = require('fs');
const path = require('path');

function getUIHealth(req, res) {
  try {
    const reportPath = path.resolve(__dirname, '../../ui-health-report.json');
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

    res.json({
      ok: true,
      issues: Array.isArray(report) ? report.length : 0,
      report: Array.isArray(report) ? report : [],
    });
  } catch (_error) {
    res.json({
      ok: true,
      issues: 0,
      report: [],
    });
  }
}

module.exports = {
  getUIHealth,
};
