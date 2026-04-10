#!/usr/bin/env node

const http = require('http');

const endpoint = 'http://localhost:3007/api/screener?mode=focus&page=1&pageSize=5000';

http
  .get(endpoint, (res) => {
    let body = '';
    res.on('data', (chunk) => {
      body += chunk;
    });
    res.on('end', () => {
      const payload = JSON.parse(body || '{}');
      const rows = Array.isArray(payload.data) ? payload.data : [];

      const violations = rows.filter((row) => {
        const relVolOk = Number(row.relative_volume) >= 1.5;
        const volumeOk = Number(row.volume) >= 1000000;
        const changeOk = Math.abs(Number(row.change_percent)) >= 3;
        const scoreOk = Number(row.trade_quality_score) >= 15;
        const setup = String(row.setup || '').toUpperCase();
        const setupOk = setup !== 'IGNORE' && setup !== 'LOW INTEREST';
        return !(relVolOk && volumeOk && changeOk && scoreOk && setupOk);
      });

      const result = {
        pass:
          rows.length <= 20 &&
          violations.length === 0 &&
          rows.every((row) => String(row.setup || '').toUpperCase() !== 'IGNORE') &&
          rows.every((row) => String(row.setup || '').toUpperCase() !== 'LOW INTEREST'),
        top_trades: rows.length,
        violating_rows: violations.length,
      };

      console.log(JSON.stringify(result, null, 2));
    });
  })
  .on('error', (error) => {
    console.error(error.message || String(error));
    process.exitCode = 1;
  });
