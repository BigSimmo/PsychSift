import { describe, expect, it } from "vitest";

import { readExpiringCacheEntry, writeBoundedExpiringCacheEntry } from "@/lib/bounded-ttl-cache";

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
});
