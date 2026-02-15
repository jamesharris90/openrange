import { Router } from 'express';
import { ibkrGet } from '../ibkrRestClient';
import ibkrWs from '../ibkrWebsocket';

const router = Router();

router.get('/ibkr/status', async (_req, res) => {
  try {
    const status = await ibkrGet('/v1/api/iserver/auth/status');
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || 'Failed to load status' });
  }
});

router.get('/ibkr/accounts', async (_req, res) => {
  try {
    const accounts = await ibkrGet('/v1/api/portal/account/summaries');
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || 'Failed to load accounts' });
  }
});

router.get('/ibkr/ws/start', async (_req, res) => {
  try {
    await ibkrWs.connect();
    res.json({ connected: ibkrWs.isOpen() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || 'Failed to start WebSocket' });
  }
});

export default router;
