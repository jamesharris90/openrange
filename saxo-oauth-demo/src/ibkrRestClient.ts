import axios, { AxiosInstance } from 'axios';
import https from 'https';

const IBKR_GATEWAY_BASE = process.env.IBKR_GATEWAY_BASE || 'https://localhost:5000';
const IBKR_INSECURE_SSL = process.env.IBKR_INSECURE_SSL === 'true';

let client: AxiosInstance | null = null;

function getClient(): AxiosInstance {
  if (client) return client;
  client = axios.create({
    baseURL: IBKR_GATEWAY_BASE,
    withCredentials: true,
    httpsAgent: new https.Agent({ rejectUnauthorized: !IBKR_INSECURE_SSL }),
  });
  return client;
}

export async function getTickleSession(): Promise<string> {
  const c = getClient();
  const resp = await c.get('/v1/api/tickle');
  const session = resp.data?.session;
  if (!session) throw new Error('Missing session from /tickle');
  return session;
}

export async function ibkrGet<T = unknown>(path: string): Promise<T> {
  const c = getClient();
  const resp = await c.get<T>(path);
  return resp.data;
}
