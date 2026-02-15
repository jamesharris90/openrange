# Saxo OAuth2 Demo (Authorization Code Grant)

Minimal Express + TypeScript app that performs a live OAuth2 Authorization Code flow against Saxo Bank OpenAPI, stores tokens in a server session, and calls a sample account endpoint.

## Prerequisites
- Node.js 18+
- Saxo app credentials (Authorization Code grant) with redirect URI allowed: `http://localhost:3000/auth/callback`

## Environment
Create a `.env` in the project root:
```
SAXO_APP_KEY=your_app_key
SAXO_APP_SECRET=your_app_secret
SAXO_REDIRECT_URI=http://localhost:3000/auth/callback
SAXO_SCOPE=read
SESSION_SECRET=change_me
SAXO_AUTH_URL=https://live.logonvalidation.net/authorize
SAXO_TOKEN_URL=https://live.logonvalidation.net/token
SAXO_OPENAPI_BASE=https://gateway.saxobank.com/openapi/
PORT=3000
```

## Install & Run
```
npm install
npm run dev      # watch mode via ts-node-dev
# or
npm run build && npm start
```
Open http://localhost:3000 and click **Sign in with Saxo**.

## Flow
- `GET /` shows the sign-in link.
- `GET /auth/saxo` builds the authorize URL with state and redirects to Saxo.
- `GET /auth/callback` validates state, exchanges code for tokens, saves to session, and redirects to `/dashboard`.
- `GET /dashboard` ensures an access token exists, refreshes if expired, and calls `port/v1/accounts/me` using `Authorization: Bearer <access_token>`.

## Where to add more calls
See `src/saxoClient.ts` for helpers; call `callOpenApi('<path>', accessToken)` with any Saxo OpenAPI path. Add new routes/views under `src/routes` and `views`.

## Notes
- Uses `helmet` and `express-session` (HTTP-only cookie). In production set `cookie.secure=true` and serve over HTTPS.
- Errors are logged server-side and rendered as friendly messages client-side. Tokens/secrets are never logged.
