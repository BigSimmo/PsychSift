/** @vitest-environment jsdom */

// Design audit D-14: a failed or stalled Medication search said "Request failed (503)" or
// stayed loading for ever. It now says what happened in plain words and gives up after a deadline.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMedicationCatalog, useMedicationDetail } from "@/components/clinical-dashboard/use-medication-catalog";

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => ({ authorizationHeader: undefined, session: null, status: "authenticated" }),
}));

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useMedicationCatalog failure wording", () => {
  it.each([
    [503, /isn’t available right now/],
    [429, /Too many searches/],
    [401, /Sign in again/],
  ])("turns a %i into plain words, never a raw status", async (status, expected) => {
    fetchMock.mockResolvedValue(new Response("{}", { status }));
    const { result } = renderHook(() => useMedicationCatalog("clozapine"));
    await settle();

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toMatch(expected);
    expect(result.current.error).not.toMatch(/Request failed/);
  });

  it("stops waiting and says so when the search never answers", async () => {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    const { result } = renderHook(() => useMedicationCatalog("clozapine"));
    await settle();
    expect(result.current.loading).toBe(true);

    await settle(20_000);

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toMatch(/taking too long/);
  });
});

// D26-12: the record page's Details line read a bare "Request failed (503)".
describe("useMedicationDetail failure wording", () => {
  it.each([
    [503, /medicines service is busy or unavailable/],
    [429, /Too many requests/],
    [401, /Sign in again/],
  ])("turns a %i into plain words and keeps the code", async (status, expected) => {
    fetchMock.mockResolvedValue(new Response("{}", { status }));
    const { result } = renderHook(() => useMedicationDetail("clozapine"));
    await settle();

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toMatch(expected);
    expect(result.current.error).toContain(`Code ${status}.`);
    expect(result.current.error).not.toMatch(/Request failed/);
  });
});
