function safeNumber(value) {
  if (value === null || value === undefined) return 0;
  if (Number.isNaN(value)) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

module.exports = {
  safeNumber,
};
