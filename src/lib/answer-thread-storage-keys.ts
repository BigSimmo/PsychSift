/** The saved answer thread's storage key. Owner-scoped copies add `:<ownerId>`. */
export const answerThreadStorageKey = "clinical-kb-answer-thread";

export function clearPersistedAnswerThread(ownerId?: string) {
  if (typeof window === "undefined") return;
  try {
    if (ownerId) {
      window.sessionStorage.removeItem(`${answerThreadStorageKey}:${ownerId}`);
      window.sessionStorage.removeItem(answerThreadStorageKey);
      window.localStorage.removeItem(answerThreadStorageKey);
      return;
    }
    window.localStorage.removeItem(answerThreadStorageKey);
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index);
      if (key === answerThreadStorageKey || key?.startsWith(`${answerThreadStorageKey}:`)) {
        window.sessionStorage.removeItem(key);
      }
    }
  } catch {
    // Thread persistence is a convenience only.
  }
}
