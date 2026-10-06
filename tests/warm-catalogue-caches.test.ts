import { afterEach, describe, expect, it, vi } from "vitest";

import { clearCatalogueSeedFallbackCooldown } from "@/lib/site-content/catalogue-seed-fallback";
import { clearSiteContentRecordCache } from "@/lib/site-content/site-content-record-cache";
import {
  catalogueListWarmKinds,
  catalogueSearchWarmBudgetMs,
  catalogueSearchWarmKinds,
  warmCanonicalCatalogueSearchCaches,
} from "@/lib/site-content/warm-catalogue-caches";

const { readCanonicalSiteContentRecords, markCatalogueProcessConnectionWarmed } = vi.hoisted(() => ({
  readCanonicalSiteContentRecords: vi.fn(),
  markCatalogueProcessConnectionWarmed: vi.fn(),
}));

vi.mock("@/lib/site-content/site-content-publication", () => ({
  readCanonicalSiteContentRecords,
}));

vi.mock("@/lib/site-content/catalogue-seed-fallback", async () => {
  const actual = await vi.importActual<typeof import("@/lib/site-content/catalogue-seed-fallback")>(
    "@/lib/site-content/catalogue-seed-fallback",
  );
  return {
    ...actual,
    markCatalogueProcessConnectionWarmed,
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ mocked: true }),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  clearCatalogueSeedFallbackCooldown();
  clearSiteContentRecordCache();
});

describe("warmCanonicalCatalogueSearchCaches", () => {
  it("warms form, service and medication for search, then the list reads, serially", async () => {
    const order: string[] = [];
    readCanonicalSiteContentRecords.mockImplementation(async ({ kind }: { kind: string }) => {
      order.push(`start:${kind}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`end:${kind}`);
      return { records: [], source: "canonical_public", snapshot: null };
    });

    await warmCanonicalCatalogueSearchCaches({} as never);

    expect(catalogueSearchWarmKinds).toEqual(["form", "service", "medication"]);
    expect(catalogueListWarmKinds).toEqual(["differential", "presentation", "form", "service"]);
    // Each read is warmed in the projection its consumer looks up, or the warm fills a cache key
    // nobody reads: search reads render-only for all three kinds, the list routes read full rows.
    expect(
      readCanonicalSiteContentRecords.mock.calls.map(
        ([input]) => `${input.kind}:${input.renderOnly ? "render" : "full"}`,
      ),
    ).toEqual([
      "form:render",
      "service:render",
      "medication:render",
      "differential:full",
      "presentation:full",
      "form:full",
      "service:full",
    ]);
    expect(order).toEqual([
      "start:form",
      "end:form",
      "start:service",
      "end:service",
      "start:medication",
      "end:medication",
      "start:differential",
      "end:differential",
      "start:presentation",
      "end:presentation",
      "start:form",
      "end:form",
      "start:service",
      "end:service",
    ]);
    expect(markCatalogueProcessConnectionWarmed).toHaveBeenCalledTimes(7);
  });

  it("continues through a failed kind rather than aborting the warm", async () => {
    readCanonicalSiteContentRecords
      .mockRejectedValueOnce(new Error("form boom"))
      .mockResolvedValue({ records: [], source: "canonical_public", snapshot: null });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await warmCanonicalCatalogueSearchCaches({} as never);

    expect(readCanonicalSiteContentRecords).toHaveBeenCalledTimes(7);
    expect(markCatalogueProcessConnectionWarmed).toHaveBeenCalledTimes(6);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  // Codex P2: a never-settling warm RPC must not pin the process; recovery must succeed afterward.
  it("bounds each warm read with an abort signal so a hung RPC cannot pin later recovery", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const seenSignals: AbortSignal[] = [];

    readCanonicalSiteContentRecords.mockImplementation(async ({ signal }: { signal?: AbortSignal }) => {
      expect(signal).toBeInstanceOf(AbortSignal);
      seenSignals.push(signal!);
      await new Promise<never>((_resolve, reject) => {
        const onAbort = () => reject(signal!.reason ?? new DOMException("aborted", "AbortError"));
        if (signal!.aborted) onAbort();
        else signal!.addEventListener("abort", onAbort, { once: true });
      });
    });

    const hung = warmCanonicalCatalogueSearchCaches({} as never);
    const warmKindCount = catalogueSearchWarmKinds.length + catalogueListWarmKinds.length;
    await vi.advanceTimersByTimeAsync(catalogueSearchWarmBudgetMs * warmKindCount);
    await hung;

    expect(seenSignals).toHaveLength(warmKindCount);
    expect(seenSignals.every((signal) => signal.aborted)).toBe(true);
    expect(markCatalogueProcessConnectionWarmed).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();

    // Recovery after the hung warm: bounded signal lets a later warm succeed.
    readCanonicalSiteContentRecords.mockResolvedValue({
      records: [],
      source: "canonical_public",
      snapshot: null,
    });
    await warmCanonicalCatalogueSearchCaches({} as never);
    expect(markCatalogueProcessConnectionWarmed).toHaveBeenCalled();
    warn.mockRestore();
  });
});
