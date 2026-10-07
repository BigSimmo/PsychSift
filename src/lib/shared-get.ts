/**
 * sharedGet: one network request for identical reads that start together.
 *
 * Work-mode pages are built from small hooks that each read what they need, so
 * a single screen often asks for the same address two or three times at once
 * (My Day Today asked /api/roster/team three times). On ward wifi each repeat
 * is a full round trip. sharedGet lets every caller that asks while a read is
 * still in flight share that one request.
 *
 * Nothing is kept once the request settles: the next call after that goes to
 * the network again, so freshness and `cache: "no-store"` behave exactly as
 * before. Each caller gets its own Response clone and its own abort: aborting
 * one caller never cancels the read for the others.
 *
 * Only for plain GETs with no request body or custom headers. Writes must keep
 * calling fetch directly.
 */

const inFlight = new Map<string, Promise<Response>>();
let epoch = 0;

function abortError(): Error {
  if (typeof DOMException === "function") return new DOMException("The operation was aborted.", "AbortError");
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

export function sharedGet(url: string, init?: { signal?: AbortSignal; cache?: RequestCache }): Promise<Response> {
  const signal = init?.signal;
  if (signal?.aborted) return Promise.reject(abortError());

  const key = `${epoch}|${init?.cache ?? "no-store"}|${url}`;
  let request = inFlight.get(key);
  if (!request) {
    request = fetch(url, { cache: init?.cache ?? "no-store" });
    inFlight.set(key, request);
    const settle = () => {
      if (inFlight.get(key) === request) inFlight.delete(key);
    };
    request.then(settle, settle);
  }

  const mine = request.then((response) => response.clone());
  if (!signal) return mine;
  return new Promise<Response>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    mine.then(
      (response) => {
        signal.removeEventListener("abort", onAbort);
        resolve(response);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Forget every in-flight read, so a caller after sign-in, sign-out or an
 * account switch can never be handed the previous person's response. Call it
 * wherever cached work data is cleared.
 */
export function resetSharedGets(): void {
  epoch += 1;
  inFlight.clear();
}
