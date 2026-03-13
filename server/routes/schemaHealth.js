const express = require('express');
const { getSchemaHealthSnapshot } = require('../system/schemaValidator');

const router = express.Router();

router.get('/system/schema-health', async (_req, res) => {
  try {
    const snapshot = await getSchemaHealthSnapshot();
    return res.json(snapshot);
  } catch (error) {
    return res.status(500).json({
      schemaStatus: 'error',
      missingTables: [],
      missingColumns: {},
      unexpectedTables: [],
      rowCounts: {},
      error: error.message || 'Schema health check failed',
    });
  }
});

module.exports = router;
