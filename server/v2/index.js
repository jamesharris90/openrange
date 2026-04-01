const express = require('express');
const cors = require('cors');

const screenerRoute = require('./routes/screener');
const newsRoute = require('./routes/news');
const earningsRoute = require('./routes/earnings');

function createV2App() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  console.log('🚫 LEGACY SYSTEM DISABLED — V2 MODE ACTIVE');

  app.use('/api/v2/screener', screenerRoute);
  app.use('/api/v2/news', newsRoute);
  app.use('/api/v2/earnings', earningsRoute);

  return app;
}

module.exports = {
  createV2App,
};