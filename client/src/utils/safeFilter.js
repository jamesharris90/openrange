export function safeFilter(list, fn) {
  if (!Array.isArray(list)) return [];
  return list.filter(fn);
}
