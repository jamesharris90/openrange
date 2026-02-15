import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import path from 'path';

import authRoutes from './routes/auth';
import dashboardRoutes from './routes/dashboard';
import ibkrRoutes from './routes/ibkr';

declare module 'express-session' {
  interface SessionData {
    oauthState?: string;
    tokens?: {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
      expires_at?: number;
    };
  }
}

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';

app.use(helmet());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
    },
  })
);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(authRoutes);
app.use(dashboardRoutes);
app.use(ibkrRoutes);

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).render('error', { message: 'Unexpected error occurred.' });
});

app.listen(PORT, () => {
  console.log(`Saxo OAuth demo listening on http://localhost:${PORT}`);
});
