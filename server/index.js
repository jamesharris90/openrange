const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '.env') });
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
}

const { createV2App } = require('./v2');
const { clearResearchRouteCaches, warmResearchRouteResources } = require('./routes/research');
const {
  verifySnapshotTableExists,
  isSnapshotStartupSkippableError,
} = require('./v2/services/snapshotService');

const PORT = Number(process.env.PORT || 3007);

console.log('🚫 LEGACY SYSTEM DISABLED — V2 MODE ACTIVE');

let app = null;
let server = null;

async function verifySnapshotStartup() {
  try {
    await verifySnapshotTableExists();
  } catch (error) {
    if (!isSnapshotStartupSkippableError(error)) {
      console.error('[STARTUP] screener snapshot verification failed', {
        error: error.message,
      });
      return;
    }

    console.warn('[STARTUP] screener snapshot verification skipped', {
      error: error.message,
    });
  }
}

async function startServer() {
  clearResearchRouteCaches();
  app = createV2App();
  server = app.listen(PORT, () => {
    console.log(`🚀 V2 backend running on port ${PORT}`);
  });

  void verifySnapshotStartup();
  void warmResearchRouteResources().catch((error) => {
    console.warn('[STARTUP] research coverage warmup skipped', {
      error: error.message,
    });
  });

  return { app, server };
}

void startServer().catch((error) => {
  console.error('[STARTUP] failed to initialize backend', { error: error.message });
  process.exit(1);
});

module.exports = {
  get app() {
    return app;
  },
  get server() {
    return server;
  },
  startServer,
};
