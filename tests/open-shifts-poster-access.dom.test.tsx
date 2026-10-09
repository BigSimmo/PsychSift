// @vitest-environment jsdom
import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * The roster manager's screens in Open shifts (Post, Post a shift, Week board,
 * a posted shift) for someone who is not a manager. Signed out, they are
 * offered the sign-in dialog; in no team, they are pointed to Roster; only a
 * signed-in team member who is not a roster manager is told the screen is for
 * managers. Every team here is invented.
 */

const state = vi.hoisted(() => ({
  status: "ready" as string,
  teams: { status: "ready", data: null as unknown, message: null as string | null },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/open-shifts/post",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ serviceId: "team", openShiftId: "shift" }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/dynamic", () => ({
  default: () =>
    function AccountSetupDialog() {
      return <div role="dialog" aria-label="Continue to your workspace" />;
    },
}));
vi.mock("@/components/roster/roster-format", async (original) => ({
  ...(await original<typeof import("@/components/roster/roster-format")>()),
  useRosterNow: () => new Date("2026-10-07T01:00:00Z"),
}));
vi.mock("@/components/roster/use-roster-team", () => ({
  useRosterTeams: () => state.teams,
  fetchRosterRead: vi.fn(async () => ({ ok: false })),
  postRosterAction: vi.fn(),
}));
vi.mock("@/components/mode-kit/use-signed-out-sample", () => ({
  useSignedOutSample: () => false,
  useSignedOut: () => false,
}));
vi.mock("@/lib/teaching/page-visibility", () => ({ setOpenShiftsIsPoster: vi.fn() }));
vi.mock("@/lib/use-online-status", () => ({ useOnlineStatus: () => true }));

import { OpenShiftsBoardPage } from "@/components/open-shifts/open-shifts-board-page";
import { OpenShiftsPostPage } from "@/components/open-shifts/open-shifts-post-page";
import { OpenShiftsPostedPage } from "@/components/open-shifts/open-shifts-posted-page";
import { OpenShiftsPostedShiftPage } from "@/components/open-shifts/open-shifts-posted-shift-page";
import { usePostedShifts } from "@/components/open-shifts/use-posted-shifts";

function teamsRead(teams: { role: string }[]) {
  state.teams = {
    status: "ready",
    data: {
      actorId: "5e000000-0000-4000-8000-000000000001",
      sample: false,
      teams: teams.map((team, index) => ({
        serviceId: `5e000000-0000-4000-8000-00000000001${index}`,
        name: `Example team ${index + 1}`,
        enabled: true,
        grade: "registrar",
        ...team,
      })),
    },
    message: null,
  };
}

const PAGES: readonly [string, () => ReactElement, RegExp][] = [
  ["Post", () => <OpenShiftsPostedPage />, /Only roster managers post shifts/],
  ["Post a shift", () => <OpenShiftsPostPage />, /Only a team's roster managers can post shifts/],
  ["Week board", () => <OpenShiftsBoardPage />, /Only a team's roster managers can see the week board/],
  [
    "a posted shift",
    () => <OpenShiftsPostedShiftPage serviceId="team" openShiftId="shift" />,
    /Only a team's roster managers can see posted shifts/,
  ],
];

afterEach(() => {
  cleanup();
  state.teams = { status: "ready", data: null, message: null };
});

describe("usePostedShifts", () => {
  it("tells no team apart from a team member who is not a roster manager", () => {
    teamsRead([]);
    expect(renderHook(() => usePostedShifts()).result.current.status).toBe("no-team");
    teamsRead([{ role: "member" }]);
    expect(renderHook(() => usePostedShifts()).result.current.status).toBe("not-poster");
    state.teams = { status: "signed-out", data: null, message: null };
    expect(renderHook(() => usePostedShifts()).result.current.status).toBe("signed-out");
  });
});

describe.each(PAGES)("Open shifts %s screen", (_name, page, managersOnly) => {
  it("offers the sign-in dialog when signed out, not the managers-only line", () => {
    state.teams = { status: "signed-out", data: null, message: null };
    render(page());
    expect(screen.queryByText(managersOnly)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Sign in/ }));
    expect(screen.getByRole("dialog", { name: "Continue to your workspace" })).toBeTruthy();
  });

  it("points someone in no team to Roster", () => {
    teamsRead([]);
    render(page());
    expect(screen.queryByText(managersOnly)).toBeNull();
    expect(screen.getByRole("link", { name: "Join a Roster team" }).getAttribute("href")).toBe("/roster/join");
  });

  it("keeps the managers-only line for a team member who is not a roster manager", () => {
    teamsRead([{ role: "member" }]);
    render(page());
    expect(screen.getByText(managersOnly)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Sign in/ })).toBeNull();
  });
});
