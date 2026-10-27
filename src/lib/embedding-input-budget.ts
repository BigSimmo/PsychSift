// The installed OpenAI SDK's EmbeddingCreateParams documents 8,192 tokens per
// input and 300,000 per request. These models use byte-level BPE: UTF-8 bytes
// provide a conservative token upper bound, not an exact token count.
export const EMBEDDING_MAX_INPUT_UTF8_BYTES = 8_191;
export const EMBEDDING_MAX_BATCH_UTF8_BYTES = 300_000;

const knownEmbeddingBudgetModels = new Set([
  "text-embedding-3-small",
  "text-embedding-3-large",
  "text-embedding-ada-002",
]);

export function hasKnownEmbeddingBudget(model: string): boolean {
  return knownEmbeddingBudgetModels.has(model);
}

export class EmbeddingRequestBudgetError extends Error {
  readonly code = "EMBEDDING_INPUT_EXCEEDS_REQUEST_BUDGET";

  constructor() {
    super("EMBEDDING_INPUT_EXCEEDS_REQUEST_BUDGET");
    this.name = "EmbeddingRequestBudgetError";
  }
}

/** Preserve each input verbatim while bounding both request count and bytes. */
export function batchEmbeddingInputs(texts: string[], maxInputs: number, model: string): string[][] {
  if (!Number.isInteger(maxInputs) || maxInputs <= 0 || maxInputs > 2_048) {
    throw new Error("Embedding batch size must be a positive integer at most 2048.");
  }
  const bounded = hasKnownEmbeddingBudget(model);
  const batches: string[][] = [];
  let current: string[] = [];
  let currentBytes = 0;
  for (const text of texts) {
    const bytes = bounded ? Buffer.byteLength(text, "utf8") : 0;
    // An individually oversized input is invalid even when the request total fits.
    // Validate the entire list before any caller can dispatch a partial build;
    // refuse instead of silently truncating a source passage or table row.
    if (bytes > EMBEDDING_MAX_INPUT_UTF8_BYTES) throw new EmbeddingRequestBudgetError();
    if (current.length && (current.length >= maxInputs || currentBytes + bytes > EMBEDDING_MAX_BATCH_UTF8_BYTES)) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(text);
    currentBytes += bytes;
  }
  if (current.length) batches.push(current);
  return batches;
}
