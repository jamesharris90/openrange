// @ts-nocheck
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const API_BASE = process.env.HEALTHCHECK_API_BASE || 'http://127.0.0.1:3000';

function fail(reason: string): never {
  console.log(`FAIL: ${reason}`);
  process.exit(1);
}

async function fetchJson(path: string) {
  const headers: Record<string, string> = {};

  const response = await fetch(`${API_BASE}${path}`, { headers });
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  return {
    status: response.status,
    ok: response.ok,
    body,
  };
}

async function run() {
  const directory = await fetchJson('/api/v4/directory/summary');
  if (!directory.ok) fail(`Directory endpoint status ${directory.status}`);

  const totalRaw = Number(directory.body?.totalRaw);
  const commonStocks = Number(directory.body?.commonStocks);

  if (!Number.isFinite(totalRaw) || totalRaw < 8000) {
    fail(`Directory Count totalRaw=${totalRaw}`);
  }
  if (!Number.isFinite(commonStocks) || commonStocks < 3500 || commonStocks > 7000) {
    fail(`Directory Count commonStocks=${commonStocks}`);
  }
  console.log('PASS: Directory Count');

  const v3Top = await fetchJson('/api/v3/screener/technical?limit=1');
  if (!v3Top.ok) fail(`Universe Match endpoint status ${v3Top.status}`);

  const v3Total = Number(v3Top.body?.total);
  if (!Number.isFinite(v3Total) || v3Total !== commonStocks) {
    fail(`Universe Match total=${v3Total} commonStocks=${commonStocks}`);
  }
  console.log('PASS: Universe Match');

  const jblu = await fetchJson('/api/v3/screener/technical?symbol=JBLU');
  if (!jblu.ok) fail(`JBLU endpoint status ${jblu.status}`);

  const jbluRows = Array.isArray(jblu.body?.data) ? jblu.body.data : [];
  if (jbluRows.length !== 1) {
    fail(`JBLU Exists length=${jbluRows.length}`);
  }
  console.log('PASS: JBLU Exists');

  const news = await fetchJson('/api/v4/news?hoursBack=24');
  if (news.status !== 200) {
    fail(`News Endpoint status=${news.status}`);
  }
  console.log('PASS: News Endpoint');

  process.exit(0);
}

run().catch((error) => {
  fail(error?.message || 'Unhandled healthcheck error');
});
