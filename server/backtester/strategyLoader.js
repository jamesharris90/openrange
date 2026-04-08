const fs = require('fs');
const path = require('path');

const STRATEGY_DIR = path.join(__dirname, 'strategies');

function validateStrategyModule(strategy) {
  const requiredFields = ['id', 'name', 'category', 'timeframe', 'holdPeriod', 'dataRequired', 'scan', 'evaluate'];
  const missing = requiredFields.filter((field) => typeof strategy[field] === 'undefined');
  if (missing.length) {
    throw new Error(`Strategy module is missing required fields: ${missing.join(', ')}`);
  }
  if (typeof strategy.scan !== 'function' || typeof strategy.evaluate !== 'function') {
    throw new Error(`Strategy ${strategy.id || 'unknown'} does not implement scan/evaluate functions`);
  }
}

function loadStrategyModules() {
  const files = fs.readdirSync(STRATEGY_DIR)
    .filter((file) => file.endsWith('.js'))
    .filter((file) => !file.startsWith('_'))
    .sort();

  return files.map((file) => {
    const strategy = require(path.join(STRATEGY_DIR, file));
    validateStrategyModule(strategy);
    return strategy;
  });
}

module.exports = {
  loadStrategyModules,
};