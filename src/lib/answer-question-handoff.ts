/**
 * Keeps an answered Clinical question out of the address bar and browser history
 * (privacy audit FE-01, owner decision 2026-10-26).
 *
 * A submitted Answer URL used to read `/?mode=answer&q=<question>&run=1`, so the
 * question sat in the address bar, in browser history and in any link copied from
 * it. It now reads `/?mode=answer&ask=<random id>&run=1`, and the question itself
 * is kept in this tab's sessionStorage under that id. Refresh and Back in the same
 * tab still find it. A copied link, a new tab or a closed tab do not, and land on
 * the Answer home instead of re-asking.
 *
 * Only submitted (`run=1`) Answer URLs change. Drafts and other modes keep `q`.
 */

import { subscribeAccountTransition } from "@/lib/account-scoped-browser-state";

export const answerHandoffParam = "ask";

const storagePrefix = "clinical.answer-question.";
const indexKey = `${storagePrefix}index`;
// Enough for Back through a long session without letting the tab's storage grow unbounded.
const maxStoredQuestions = 30;
const maxQuestionLength = 4000;
const refPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type HandoffStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// When sessionStorage is blocked the question still never goes in the address.
// It survives in-app navigation through this map, but not a refresh.
const memoryStore = new Map<string, string>();
// Sign-out and account switches sweep the sessionStorage copies (account-device-sweep.ts);
// the in-memory copies go with them, so the next person cannot resolve an old `ask` id.
subscribeAccountTransition(() => memoryStore.clear());

function sessionStorageOrNull(): HandoffStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function readIndex(storage: HandoffStorage): string[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(indexKey) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((ref): ref is string => typeof ref === "string" && refPattern.test(ref))
      : [];
  } catch {
    return [];
  }
}

export function readStashedAnswerQuestion(
  ref: string | null | undefined,
  storage: HandoffStorage | null = sessionStorageOrNull(),
): string | null {
  if (!ref || !refPattern.test(ref)) return null;
  try {
    const stored = storage?.getItem(`${storagePrefix}${ref}`);
    if (stored?.trim()) return stored;
  } catch {
    // Fall through to the in-memory copy.
  }
  return memoryStore.get(ref) ?? null;
}

/** Stores the question and returns the id that stands for it in the address. */
export function stashAnswerQuestion(
  question: string,
  storage: HandoffStorage | null = sessionStorageOrNull(),
  createRef: () => string = () => crypto.randomUUID(),
): string | null {
  const trimmed = question.trim().slice(0, maxQuestionLength);
  if (!trimmed) return null;
  // The same question keeps its id, so rewriting the address after an answer
  // does not churn it.
  for (const [ref, stored] of memoryStore) if (stored === trimmed) return ref;
  const index = storage ? readIndex(storage) : [];
  for (const ref of index) if (readStashedAnswerQuestion(ref, storage) === trimmed) return ref;

  const ref = createRef();
  if (!refPattern.test(ref)) return null;
  memoryStore.set(ref, trimmed);
  while (memoryStore.size > maxStoredQuestions) memoryStore.delete(memoryStore.keys().next().value as string);
  if (!storage) return ref;
  try {
    storage.setItem(`${storagePrefix}${ref}`, trimmed);
    const nextIndex = [...index, ref];
    for (const dropped of nextIndex.splice(0, Math.max(0, nextIndex.length - maxStoredQuestions))) {
      storage.removeItem(`${storagePrefix}${dropped}`);
    }
    storage.setItem(indexKey, JSON.stringify(nextIndex));
  } catch {
    // Quota or privacy settings: the in-memory copy still serves this page.
  }
  return ref;
}

function isSubmittedAnswerParams(pathname: string, params: URLSearchParams) {
  if (pathname !== "/" || params.get("run") !== "1") return false;
  const mode = params.get("mode");
  // A bare `/?q=…&run=1` renders Answer, the default mode.
  return mode === "answer" || mode === null;
}

/**
 * Rewrites a submitted Answer href so it carries an id instead of the question.
 * Every other href is returned unchanged. Client-side only: on the server, or when
 * the question cannot be stored at all, the href is returned as it was.
 */
export function privateAnswerHref(href: string, storage: HandoffStorage | null = sessionStorageOrNull()): string {
  if (typeof window === "undefined") return href;
  let url: URL;
  try {
    url = new URL(href, window.location.origin);
  } catch {
    return href;
  }
  if (url.origin !== window.location.origin || !isSubmittedAnswerParams(url.pathname, url.searchParams)) return href;
  const question = (url.searchParams.get("q") ?? url.searchParams.get("query") ?? "").trim();
  if (!question) return href;
  const ref = stashAnswerQuestion(question, storage);
  if (!ref) return href;
  url.searchParams.delete("q");
  url.searchParams.delete("query");
  url.searchParams.set(answerHandoffParam, ref);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * The URL's params as the dashboard reads them: an `ask` id is resolved back to
 * `q` from this tab's storage. An id this tab does not hold resolves to nothing.
 */
export function resolveAnswerHandoffParams<T extends URLSearchParams>(
  params: T,
  question?: string | null,
): T | URLSearchParams {
  const ref = params.get(answerHandoffParam);
  if (!ref || params.has("q") || params.has("query")) return params;
  const resolved = question === undefined ? readStashedAnswerQuestion(ref) : question;
  if (!resolved) return params;
  const next = new URLSearchParams(params);
  next.set("q", resolved);
  return next;
}
