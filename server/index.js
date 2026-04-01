const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '.env') });
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
}

const { createV2App } = require('./v2');

const PORT = Number(process.env.PORT || 3007);

console.log('🚫 LEGACY SYSTEM DISABLED — V2 MODE ACTIVE');

const app = createV2App();

const server = app.listen(PORT, () => {
  console.log(`🚀 V2 backend running on port ${PORT}`);
});

module.exports = {
  app,
  server,
};
