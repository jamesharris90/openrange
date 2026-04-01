const RUNTIME_MODE = String(process.env.OPENRANGE_RUNTIME_MODE || 'v2').trim().toLowerCase();

function getRuntimeMode() {
  return RUNTIME_MODE;
}

function isLegacySystemDisabled() {
  return RUNTIME_MODE === 'v2' || RUNTIME_MODE === 'manual';
}

module.exports = {
  getRuntimeMode,
  isLegacySystemDisabled,
};