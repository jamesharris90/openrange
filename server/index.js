const express = require('express');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cors());

const limiter = rateLimit({ windowMs: 60 * 1000, max: 120 });
app.use(limiter);

const PORT = process.env.PORT || 3000;
const SAXO_BASE = process.env.SAXO_API_URL || 'https://gateway.saxobank.com/openapi';
const SAXO_TOKEN = process.env.SAXO_TOKEN;
const SAXO_CLIENT_KEY = process.env.SAXO_CLIENT_KEY;
const PROXY_API_KEY = process.env.PROXY_API_KEY || null;

if (!SAXO_TOKEN) {
  console.warn('Warning: SAXO_TOKEN not set. Proxy will respond with 502 for Saxo calls until configured.');
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, env: process.env.NODE_ENV || 'development' });
});

// Simple API-key auth middleware for basic protection
app.use((req, res, next) => {
  // Allow health checks and static local development without API key
  if (req.path === '/api/health') return next();

  if (!PROXY_API_KEY) {
    // If no API key configured, return 502 to avoid accidental exposure
    return res.status(502).json({ error: 'Proxy API key not configured on server' });
  }

  const key = req.get('x-api-key') || req.query['api_key'];
  if (!key || key !== PROXY_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized - missing or invalid API key' });
  }

  next();
});

// Proxy endpoint: forwards requests to Saxo OpenAPI
app.all('/api/saxo/*', async (req, res) => {
  try {
    if (!SAXO_TOKEN) {
      return res.status(502).json({ error: 'SAXO_TOKEN not configured on server' });
    }

    const targetPath = req.originalUrl.replace(/^\/api\/saxo/, '');
    const targetUrl = `${SAXO_BASE}${targetPath}`;

    const headers = {
      Authorization: `Bearer ${SAXO_TOKEN}`,
      'Content-Type': req.get('content-type') || 'application/json'
    };

    // Include ClientKey as query param if provided
    const axiosConfig = {
      method: req.method,
      url: targetUrl,
      headers,
      data: req.body,
      params: req.query,
      timeout: parseInt(process.env.REQUEST_TIMEOUT || '10000', 10),
      validateStatus: () => true
    };

    const response = await axios(axiosConfig);

    // Forward status and data
    res.status(response.status);
    // Avoid forwarding certain hop-by-hop headers
    const excluded = ['transfer-encoding', 'content-encoding', 'content-length', 'connection'];
    Object.entries(response.headers || {}).forEach(([k, v]) => {
      if (!excluded.includes(k.toLowerCase())) {
        res.setHeader(k, v);
      }
    });

    if (response.data && typeof response.data === 'object') {
      return res.json(response.data);
    }

    return res.send(response.data);
  } catch (err) {
    console.error('Proxy error:', err.message || err);
    if (err.response) {
      return res.status(err.response.status).json(err.response.data || { error: 'Upstream error' });
    }
    return res.status(500).json({ error: 'Proxy failed', detail: err.message });
  }
});

app.listen(PORT, () => console.log(`Saxo proxy listening on http://localhost:${PORT}`));
