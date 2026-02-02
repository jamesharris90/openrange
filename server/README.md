# Saxo Proxy

This small Express proxy forwards requests from the frontend to the Saxo OpenAPI so that sensitive credentials (tokens, client keys) are kept on the server.

Setup

1. Copy `.env.example` to `.env` and set your Saxo credentials.

2. Install dependencies and start the server:

```bash
cd server
npm install
npm start
```

3. The frontend should point to `/api/saxo` (already configured in `config.js`). The proxy forwards requests to the real Saxo endpoint and injects the `Authorization` header using `SAXO_TOKEN`.

Security notes

- Do not commit `.env` to source control. Add it to `.gitignore`.
- Rotate tokens immediately if they were previously exposed in the repo.
- Implement extra auth on the proxy (e.g., API keys, IP allowlist) before exposing it publicly.
