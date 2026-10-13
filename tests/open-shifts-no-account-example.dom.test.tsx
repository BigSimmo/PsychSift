// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * Design audit 13 Oct 2026, D13: with nobody signed in, Open shifts showed a
 * lone "No teams yet" card while Roster beside it showed examples, because the
 * server's invented team was hidden. With no account, the page now shows the
 * example open shifts; an explicit "off", or a signed-in reader, keeps
 * "No teams yet". Every team here is invented.
 */

const state = vi.hoisted(() => ({
  auth: "unconfigured" as string,
  mode: "auto" as "auto" | "on" | "off",
}));

vi.mock("@/components/roster/roster-format", async (original) => ({
  ...(await original<typeof import("@/components/roster/roster-format")>()),
  useRosterNow: () => new Date("2026-10-07T01:00:00Z"),
}));
vi.mock("@/components/roster/use-roster-team", () => ({
  // What `useRosterTeams` hands on when example data is not showing: the invented team, hidden.
  useRosterTeams: () => ({
    status: "ready",
    data: { actorId: "example-me", sample: true, teams: [] },
    message: null,
    reload: () => undefined,
  }),
  fetchRosterRead: vi.fn(async () => ({ ok: false })),
}));
vi.mock("@/components/roster/use-roster-shifts", () => ({
  useRosterShifts: () => ({ status: "ready", shifts: [], reload: async () => undefined }),
}));
vi.mock("@/components/mode-kit/use-signed-out-sample", () => ({ useSignedOutSample: () => false }));
vi.mock("@/lib/example-data/store", () => ({
  useAuthIfAvailable: () => ({ status: state.auth }),
  useExampleData: () => ({ mode: state.mode }),
}));
vi.mock("@/lib/teaching/page-visibility", () => ({ setOpenShiftsIsPoster: vi.fn() }));
vi.mock("@/lib/use-online-status", () => ({ useOnlineStatus: () => true }));

import { useOpenShifts } from "@/components/open-shifts/use-open-shifts";

afterEach(() => {
  state.auth = "unconfigured";
  state.mode = "auto";
});

describe("Open shifts with nobody signed in", () => {
  it("shows the example open shifts when the server sends its invented team", () => {
    for (const auth of ["unconfigured", "signed_out", "expired"]) {
      state.auth = auth;
      const { result, unmount } = renderHook(() => useOpenShifts());
      expect(result.current.status).toBe("ready");
      expect(result.current.sample).not.toBeNull();
      expect(result.current.listings.length).toBeGreaterThan(0);
      unmount();
    }
  });

  it("honours example data switched off", () => {
    state.mode = "off";
    const { result } = renderHook(() => useOpenShifts());
    expect(result.current.status).toBe("no-team");
    expect(result.current.listings).toHaveLength(0);
  });

  it("keeps No teams yet for a signed-in reader, and while sign-in is still settling", () => {
    for (const auth of ["authenticated", "loading"]) {
      state.auth = auth;
      const { result, unmount } = renderHook(() => useOpenShifts());
      expect(result.current.status).toBe("no-team");
      expect(result.current.sample).toBeNull();
      unmount();
    }
  });
});
