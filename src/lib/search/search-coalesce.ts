import "server-only";

export type SearchCoalesceMode = "answer" | "documents" | "differentials";

export type SearchCoalesceKeyInput = {
  query: string;
  topK?: number;
  documentId?: string;
  documentIds?: string[];
  filters?: Record<string, unknown>;
  queryMode: string;
  mode: SearchCoalesceMode;
  documentLimit: number;
  includeRelatedDocuments: boolean;
};

type ScopedSearchInflight = {
  promise: Promise<Record<string, unknown>>;
  controller: AbortController;
  waiters: number;
  settled: boolean;
};

const scopedSearchInflight = new Map<string, ScopedSearchInflight>();

export function isSourceLibrarySearchMode(mode: SearchCoalesceMode) {
  return mode === "documents" || mode === "differentials";
}

export function scopedSearchKey(body: SearchCoalesceKeyInput, ownerId?: string | null, publicOnly = false) {
  return JSON.stringify({
    ownerId: ownerId ?? undefined,
    publicOnly,
    query: body.query.toLowerCase().replace(/\s+/g, " ").trim(),
    topK: body.topK ?? null,
    documentId: body.documentId ?? null,
    documentIds: body.documentIds?.length ? [...body.documentIds].sort() : [],
    filters: body.filters ?? {},
    queryMode: body.queryMode,
    mode: body.mode,
    documentLimit: body.documentLimit,
    includeRelatedDocuments: body.includeRelatedDocuments,
  });
}

export function callerAbortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError");
}

export function awaitWithCallerSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(callerAbortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(callerAbortReason(signal));
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

export function cloneSearchExecutionResult<T extends Record<string, unknown>>(payload: T, coalesced: boolean): T {
  const telemetry =
    payload.telemetry && typeof payload.telemetry === "object" ? (payload.telemetry as Record<string, unknown>) : {};
  return {
    ...payload,
    telemetry: {
      ...telemetry,
      coalesced,
    },
  };
}

export async function coalesceScopedSearch<T extends Record<string, unknown>>(
  key: string,
  producer: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  let entry = scopedSearchInflight.get(key);
  // Skip a flight already aborted by its last waiter (the `startFlight` pattern in
  // `site-content/site-content-record-cache.ts`, which is where it now lives).
  if (entry?.controller.signal.aborted) {
    if (scopedSearchInflight.get(key) === entry) scopedSearchInflight.delete(key);
    entry = undefined;
  }
  const coalesced = Boolean(entry);
  if (!entry) {
    const controller = new AbortController();
    const created: ScopedSearchInflight = {
      promise: Promise.resolve({}),
      controller,
      waiters: 0,
      settled: false,
    };
    created.promise = producer(controller.signal).finally(() => {
      created.settled = true;
      if (scopedSearchInflight.get(key) === created) scopedSearchInflight.delete(key);
    });
    scopedSearchInflight.set(key, created);
    entry = created;
  }
  entry.waiters += 1;
  try {
    return { payload: (await awaitWithCallerSignal(entry.promise, signal)) as T, coalesced };
  } finally {
    entry.waiters -= 1;
    // Drop the map entry immediately on last-waiter abort so a new healthy
    // caller cannot join the dying promise before the producer's .finally runs.
    if (entry.waiters === 0 && !entry.settled) {
      entry.controller.abort();
      if (scopedSearchInflight.get(key) === entry) scopedSearchInflight.delete(key);
    }
  }
}
