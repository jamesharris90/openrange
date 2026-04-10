require('dotenv').config({ path: require('path').join(__dirname, '..', 'server', '.env') });

const WebSocket = require('ws');

const ws = new WebSocket('wss://websockets.financialmodelingprep.com');

ws.on('open', () => {
  console.log('[TEST] Connected');

  ws.send(JSON.stringify({
    event: 'login',
    data: { apiKey: process.env.FMP_API_KEY }
  }));

  ws.send(JSON.stringify({
    event: 'subscribe',
    data: { ticker: ['aapl', 'tsla', 'nvda'] }
  }));
});

ws.on('message', (msg) => {
  console.log('[TEST MESSAGE]', msg.toString());
});

ws.on('error', (err) => {
  console.error('[TEST ERROR]', err.message);
});

setTimeout(() => {
  console.log('[TEST END]');
  process.exit(0);
}, 10000);
