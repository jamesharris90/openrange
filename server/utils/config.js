require('dotenv').config();

module.exports = {
  PROXY_API_KEY: process.env.PROXY_API_KEY || null,
  JWT_SECRET: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
  FINNHUB_API_KEY: process.env.FINNHUB_API_KEY || null,
  FINVIZ_NEWS_TOKEN: process.env.FINVIZ_NEWS_TOKEN || null,
  POLYGON_API_KEY: process.env.POLYGON_API_KEY || null,
  NODE_ENV: process.env.NODE_ENV || 'development',
};
