import { describe, expect, it } from "vitest";

import {
  readBoundedLruEntry,
  readExpiringCacheEntry,
  writeBoundedExpiringCacheEntry,
  writeBoundedLruEntry,
} from "@/lib/bounded-ttl-cache";

describe("bounded TTL cache", () => {
  it("removes expired entries when they are read", () => {
    const cache = new Map([["expired", { expiresAt: 99, value: "stale" }]]);

    expect(readExpiringCacheEntry(cache, "expired", 100)).toBeNull();
    expect(cache.has("expired")).toBe(false);
  });

  it("prunes expired entries before enforcing the entry limit", () => {
    const cache = new Map([
      ["expired", { expiresAt: 99, value: "stale" }],
      ["live", { expiresAt: 200, value: "current" }],
    ]);

    writeBoundedExpiringCacheEntry(cache, "new", { expiresAt: 300, value: "new" }, 2, 100);

    expect([...cache.keys()]).toEqual(["live", "new"]);
  });

  it("evicts the oldest live entry when the cache exceeds its bound", () => {
    const cache = new Map([
      ["first", { expiresAt: 200, value: 1 }],
      ["second", { expiresAt: 200, value: 2 }],
    ]);

    writeBoundedExpiringCacheEntry(cache, "third", { expiresAt: 200, value: 3 }, 2, 100);

    expect([...cache.keys()]).toEqual(["second", "third"]);
  });

  it("refreshes access order on read to guarantee true LRU eviction", () => {
    const cache = new Map([
      ["first", { expiresAt: 200, value: 1 }],
      ["second", { expiresAt: 200, value: 2 }],
    ]);

    // Read 'first' so it becomes most recently used
    const accessed = readExpiringCacheEntry(cache, "first", 100);
    expect(accessed?.value).toBe(1);

    // Write 'third' with bound 2: should evict 'second', retaining 'first' and 'third'
    writeBoundedExpiringCacheEntry(cache, "third", { expiresAt: 200, value: 3 }, 2, 100);

    expect([...cache.keys()]).toEqual(["first", "third"]);
  });

  it("handles falsy keys (e.g. empty string) correctly without premature loop break", () => {
    const cache = new Map<string, { expiresAt: number; value: number }>();
    writeBoundedExpiringCacheEntry(cache, "", { expiresAt: 200, value: 0 }, 1, 100);
    expect(cache.has("")).toBe(true);

    // Writing a second key should evict the empty string key because bound is 1
    writeBoundedExpiringCacheEntry(cache, "second", { expiresAt: 200, value: 2 }, 1, 100);
    expect(cache.has("")).toBe(false);
    expect(cache.has("second")).toBe(true);
  });

  it("supports non-expiring bounded LRU reads and writes", () => {
    const cache = new Map<string, number[]>();
    writeBoundedLruEntry(cache, "k1", [1, 2], 2);
    writeBoundedLruEntry(cache, "k2", [3, 4], 2);
    expect(cache.size).toBe(2);

    // Read k1 to make it most recently used
    expect(readBoundedLruEntry(cache, "k1")).toEqual([1, 2]);

    // Write k3: should evict k2 (oldest)
    writeBoundedLruEntry(cache, "k3", [5, 6], 2);
    expect(cache.has("k1")).toBe(true);
    expect(cache.has("k2")).toBe(false);
    expect(cache.has("k3")).toBe(true);
  });
});
