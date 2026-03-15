export function safeArray(data) {
  return Array.isArray(data) ? data : [];
}

export function safeObject(data) {
  return data && typeof data === 'object' ? data : {};
}
