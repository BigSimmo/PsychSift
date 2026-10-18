/** @vitest-environment jsdom */
// Existing B, mounted components and immutable auth values. All requests are synthetic.
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminNewJobSharing } from "@/components/admin/new-job/admin-new-job-sharing";
import { useJuniorRosterLeave } from "@/components/admin/junior/use-roster-leave";

const state = vi.hoisted(() => ({
  auth: { status: "authenticated", authEpoch: 1, session: { user: { id: "synthetic-A" } } },
}));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => state.auth }));
function switchAccount() {
  state.auth = { ...state.auth, authEpoch: state.auth.authEpoch + 1, session: { user: { id: "synthetic-B" } } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  state.auth = { ...state.auth, authEpoch: state.auth.authEpoch + 1, session: { user: { id: "synthetic-A" } } };
});
afterEach(() => vi.unstubAllGlobals());

describe("mounted Admin identity consumers", () => {
  it("loads B leave instead of retaining A's approved absence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          leave:
            state.auth.session.user.id === "synthetic-A"
              ? [
                  {
                    id: "synthetic-A-leave",
                    kind: "annual",
                    startsOn: "2026-11-01",
                    endsOn: "2026-11-03",
                    status: "approved",
                  },
                ]
              : [],
        }),
      ),
    );
    const view = renderHook(() => useJuniorRosterLeave(true));
    await waitFor(() => expect(view.result.current.status).toBe("ready"));
    expect(view.result.current).toMatchObject({ leave: [{ id: "synthetic-A-leave" }] });
    act(() => {
      switchAccount();
      view.rerender();
    });
    await waitFor(() => expect(view.result.current).toEqual({ status: "ready", leave: [] }));
  });

  it("reads B's sharing choice when the mounted account changes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ share: state.auth.session.user.id === "synthetic-A" })),
    );
    const view = render(<AdminNewJobSharing />);
    await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true"));
    act(() => {
      switchAccount();
      view.rerender(<AdminNewJobSharing />);
    });
    await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false"));
  });

  for (const status of [200, 500]) {
    it(`drops A's delayed sharing save result (${status}) after B loads`, async () => {
      const pending = deferred<Response>();
      vi.stubGlobal(
        "fetch",
        vi.fn((_input: unknown, init?: RequestInit) =>
          init?.method === "PUT" ? pending.promise : Promise.resolve(Response.json({ share: false })),
        ),
      );
      const view = render(<AdminNewJobSharing />);
      fireEvent.click(await screen.findByRole("switch"));
      act(() => {
        switchAccount();
        view.rerender(<AdminNewJobSharing />);
      });
      await act(async () => {});
      await act(async () => pending.resolve(Response.json({ share: true }, { status })));
      expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
      expect(screen.getByRole("switch")).not.toBeDisabled();
      expect(screen.queryByRole("alert")).toBeNull();
    });
  }
});
