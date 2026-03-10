# OPENRANGE PROXY KEY TRACE

Date: 2026-03-09
Type: Diagnostic scan only (no code changes)

## Scope

Searched requested terms across requested directories:
- Terms: `PROXY_API_KEY`, `proxy key`, `x-proxy-key`, `proxyKey`, `proxy_key`
- Directories scanned: `server`, `client`, `scripts`, `config`, `middleware`, `modules`, `routes`, `engines`

Notes:
- `middleware`, `modules`, `routes`, `engines` at workspace root have no relevant hits.
- Primary runtime code is under `server/**` and `scripts/**`.

## Step 1: Files Referencing Requested Terms

Matches found in first-party code:
- `server/routes/newsletter.js`
- `server/utils/envCheck.js`
- `scripts/run-acceptance-smoke.js`

No matches in:
- `client/**`
- `config/**`
- root-level `middleware/**`, `modules/**`, `routes/**`, `engines/**`

## Step 2: Runtime Usage Classification

### `server/routes/newsletter.js`
Snippet:
```js
const apiKey = String(req.headers['x-api-key'] || '').trim();
if (!process.env.PROXY_API_KEY || apiKey !== process.env.PROXY_API_KEY) {
  return res.status(401).json({ ok: false, error: 'Unauthorized' });
}
```
Classification: `B — proxy route`
Reason: Route-level auth gate comparing incoming header to `process.env.PROXY_API_KEY`.

### `server/utils/envCheck.js`
Snippet:
```js
const REQUIRED_KEYS = [
  'JWT_SECRET',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_KEY',
  'PROXY_API_KEY',
];
```
Classification: `D — unused reference` (for auth flow)
Reason: Presence check only; does not enforce request authorization.

### `scripts/run-acceptance-smoke.js`
Snippet:
```js
...(process.env.PROXY_API_KEY ? { 'x-api-key': process.env.PROXY_API_KEY } : {}),
```
Classification: `D — unused reference` (runtime server security)
Reason: Test client helper; sends header if available but does not protect server routes.

## Step 3: Request Flow Trace

### Middleware and route flow
Snippet from `server/index.js`:
```js
app.use(intelligenceRoutes);
app.use(newsletterRoutes);

app.use(generalLimiter);
app.use(authMiddleware);
```

Key observation:
- `newsletterRoutes` are mounted before global `authMiddleware`.
- `PROXY_API_KEY` protection is route-local in `newsletter.js`.

### Actual PROXY key gate
Pattern in code:
```js
if (!process.env.PROXY_API_KEY || apiKey !== process.env.PROXY_API_KEY)
```
with header:
```js
req.headers['x-api-key']
```

### Protected endpoint(s)
- `POST /api/newsletter/send` (requires `x-api-key` matching `PROXY_API_KEY`)

### Not found
- No usage of `req.headers["x-proxy-key"]`
- No usage of `req.headers["proxy-key"]`
- No `process.env.PROXY_API_KEY` check inside shared security middleware

## Step 4: Dead Config Detection

`PROXY_API_KEY` is not dead configuration globally because it is actively used in:
- `server/routes/newsletter.js` (`POST /api/newsletter/send`)

However:
- It is not used as a broad global API auth key despite documentation references.
- Current use is narrow and endpoint-specific.

## Step 5: Hardcoded Key Detection

Searched first-party code for literal header key/token patterns involving:
- `x-proxy-key`
- `x-api-key`
- `Authorization`
- `Bearer`

Findings:
- No literal production proxy key value hardcoded in first-party runtime code.
- One test-only literal found in `server/tests/users.test.js`:
  - `'Authorization', 'Bearer invalid-token'` (non-secret placeholder).

## Step 6: Is `PROXY_API_KEY` Actually Required?

Yes, currently required for one endpoint:
- `POST /api/newsletter/send`

If `PROXY_API_KEY` is missing, that route always returns `401` by design.

## Env Presence Check

Current `.env` files checked:
- `/Users/jamesharris/Server/.env`
- `/Users/jamesharris/Server/server/.env`

Result:
- `PROXY_API_KEY` is not present in either file.

## Step 7: Recommendation

**B — variable required but missing in `.env`**

Why:
- `PROXY_API_KEY` is actively enforced in `server/routes/newsletter.js`.
- It is absent from current env files, so the protected route cannot be authorized successfully.
