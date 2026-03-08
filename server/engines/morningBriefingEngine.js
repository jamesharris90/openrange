const { runMorningBriefEngine } = require('./morningBriefEngine');

async function generateMorningBriefing(options = {}) {
  return runMorningBriefEngine(options);
}

module.exports = {
  generateMorningBriefing,
};
