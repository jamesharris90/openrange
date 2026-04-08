function getByPath(record, fieldPath) {
  if (!record || typeof record !== 'object') return undefined;
  if (!fieldPath || typeof fieldPath !== 'string') return undefined;
  return fieldPath.split('.').reduce((acc, part) => {
    if (acc == null || typeof acc !== 'object') return undefined;
    return acc[part];
  }, record);
}

function isPresent(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function completenessScore(record, requiredFields = []) {
  if (!Array.isArray(requiredFields) || requiredFields.length === 0) return 100;

  let presentCount = 0;
  for (const fieldPath of requiredFields) {
    const value = getByPath(record, String(fieldPath || ''));
    if (isPresent(value)) {
      presentCount += 1;
    }
  }

  const raw = (presentCount / requiredFields.length) * 100;
  return Number(raw.toFixed(2));
}

module.exports = {
  completenessScore,
};
