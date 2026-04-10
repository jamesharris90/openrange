#!/usr/bin/env node

const http = require('http');

const url = 'http://localhost:3007/api/screener?page=1&pageSize=5000';

http
  .get(url, (res) => {
    let body = '';
    res.on('data', (chunk) => {
      body += chunk;
    });
    res.on('end', () => {
      const payload = JSON.parse(body || '{}');
      const rows = Array.isArray(payload.data) ? payload.data : [];

      const stats = {
        rows: rows.length,
        valid_rows: rows.filter((row) => row.data_quality === 'valid').length,
        null_sector: rows.filter((row) => row.sector == null || String(row.sector).trim() === '').length,
        zero_or_null_market_cap: rows.filter((row) => !(Number(row.market_cap) > 0)).length,
        missing_trade_quality_score: rows.filter((row) => typeof row.trade_quality_score !== 'number').length,
      };

      const pass =
        stats.rows > 1000 &&
        stats.null_sector === 0 &&
        stats.zero_or_null_market_cap === 0 &&
        stats.missing_trade_quality_score === 0;

      console.log(JSON.stringify({ pass, stats }, null, 2));
    });
  })
  .on('error', (error) => {
    console.error(error.message || String(error));
    process.exitCode = 1;
  });
