/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resetWorkRoles, useWorkRoles } from "@/lib/work-roles/use-work-roles";

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
});
