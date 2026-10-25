/**
 * Shared signed-URL fetch helper for document preview and download.
 * Kept outside DocumentViewer so expiry refresh and initial load cannot drift.
 */

export type SignedUrlResponsePayload = {
  url?: string;
  caption?: string;
  mimeType?: string;
  fileType?: string;
  expiresAt?: string;
  error?: string;
};

export async function requestSignedUrlPayload(
  endpoint: string,
  options: {
    signal: AbortSignal;
    headers: HeadersInit | undefined;
    onUnauthorized: () => void;
    errorMessage: string;
  },
): Promise<SignedUrlResponsePayload> {
  const response = await fetch(endpoint, { signal: options.signal, headers: options.headers });
  if (response.status === 401) options.onUnauthorized();
  // A proxy or gateway can answer with an HTML or empty body. That must still reach
  // the sign-in handling above and the friendly message, not surface a parser error.
  const payload: SignedUrlResponsePayload | null = await response.json().catch(() => null);
  if (!response.ok || !payload) throw new Error(payload?.error || options.errorMessage);
  return payload;
}

/** Deduplicate detail rows by id while preserving first-seen order. */
export function rowsById<T extends { id: string }>(incoming: T[]) {
  const rows = new Map<string, T>();
  for (const row of incoming) rows.set(row.id, row);
  return Array.from(rows.values());
}
