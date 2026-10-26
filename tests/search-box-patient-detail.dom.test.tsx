// Privacy audit S1 (2026-10-26): every search box checks typed text for patient details before the
// text leaves the page, whether as a request (D26-01, CA-02, CA-05) or in a page address (CA-01,
// CA-03, CA-05). Every name and number here is invented.

import { readFileSync } from "node:fs";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { executeMasterSearchHeaderModeAction } from "@/components/clinical-dashboard/master-search-header-actions";
import { preloadSearchPatientCheck } from "@/components/clinical-dashboard/search-patient-detail-guard";
import { useDifferentialSearch } from "@/components/clinical-dashboard/use-differential-catalog";
import { useMedicationCatalog } from "@/components/clinical-dashboard/use-medication-catalog";

const authSession = vi.hoisted(() => ({
  authorizationHeader: { Authorization: "Bearer user-a-token" },
  markSessionExpired: vi.fn(),
  session: { user: { id: "user-a" } },
  status: "authenticated" as const,
}));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => authSession,
}));

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

async function settle() {
  await act(async () => {
    await vi.runOnlyPendingTimersAsync();
    for (let step = 0; step < 6; step += 1) await Promise.resolve();
  });
}

beforeAll(async () => {
  await preloadSearchPatientCheck();
});

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const HELD_BACK = /^This search looks like it holds a patient detail/;

describe("Medication search (D26-01, CA-02, CA-05)", () => {
  it("never sends text that looks like a patient detail, and says why", async () => {
    const { result } = renderHook(() => useMedicationCatalog("Mr John Testpatient lithium"));
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toMatch(HELD_BACK);
    expect(result.current.error).not.toContain("Testpatient");
  });

  it("still sends an ordinary medicine search", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ records: [], total: 0 }));
    renderHook(() => useMedicationCatalog("clozapine"));
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("q=clozapine");
  });
});

describe("Differentials search (CA-02)", () => {
  it("never sends text that looks like a patient detail, and says why with no Retry", async () => {
    const { result } = renderHook(() => useDifferentialSearch("Sarah Jones psychosis"));
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.status).toBe("error");
    expect(result.current.heldBack).toMatch(HELD_BACK);
  });

  it("still sends an ordinary differentials search", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ matches: [] }));
    const { result } = renderHook(() => useDifferentialSearch("psychosis"));
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.heldBack).toBeUndefined();
  });
});

describe("Dictionary menu search (CA-03)", () => {
  function runDictionarySearch(trimmedQuery: string): string[] {
    const pushed: string[] = [];
    executeMasterSearchHeaderModeAction({
      actionId: "dictionary-search",
      trimmedQuery,
      onQueryModeChange: () => {},
      onQueryChange: () => {},
      onSearchModeChange: () => {},
      openScopePicker: () => {},
      pushIfLeaveConfirmed: (href) => pushed.push(href),
      factsheetsTopicsHref: "/factsheets/topics",
      canAccessFavourites: true,
    });
    return pushed;
  }

  it("leaves a patient detail out of the address", () => {
    expect(runDictionarySearch("Minh Pham lithium")).toEqual(["/dictionary/search"]);
  });

  it("carries an ordinary term", () => {
    expect(runDictionarySearch("anhedonia")).toEqual(["/dictionary/search?q=anhedonia"]);
  });
});

/**
 * The page-level boxes are large client pages, so these read their source for the guard sitting in
 * front of each address write, the way tests/search-route-ownership.test.ts does.
 */
function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("page search boxes route through the check before writing ?q= (CA-01, CA-03, CA-05)", () => {
  it.each([
    [
      "Tools results box",
      "src/components/tools/tools-search-results-page.tsx",
      /const refusal = searchTextPatientDetailRefusal\(submittedQuery\);[\s\S]{0,200}?return;[\s\S]{0,40}?\}\s*router\.push\(`\/tools\?q=/,
    ],
    [
      "Tools launcher box",
      "src/components/applications-launcher-page.tsx",
      /const refusal = searchTextPatientDetailRefusal\(submittedQuery\);[\s\S]{0,200}?return;[\s\S]{0,40}?\}\s*router\.push\(`\/tools\?q=/,
    ],
    [
      "Calculators box",
      "src/components/calculators/search-page.tsx",
      /query\.trim\(\) && !searchTextPatientDetailRefusal\(query\)\) \{\s*nextParams\.set\("q"/,
    ],
    [
      "On Call Refer services link",
      "src/components/on-call/refer/refer-page.tsx",
      /query\.trim\(\) && !searchTextPatientDetailRefusal\(query\)\s*\?\s*`\/services\/search\?q=/,
    ],
    [
      "Dictionary topic box (each keystroke)",
      "src/components/dictionary/dictionary-catalogue-pages.tsx",
      /writeCheckedSearchText\(\s*event\.target\.value,\s*\(value\) => setOne\("q", value\)/,
    ],
    [
      "Medication suggested, recent and cross-mode searches",
      "src/components/clinical-dashboard/use-dashboard-search-execution.ts",
      /function setMedicationSearchQuery\([^)]*\) \{[\s\S]{0,400}?const refusal = searchTextPatientDetailRefusal\(trimmedSearchText\);[\s\S]{0,120}?return;/,
    ],
    [
      "Medication, Services, Forms and Favourites chips",
      "src/components/ClinicalDashboard.tsx",
      /void checkSearchTextPatientDetail\(crossQuery\)\.then\(\(refusal\) => \{[\s\S]{0,200}?if \(refusal\) \{[\s\S]{0,120}?return;[\s\S]{0,40}?\}\s*latestNavigateCrossModeSearch\(mode, crossQuery\);/,
    ],
    [
      "Shared deep links on every search page",
      "src/components/clinical-dashboard/global-search-shell.tsx",
      /void checkSearchTextPatientDetail\(requestedQuery\)\.then\(\(refusal\) => \{[\s\S]{0,400}?url\.searchParams\.delete\("q"\);[\s\S]{0,300}?router\.replace\(/,
    ],
  ])("%s", (_label, path, guarded) => {
    expect(source(path)).toMatch(guarded);
  });
});

describe("note fields keep text from autofill, spelling and grammar extensions (CA-08)", () => {
  it.each([
    ["Safety plan entries", "src/components/patient-safety-plan.tsx", 2],
    ["My Day quick note", "src/components/my-day/my-day-work-me-cards.tsx", 1],
  ])("%s", (_label, path, fields) => {
    const matches = source(path).match(
      /autoComplete="off"\s+spellCheck=\{false\}\s+data-gramm="false"\s+data-enable-grammarly="false"/g,
    );
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(fields);
  });
});
