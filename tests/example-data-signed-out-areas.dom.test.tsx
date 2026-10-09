/** @vitest-environment jsdom */

// Auto mode for a signed-out visitor (Josh, 7 Oct: they see examples by
// default). Teaching and CPD, read on the server, wait for an "empty" report
// for a signed-in reader, but a signed-out visitor has no account data to wait
// for, so they fill at once. An explicit off still wins.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ status: "signed_out", authEpoch: 1, session: null as unknown }));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth }));

import { resetExampleDataForTests, setExampleDataOn, useExampleData } from "@/lib/example-data/store";

beforeEach(() => {
  window.localStorage.clear();
  resetExampleDataForTests();
  auth.status = "signed_out";
  auth.session = null;
});

describe("auto mode for a signed-out visitor", () => {
  it("fills Teaching and CPD without waiting for an empty report", () => {
    expect(renderHook(() => useExampleData("teach")).result.current.active).toBe(true);
    expect(renderHook(() => useExampleData("cpd")).result.current.active).toBe(true);
    auth.status = "expired";
    expect(renderHook(() => useExampleData("cpd")).result.current.active).toBe(true);
  });

  it("honours an explicit off", () => {
    const { result } = renderHook(() => useExampleData("teach"));
    act(() => setExampleDataOn(false));
    expect(result.current.active).toBe(false);
  });

  it("still waits for the empty report for a new signed-in account", () => {
    auth.status = "authenticated";
    auth.session = { user: { created_at: new Date().toISOString() } };
    expect(renderHook(() => useExampleData("teach")).result.current.active).toBe(false);
    expect(renderHook(() => useExampleData("rost")).result.current.active).toBe(true);
  });
});
