const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { runMorningBrief } = require('../engines/morningBriefEngine');
const { runStocksInPlayEngine } = require('../engines/stocksInPlayEngine');

async function run() {
  console.log('[SEND] Preparing Stocks In Play');
  await runStocksInPlayEngine();

  console.log('[SEND] Running morning briefing send');
  const result = await runMorningBrief({ testEmail: 'jamesharris4@me.com' });

  if (!result?.emailStatus?.sent) {
    throw new Error(`Email not sent: ${JSON.stringify(result?.emailStatus || {})}`);
  }

  console.log('Morning briefing resent successfully');
  console.log('Recipient:', (result.emailStatus.recipients || []).join(', '));
  console.log('Resend ID:', result.emailStatus.providerId || 'N/A');
  console.log('Delivery Status:', result.emailStatus.sent ? 'sent' : 'not_sent');
}

run().catch((error) => {
  console.error('Morning briefing resend failed:', error.message);
  process.exit(1);
});
