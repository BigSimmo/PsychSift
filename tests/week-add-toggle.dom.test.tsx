/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWeekAdd } from "@/components/teaching/week-add-toggle";

type Pending = { resolve: (value: { inMyWeek: boolean }) => void; reject: (cause: unknown) => void };

const requests = vi.hoisted(() => ({ pending: [] as Pending[] }));

vi.mock("@/lib/teaching/client", () => ({
  teachingPost: () =>
    new Promise((resolve, reject) => {
      requests.pending.push({ resolve, reject });
    }),
  teachingErrorMessage: () => "Couldn’t save that change.",
}));

const row = { occurrenceId: "occ-1", inMyWeek: false };

beforeEach(() => {
  requests.pending.length = 0;
});

describe("useWeekAdd", () => {
  it("keeps the newest tap's answer when an older answer arrives after it", async () => {
    const { result } = renderHook(() => useWeekAdd(false));

    act(() => void result.current.toggle(row)); // set
    act(() => void result.current.toggle(row)); // unset
    expect(result.current.added(row)).toBe(false);
    const [setRequest, unsetRequest] = requests.pending;

    await act(async () => unsetRequest.resolve({ inMyWeek: false }));
    await act(async () => setRequest.resolve({ inMyWeek: true }));

    expect(result.current.added(row)).toBe(false);
  });

  it("ignores an older request's failure once a newer request has answered", async () => {
    const { result } = renderHook(() => useWeekAdd(false));

    act(() => void result.current.toggle(row)); // set
    act(() => void result.current.toggle(row)); // unset
    const [setRequest, unsetRequest] = requests.pending;

    await act(async () => unsetRequest.resolve({ inMyWeek: false }));
    await act(async () => setRequest.reject(new Error("offline")));

    expect(result.current.added(row)).toBe(false);
    expect(result.current.notice).toBeNull();
  });

  it("still puts the state back and says why when the newest request fails", async () => {
    const { result } = renderHook(() => useWeekAdd(false));

    act(() => void result.current.toggle(row));
    expect(result.current.added(row)).toBe(true);

    await act(async () => requests.pending[0].reject(new Error("offline")));

    expect(result.current.added(row)).toBe(false);
    expect(result.current.notice).toBe("Couldn’t save that change.");
  });
});
