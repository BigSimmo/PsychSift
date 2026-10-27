import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CHUNK_RELOAD_STORAGE_KEY,
  CHUNK_RELOAD_WINDOW_MS,
  installChunkLoadRecovery,
  isChunkLoadError,
  reloadOnceForChunkLoadError,
} from "@/lib/chunk-load-recovery";

// Owner report 26 Oct 2026: signing in on an iPhone in-app browser showed "This page didn't
// finish loading" after a deploy replaced the code files under the open page. One reload fixes
// it, so the page does that itself, once per minute at most.
function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    values,
  };
}

describe("chunk-load recovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it("recognises Safari's module failure and ignores ordinary errors", () => {
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError({ name: "ChunkLoadError", message: "" })).toBe(true);
    expect(isChunkLoadError(new Error("Invalid login credentials"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError("Loading chunk 1 failed")).toBe(false);
  });

  it("reloads the first time and records when", () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    expect(reloadOnceForChunkLoadError({ storage, now: 1_000_000, reload })).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(storage.values.get(CHUNK_RELOAD_STORAGE_KEY)).toBe("1000000");
  });

  it("does not loop: a second failure inside the window leaves the card to the reader", () => {
    const storage = memoryStorage({ [CHUNK_RELOAD_STORAGE_KEY]: "1000000" });
    const reload = vi.fn();
    expect(reloadOnceForChunkLoadError({ storage, now: 1_000_000 + CHUNK_RELOAD_WINDOW_MS - 1, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads again for a later deploy once the window has passed", () => {
    const storage = memoryStorage({ [CHUNK_RELOAD_STORAGE_KEY]: "1000000" });
    const reload = vi.fn();
    expect(reloadOnceForChunkLoadError({ storage, now: 1_000_000 + CHUNK_RELOAD_WINDOW_MS, reload })).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("never reloads offline, where the new build cannot download and the offline page would replace this one", () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    expect(reloadOnceForChunkLoadError({ storage, now: 1_000_000, reload, online: false })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(storage.values.has(CHUNK_RELOAD_STORAGE_KEY)).toBe(false);
  });

  it("never reloads without storage, because it could not tell a loop from a first try", () => {
    const reload = vi.fn();
    expect(reloadOnceForChunkLoadError({ storage: null, now: 1, reload })).toBe(false);
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => undefined,
    };
    expect(reloadOnceForChunkLoadError({ storage: throwing, now: 1, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads for a lazy import that fails inside a click handler, which no boundary sees", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    const cleanup = installChunkLoadRecovery(window);
    const reject = (reason: unknown) => {
      const event = new Event("unhandledrejection") as PromiseRejectionEvent;
      Object.defineProperty(event, "reason", { value: reason });
      window.dispatchEvent(event);
    };
    reject(new Error("Network request failed"));
    expect(reload).not.toHaveBeenCalled();
    reject(
      new TypeError("Failed to fetch dynamically imported module: https://psychiatry.tools/_next/static/chunks/a.js"),
    );
    expect(reload).toHaveBeenCalledOnce();
    cleanup();
    window.sessionStorage.clear();
    reject(new TypeError("Importing a module script failed."));
    expect(reload).toHaveBeenCalledOnce();
  });
});
