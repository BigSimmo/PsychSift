import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The CME home loads last year as well as this year only to build the MyCPD
 * reporting reminder, and that reminder can only show until 1 March. Past that
 * date the second load is pure waste, so the page must not make it.
 */
const loadCmePageData = vi.hoisted(() => vi.fn(async (year?: number) => ({ state: "unavailable", year })));

vi.mock("@/lib/cme/load-cme-page-data", () => ({ loadCmePageData }));
vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  isDemoMode: () => false,
}));

afterEach(() => {
  vi.useRealTimers();
  loadCmePageData.mockClear();
});

async function renderAt(instant: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(instant));
  const { default: CmeHomeRoute } = await import("@/app/(search-app)/cme/page");
  await CmeHomeRoute({ searchParams: Promise.resolve({}) });
  return loadCmePageData.mock.calls.map(([year]) => year);
}

describe("CME home reporting reminder", () => {
  it("still loads last year before the 1 March reporting date", async () => {
    // 10:00 on 15 February 2026 in Perth.
    expect(await renderAt("2026-02-15T02:00:00Z")).toContain(2025);
  });

  it("does not load last year once the reporting date has passed", async () => {
    // 10:00 on 15 June 2026 in Perth.
    expect(await renderAt("2026-06-15T02:00:00Z")).toEqual([undefined]);
  });
});
