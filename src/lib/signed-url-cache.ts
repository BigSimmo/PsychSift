"use client";

type SignedUrlPayload = {
  url: string;
  caption?: string;
  mimeType?: string;
  fileType?: string;
  expiresAt?: string;
};

type SignedUrlCacheEntry = {
  payload: SignedUrlPayload;
  // Absolute epoch-ms after which the entry must not be served. Always set:
  // derived from payload.expiresAt when present, otherwise a conservative
  // default shorter than the issued signed-URL lifetime (RET-H3).
  expiresAtMs: number;
};

// Signed URLs are bearer credentials for private document images. Bound the cache
// and never serve an entry past its hard expiry so a leaked/over-retained URL is
// not usable indefinitely and a missing-expiry payload cannot be cached forever.
const SIGNED_URL_CACHE_MAX_SIZE = 256;
// Issued signed URLs live 10 minutes (see signed-url routes). Use a shorter TTL
// for payloads that omit expiresAt so they self-heal well before the URL dies.
const SIGNED_URL_DEFAULT_TTL_MS = 5 * 60_000;
// Refresh a few seconds before the hard expiry to avoid serving a near-dead URL.
const SIGNED_URL_EXPIRY_SKEW_MS = 60_000;

const signedUrlCache = new Map<string, SignedUrlCacheEntry>();

export function getCachedSignedUrl(endpoint: string) {
  const cached = signedUrlCache.get(endpoint);
  if (!cached) return null;

  if (cached.expiresAtMs - Date.now() <= SIGNED_URL_EXPIRY_SKEW_MS) {
    signedUrlCache.delete(endpoint);
    return null;
  }

  // LRU: mark as most-recently-used.
  signedUrlCache.delete(endpoint);
  signedUrlCache.set(endpoint, cached);
  return cached.payload;
}

export function setCachedSignedUrl(endpoint: string, payload: SignedUrlPayload) {
  const now = Date.now();
  for (const [key, entry] of signedUrlCache) {
    if (entry.expiresAtMs - now <= SIGNED_URL_EXPIRY_SKEW_MS) {
      signedUrlCache.delete(key);
    }
  }

  const parsedExpiry = payload.expiresAt ? Date.parse(payload.expiresAt) : NaN;
  const expiresAtMs = Number.isFinite(parsedExpiry) ? parsedExpiry : now + SIGNED_URL_DEFAULT_TTL_MS;

  if (signedUrlCache.has(endpoint)) signedUrlCache.delete(endpoint);
  signedUrlCache.set(endpoint, { payload, expiresAtMs });

  while (signedUrlCache.size > SIGNED_URL_CACHE_MAX_SIZE) {
    const oldestKey = signedUrlCache.keys().next().value;
    if (oldestKey === undefined) break;
    signedUrlCache.delete(oldestKey);
  }
  return payload;
}

export function clearCachedSignedUrl(endpoint: string) {
  signedUrlCache.delete(endpoint);
}

export function clearCachedSignedUrlsForDocument(documentId: string) {
  for (const key of signedUrlCache.keys()) {
    if (key.includes(documentId)) {
      signedUrlCache.delete(key);
    }
  }
}

export function clearSignedUrlCache() {
  signedUrlCache.clear();
}
