# Server README

Quick instructions to run the local Saxo proxy and a small example request.

Setup
-----
1. Install dependencies:

```bash
cd server
npm install
```

2. Copy `.env.example` to `.env` and fill any missing credentials (only required for forwarding to Saxo):

```bash
cp .env.example .env
# Edit .env to set SAXO_TOKEN, SAXO_CLIENT_KEY, PROXY_API_KEY, etc.
```

- For AI Quant (Perplexity), set `PPLX_API_KEY` (required) and optionally `PPLX_MODEL` (default: pplx-70b-online).

Running the proxy
-----------------

**Option 1: Development mode with auto-reload**

Use `npm run dev` to start the server with `nodemon`. The server will auto-restart if you edit `index.js`:

```bash
cd server
npm run dev
```

Press `Ctrl+C` to stop.

**Option 2: Production-like foreground**

Start the server without auto-reload:

```bash
cd server
npm start
```

This will run `node index.js` and bind to `http://localhost:3000` by default.

**Option 3: Detached background (with PID file)**

Start the server in the background and save the PID:

```bash
cd server
npm run start-detached
```

This creates `server.pid` and logs to `server.log`. To stop:

```bash
cd server
npm run stop-detached
```

**Option 4: macOS launchd (auto-start on login)**

For persistent background running:

1. Copy the plist template to your LaunchAgents folder:

```bash
cp server/launchd/com.openrange.saxo-proxy.plist ~/Library/LaunchAgents/
```

2. Edit `~/Library/LaunchAgents/com.openrange.saxo-proxy.plist` and replace all `/PATH/TO/REPO` with the absolute path to your repository (e.g., `/Users/jamesharris/Server`).

3. Load the service:

```bash
launchctl load ~/Library/LaunchAgents/com.openrange.saxo-proxy.plist
```

4. To unload:

```bash
launchctl unload ~/Library/LaunchAgents/com.openrange.saxo-proxy.plist
```

Logs will appear in `server/server.out.log` and `server/server.err.log`.

Example client
--------------

There is a small example script that makes two test requests:

- `server/examples/request_example.js` — calls `/api/health` and `/api/saxo/` using `PROXY_API_KEY` from `.env` or `process.env`.

Run it with:

```bash
node server/examples/request_example.js
```

Security
--------
- Do not commit your `.env` with live secrets. Use `.env.example` for placeholders.
- Keep `PROXY_API_KEY` secret and set different keys for production.

Stopping the server
-------------------

If started with `nohup`, find the PID and kill it:

```bash
ps aux | grep node | grep index.js
kill <PID>
```

Notes
-----
- The proxy will return `502` if `PROXY_API_KEY` or `SAXO_TOKEN` are not configured appropriately.
- The example request may return a `404` from Saxo for root path — that is expected unless a valid Saxo endpoint is used.
