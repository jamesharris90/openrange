import express from 'express';
import { getEarningsIntelligence } from './earningsController';

export function buildEarningsRouter() {
  const router = express.Router();

  router.get('/intelligence', async (req, res) => {
    try {
      const symbol = String(req.query.symbol || '').trim().toUpperCase();
      if (!symbol || !/^[A-Z0-9.^-]{1,10}$/.test(symbol)) {
        return res.status(400).json({ error: 'Invalid symbol' });
      }

      const result = await getEarningsIntelligence(symbol);
      return res.status(result.status).json(result.body);
    } catch (error: any) {
      return res.status(500).json({
        error: 'Failed to build earnings intelligence',
        detail: error?.message || 'Unknown error',
      });
    }
  });

  return router;
}
