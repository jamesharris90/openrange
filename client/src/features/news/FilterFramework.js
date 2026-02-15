export function mergeDefaults(defaults, overrides) {
  return { ...defaults, ...(overrides || {}) };
}

export function isEmptyFilter(values = {}) {
  return Object.values(values).every(v => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0));
}
