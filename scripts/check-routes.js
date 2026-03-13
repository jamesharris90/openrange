const fs = require('fs');
const path = require('path');

const appFile = path.resolve(__dirname, '../client/src/App.jsx');
const serverFile = path.resolve(__dirname, '../server/index.js');
const outFile = path.resolve(__dirname, '../route-health-report.json');

function extractClientRoutes(content) {
  const matches = [...content.matchAll(/path=\"([^\"]+)\"/g)];
  return [...new Set(matches.map((m) => m[1]))].sort();
}

function extractServerRoutes(content) {
  const matches = [...content.matchAll(/app\.(?:get|post|put|patch|delete)\(\s*['\"]([^'\"]+)['\"]/g)];
  return [...new Set(matches.map((m) => m[1]))].sort();
}

function main() {
  const appContent = fs.readFileSync(appFile, 'utf8');
  const serverContent = fs.readFileSync(serverFile, 'utf8');

  const clientRoutes = extractClientRoutes(appContent);
  const serverRoutes = extractServerRoutes(serverContent);
  const apiRoutes = serverRoutes.filter((r) => r.startsWith('/api/'));

  const adminRoutes = clientRoutes.filter((r) => r.startsWith('/admin'));
  const warnings = [];
  if (!apiRoutes.includes('/api/system/platform-health')) warnings.push('Missing /api/system/platform-health');
  if (!apiRoutes.includes('/api/system/ui-health')) warnings.push('Missing /api/system/ui-health');
  if (!apiRoutes.includes('/api/system/email-health')) warnings.push('Missing /api/system/email-health');

  const report = {
    generated_at: new Date().toISOString(),
    client_routes: clientRoutes,
    backend_routes: serverRoutes,
    admin_routes: adminRoutes,
    warnings,
  };

  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log('Route health report generated:', outFile);
}

main();
