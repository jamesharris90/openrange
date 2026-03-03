const axios = require('axios');
require('dotenv').config();

const PROXY_URL = process.env.PROXY_URL || 'http://127.0.0.1:3000';

async function health() {
  try {
    const r = await axios.get(`${PROXY_URL}/api/health`, { timeout: 5000 });
    console.log('/api/health', r.status, r.data);
  } catch (err) {
    console.error('/api/health error', err.message);
  }
}

async function saxoRoot() {
  try {
    const headers = {};
    const r = await axios.get(`${PROXY_URL}/api/saxo/`, { headers, timeout: 10000, validateStatus: () => true });
    console.log('/api/saxo/ ->', r.status, typeof r.data === 'object' ? JSON.stringify(r.data) : String(r.data).slice(0, 200));
  } catch (err) {
    console.error('/api/saxo/ error', err.message);
  }
}

async function run() {
  console.log('Using PROXY_URL=', PROXY_URL);
  await health();
  await saxoRoot();
}

run().catch(e => { console.error(e); process.exit(1); });
