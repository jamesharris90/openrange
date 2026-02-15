import { Router } from 'express';
import { callOpenApi, isExpired, refreshTokens, describeAxiosError, TokenSet } from '../saxoClient';

const router = Router();

router.get('/dashboard', async (req, res) => {
  const tokens = req.session.tokens as TokenSet | undefined;
  if (!tokens?.access_token) {
    return res.redirect('/');
  }

  try {
    // Refresh if expired
    if (isExpired(tokens) && tokens.refresh_token) {
      const newTokens = await refreshTokens(tokens.refresh_token);
      req.session.tokens = newTokens;
    }

    const data = await callOpenApi('port/v1/accounts/me', req.session.tokens!.access_token);
    res.render('dashboard', { data });
  } catch (err) {
    // Attempt refresh on 401
    const message = describeAxiosError(err);
    if (message.startsWith('401') && tokens?.refresh_token) {
      try {
        const newTokens = await refreshTokens(tokens.refresh_token);
        req.session.tokens = newTokens;
        const data = await callOpenApi('port/v1/accounts/me', newTokens.access_token);
        return res.render('dashboard', { data });
      } catch (innerErr) {
        return res.status(401).render('error', { message: `Re-auth required: ${describeAxiosError(innerErr)}` });
      }
    }
    res.status(500).render('error', { message: `API call failed: ${message}` });
  }
});

export default router;
