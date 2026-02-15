import { Router } from 'express';
import crypto from 'crypto';
import { buildAuthorizeUrl, exchangeCode, describeAxiosError } from '../saxoClient';

const router = Router();

router.get('/', (_req, res) => {
  res.render('index');
});

router.get('/auth/saxo', (req, res) => {
  const state = crypto.randomBytes(24).toString('hex');
  req.session.oauthState = state;
  const scope = process.env.SAXO_SCOPE || 'read';
  const url = buildAuthorizeUrl(state, scope);
  res.redirect(url);
});

router.get('/auth/callback', async (req, res) => {
  const { state, code, error } = req.query;
  if (error) {
    return res.status(400).render('error', { message: `Authorization error: ${error}` });
  }
  if (!state || state !== req.session.oauthState) {
    return res.status(400).render('error', { message: 'State mismatch. Please try again.' });
  }
  if (!code || typeof code !== 'string') {
    return res.status(400).render('error', { message: 'Missing authorization code.' });
  }

  try {
    const tokens = await exchangeCode(code);
    req.session.tokens = tokens;
    delete req.session.oauthState;
    res.redirect('/dashboard');
  } catch (err) {
    const message = describeAxiosError(err);
    res.status(500).render('error', { message: `Token exchange failed: ${message}` });
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

export default router;
