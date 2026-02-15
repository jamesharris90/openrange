import axios, { AxiosError } from 'axios';

const AUTH_URL = process.env.SAXO_AUTH_URL || 'https://live.logonvalidation.net/authorize';
const TOKEN_URL = process.env.SAXO_TOKEN_URL || 'https://live.logonvalidation.net/token';
const OPENAPI_BASE = process.env.SAXO_OPENAPI_BASE || 'https://gateway.saxobank.com/openapi/';
const CLIENT_ID = process.env.SAXO_APP_KEY || '';
const CLIENT_SECRET = process.env.SAXO_APP_SECRET || '';
const REDIRECT_URI = process.env.SAXO_REDIRECT_URI || 'http://localhost:3000/auth/callback';
const DEFAULT_SCOPE = process.env.SAXO_SCOPE || 'read';

export type TokenSet = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  expires_at?: number;
};

function basicAuthHeader(): string {
  const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  return `Basic ${creds}`;
}

export function buildAuthorizeUrl(state: string, scope = DEFAULT_SCOPE): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeCode(code: string): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  });

  const resp = await axios.post(TOKEN_URL, body.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(),
    },
  });

  const tokens: TokenSet = {
    access_token: resp.data.access_token,
    refresh_token: resp.data.refresh_token,
    expires_in: resp.data.expires_in,
    token_type: resp.data.token_type,
  };
  tokens.expires_at = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined;
  return tokens;
}

export async function refreshTokens(refreshToken: string): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const resp = await axios.post(TOKEN_URL, body.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(),
    },
  });

  const tokens: TokenSet = {
    access_token: resp.data.access_token,
    refresh_token: resp.data.refresh_token ?? refreshToken,
    expires_in: resp.data.expires_in,
    token_type: resp.data.token_type,
  };
  tokens.expires_at = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined;
  return tokens;
}

export async function callOpenApi<T = unknown>(path: string, accessToken: string): Promise<T> {
  const url = path.startsWith('http') ? path : `${OPENAPI_BASE.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  const resp = await axios.get<T>(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  return resp.data;
}

export function isExpired(tokens?: TokenSet | null): boolean {
  if (!tokens?.expires_at) return false;
  return Date.now() >= tokens.expires_at - 60_000; // 1m early refresh
}

export function describeAxiosError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const e = err as AxiosError;
    const status = e.response?.status;
    const msg = e.response?.data ? JSON.stringify(e.response.data) : e.message;
    return status ? `${status}: ${msg}` : msg;
  }
  return (err as Error)?.message || 'Unknown error';
}
