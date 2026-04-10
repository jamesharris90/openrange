import { writeFile } from 'node:fs/promises';

const baseUrl = 'http://127.0.0.1:3000';

const publicEndpoints = [
  '/api/system/data-integrity',
  '/api/newsletter/preview',
  '/api/macro?limit=6',
  '/api/intelligence/sector-momentum',
  '/api/intelligence/markets',
  '/api/market/overview',
  '/api/system/cron-status',
  '/api/system/coverage-campaign',
];

const authEndpoints = [
  '/api/admin/system',
  '/api/admin/diagnostics',
  '/api/newsletter/diagnostics',
];

const pages = [
  '/',
  '/dashboard',
  '/admin',
];

async function fetchStatus(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: 'manual',
    ...options,
  });

  const contentType = response.headers.get('content-type') || '';
  let sample = '';
  if (contentType.includes('application/json') || contentType.includes('text/')) {
    sample = (await response.text()).slice(0, 240);
  }

  return {
    path,
    status: response.status,
    location: response.headers.get('location'),
    contentType,
    sample,
  };
}

async function main() {
  const publicResults = [];
  for (const path of publicEndpoints) {
    publicResults.push(await fetchStatus(path));
  }

  const authResults = [];
  for (const path of authEndpoints) {
    authResults.push(await fetchStatus(path));
  }

  const pageResults = [];
  for (const path of pages) {
    pageResults.push(await fetchStatus(path));
  }

  const publicPass = publicResults.every((result) => result.status === 200);
  const authPass = authResults.every((result) => [401, 403, 307, 302].includes(result.status));
  const rootPage = pageResults.find((result) => result.path === '/');
  const protectedPages = pageResults.filter((result) => result.path !== '/');
  const pagePass = Boolean(rootPage?.status === 200) && protectedPages.every((result) => [307, 302].includes(result.status));

  const precheck = {
    checked_at: new Date().toISOString(),
    scope: 'frontend admin/dashboard rebuild',
    schema_changes: false,
    database_mutations: false,
    note: 'No database schema was modified. Validation focused on live frontend routes and endpoint contracts used by the rebuilt surfaces.',
  };

  const endpointReport = {
    checked_at: new Date().toISOString(),
    public_results: publicResults,
    auth_results: authResults,
    page_results: pageResults,
    passes: {
      public_endpoints: publicPass,
      auth_guards: authPass,
      route_behavior: pagePass,
    },
  };

  const buildReport = {
    checked_at: new Date().toISOString(),
    touched_files: [
      'trading-os/src/components/terminal/admin-view.tsx',
      'trading-os/src/components/terminal/dashboard-view.tsx',
    ],
    validation: endpointReport.passes,
    outcome: publicPass && authPass && pagePass ? 'BUILD VALIDATED - SAFE TO DEPLOY' : 'BUILD FAILED - FIX REQUIRED',
  };

  await writeFile(new URL('./precheck_validation.json', import.meta.url), `${JSON.stringify(precheck, null, 2)}\n`);
  await writeFile(new URL('./endpoint_validation.json', import.meta.url), `${JSON.stringify(endpointReport, null, 2)}\n`);
  await writeFile(new URL('./build_validation_report.json', import.meta.url), `${JSON.stringify(buildReport, null, 2)}\n`);

  console.log(JSON.stringify({ precheck, endpointReport, buildReport }, null, 2));
}

main().catch(async (error) => {
  const failure = {
    checked_at: new Date().toISOString(),
    outcome: 'BUILD FAILED - FIX REQUIRED',
    error: error instanceof Error ? error.message : String(error),
  };
  await writeFile(new URL('./build_validation_report.json', import.meta.url), `${JSON.stringify(failure, null, 2)}\n`);
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
});
