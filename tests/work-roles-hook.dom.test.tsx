/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  forgetWorkRolesAccount,
  resetWorkRoles,
  useWorkRoles,
  watchHeldWorkRoles,
} from "@/lib/work-roles/use-work-roles";

afterEach(() => {
  vi.unstubAllGlobals();
});

function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("useWorkRoles", () => {
  it("drops the answer for the previous account after a reset", async () => {
    const first = deferred();
    const second = deferred();
    const fetchMock = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    vi.stubGlobal("fetch", fetchMock);
    resetWorkRoles();

    const { result } = renderHook(() => useWorkRoles());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Sign-out while the first read is still out: a fresh read starts straight away.
    act(() => resetWorkRoles());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    await act(async () => {
      first.resolve(new Response(JSON.stringify({ grants: [{ role: "administrator" }] }), { status: 200 }));
      await first.promise;
    });
    expect(result.current.status).toBe("loading");

    await act(async () => {
      second.resolve(new Response(JSON.stringify({ grants: [] }), { status: 200 }));
      await second.promise;
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.roles).toEqual([]);
  });

  it("shows no roles once switched off, whatever the last account left behind", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ grants: [{ role: "administrator" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    resetWorkRoles();

    const { result, rerender } = renderHook(({ enabled }) => useWorkRoles(enabled), {
      initialProps: { enabled: true },
    });
    await waitFor(() => expect(result.current.roles).toEqual(["administrator"]));

    // Signed out in the same tab: the shared answer is still cached, but this caller shows none of it.
    rerender({ enabled: false });
    expect(result.current.status).toBe("signed-out");
    expect(result.current.roles).toEqual([]);
    expect(result.current.can("roles.grant", { kind: "everyone" })).toBe(false);
  });

  it("tells the menu the roles held, and forgets them for another account", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ grants: [{ role: "administrator" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ grants: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    resetWorkRoles();

    const seen: string[][] = [];
    const stop = watchHeldWorkRoles("user-a", (roles) => seen.push([...roles]));
    await waitFor(() => expect(seen.at(-1)).toEqual(["administrator"]));
    stop();

    const next: string[][] = [];
    const stopNext = watchHeldWorkRoles("user-b", (roles) => next.push([...roles]));
    expect(next[0]).toEqual([]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    stopNext();
  });

  it("reads the roles again when the same account signs back in, so a removed role is gone", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ grants: [{ role: "workforce", hospitalId: "h1" }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ grants: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    resetWorkRoles();

    const seen: string[][] = [];
    const stop = watchHeldWorkRoles("user-c", (roles) => seen.push([...roles]));
    await waitFor(() => expect(seen.at(-1)).toEqual(["workforce"]));
    stop();
    forgetWorkRolesAccount();

    const again: string[][] = [];
    const stopAgain = watchHeldWorkRoles("user-c", (roles) => again.push([...roles]));
    expect(again[0]).toEqual([]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(again.at(-1)).toEqual([]));
    expect(again.flat()).not.toContain("workforce");
    stopAgain();
  });

  it("never shows, even for one render, roles read for another account", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ grants: [{ role: "administrator" }] }), { status: 200 }))
      .mockReturnValueOnce(new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    resetWorkRoles();

    const seen: string[][] = [];
    const stop = watchHeldWorkRoles("user-a", (roles) => seen.push([...roles]));
    await waitFor(() => expect(seen.at(-1)).toEqual(["administrator"]));
    stop();

    // This page has no signed-in account, so the answer cached for user-a is not its answer.
    const statuses: string[] = [];
    renderHook(() => {
      const view = useWorkRoles();
      statuses.push(view.status);
      return view;
    });
    expect(statuses[0]).toBe("loading");
    expect(statuses).not.toContain("ready");
  });
});
