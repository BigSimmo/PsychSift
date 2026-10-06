export type ExpiringCacheEntry = { expiresAt: number };

export function readExpiringCacheEntry<K, V extends ExpiringCacheEntry>(cache: Map<K, V>, key: K, now = Date.now()) {
  const cached = cache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= now) {
    cache.delete(key);
    return null;
  }
  // True LRU: re-insert the key to refresh its position to most-recently used.
  cache.delete(key);
  cache.set(key, cached);
  return cached;
}

export function writeBoundedExpiringCacheEntry<K, V extends ExpiringCacheEntry>(
  cache: Map<K, V>,
  key: K,
  value: V,
  maxEntries: number,
  now = Date.now(),
) {
  for (const [cachedKey, cachedValue] of cache) {
    if (cachedValue.expiresAt <= now) cache.delete(cachedKey);
  }

  if (maxEntries <= 0) return;
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);

  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}
