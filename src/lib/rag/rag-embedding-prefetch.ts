export type EmbeddingPrefetch<T> = {
  promise: Promise<T> | null;
  query: string | null;
};

export type EmbeddingPrefetchOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
};

/** Keeps telemetry payloads from drifting when a retrieval starts an embedding warm-up. */
export function embeddingTelemetryFields(telemetry: { embedding_cache_hit: boolean; embedding_prefetched?: boolean }) {
  return {
    embedding_cache_hit: telemetry.embedding_cache_hit,
    embedding_prefetched: telemetry.embedding_prefetched,
  };
}

/** Starts an optional query-embedding flight without changing the awaited retrieval path. */
export function prefetchEmbedding<T>(
  shouldPrefetch: boolean,
  query: string,
  createEmbedding: (options: EmbeddingPrefetchOptions) => Promise<T>,
  options: EmbeddingPrefetchOptions = {},
): EmbeddingPrefetch<T> {
  if (!shouldPrefetch) return { promise: null, query: null };

  let promise: Promise<T>;
  try {
    promise = Promise.resolve(createEmbedding(options));
  } catch (error) {
    promise = Promise.reject(error);
  }
  void promise.catch(() => undefined);
  return { promise, query };
}
