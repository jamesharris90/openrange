async function startEngines() {
  console.log('🚫 LEGACY SYSTEM DISABLED — V2 MODE ACTIVE');
  return {
    success: true,
    legacy_disabled: true,
  };
}

async function startEnginesSequentially() {
  console.log('🚫 LEGACY SYSTEM DISABLED — V2 MODE ACTIVE');
  return {
    success: true,
    legacy_disabled: true,
  };
}

module.exports = {
  startEngines,
  startEnginesSequentially,
};
