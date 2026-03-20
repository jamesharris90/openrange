const cache = new Map<string, unknown>();

export async function cachedFetch<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (cache.has(key)) return cache.get(key) as T;

  const data = await fn();
  cache.set(key, data);

  setTimeout(() => cache.delete(key), 10000);

  return data;
}
