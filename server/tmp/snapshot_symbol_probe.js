require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { getLatestScreenerPayload } = require('../v2/services/snapshotService');

async function main() {
  const symbol = (process.argv[2] || 'AAPL').toUpperCase();
  const snapshot = await getLatestScreenerPayload();
  const rows = Array.isArray(snapshot?.data) ? snapshot.data : [];
  const row = rows.find((item) => String(item?.symbol || '').toUpperCase() === symbol) || null;
  console.log(JSON.stringify(row, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
