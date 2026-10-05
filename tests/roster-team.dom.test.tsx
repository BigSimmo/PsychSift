/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RosterTeamPage } from "@/components/roster/team/roster-team-page";

// The calendar keeps its view and date in the URL, so the mock URL is live:
// router.replace updates it and useSearchParams reads it back.
const url = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = { params: new URLSearchParams() };
  return {
    state,
    set(search: string) {
      state.params = new URLSearchParams(search);
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});
vi.mock("next/navigation", () => ({
  usePathname: () => "/roster/team",
  useRouter: () => ({
    push: vi.fn(),
    replace: (target: string) => act(() => url.set(target.split("?")[1] ?? "")),
  }),
  useSearchParams: () =>
    useSyncExternalStore(
      url.subscribe,
      () => url.state.params,
      () => url.state.params,
    ),
}));
vi.mock("@/components/roster/ask/roster-ask-box", () => ({ RosterAskButton: () => null }));
beforeEach(() => url.set("view=day"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const team = { serviceId: "example", name: "Example team", enabled: true, role: "member", grade: "registrar" };
const samsNight = {
  id: "night",
  userId: "sam",
  name: "Dr Sam Example",
  grade: "registrar",
  siteId: "site",
  siteName: "Example Hospital",
  startsAt: "2026-10-15T21:30:00+08:00",
  endsAt: "2026-10-16T08:00:00+08:00",
  shiftCode: "N",
  kind: "night",
};
function mockTeam(enabled = true, sample = false, assignments: unknown[] = [samsNight], role = "member") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/roster/team")
        return Response.json({
          actorId: "alex",
          teams: [{ ...team, enabled, role }],
          ...(sample ? { sample: true } : {}),
        });
      if (url.includes("what=overview"))
        return Response.json({
          service: { id: "example", name: "Example team" },
          me: { role: "member", grade: "registrar", rotationEndsOn: null },
          latestPublication: null,
          seenLatest: true,
          settings: { rules: {} },
          sites: [],
        });
      return Response.json({ assignments });
    }),
  );
}
describe("Roster team journey", () => {
  it("shows an overnight team shift and links to the team's phone numbers", async () => {
    mockTeam();
    render(<RosterTeamPage now={new Date("2026-10-16T00:00:00Z")} />);
    expect(await screen.findByRole("heading", { name: "Registrars" })).toBeTruthy();
    expect(screen.getByText("to 08:00")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Phone numbers are in On call/ }).getAttribute("href")).toBe(
      "/on-call/service?service=example",
    );
    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    expect(await screen.findByText("from 21:30")).toBeTruthy();
  });
  it("labels the sample team served while team rosters are held", async () => {
    mockTeam(true, true);
    render(<RosterTeamPage now={new Date("2026-10-16T00:00:00Z")} />);
    expect((await screen.findByTestId("roster-sample-notice")).textContent).toMatch(/Example team/);
  });
  it("shows no sample label for a real team", async () => {
    mockTeam();
    render(<RosterTeamPage now={new Date("2026-10-16T00:00:00Z")} />);
    expect(await screen.findByRole("heading", { name: "Registrars" })).toBeTruthy();
    expect(screen.queryByTestId("roster-sample-notice")).toBeNull();
  });
  it("makes no detail reads for an unconfirmed team", async () => {
    mockTeam(false);
    render(<RosterTeamPage now={new Date("2026-10-16T00:00:00Z")} />);
    expect(await screen.findByText("This team hasn't been confirmed yet.")).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls.every(([url]) => url === "/api/roster/team")).toBe(true);
    expect(screen.queryByText("Dr Sam Example")).toBeNull();
  });
  it("shows a retry after a failed team read instead of an empty roster", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<RosterTeamPage />);
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByText("No shifts on this day.")).toBeNull();
  });
  it("lists who is on tomorrow and says plainly when the reader is off", async () => {
    mockTeam();
    render(<RosterTeamPage now={new Date("2026-10-14T00:00:00Z")} />);
    const list = await screen.findByTestId("roster-team-tomorrow");
    expect(screen.getByRole("heading", { name: "On tomorrow" })).toBeTruthy();
    expect(screen.getByText("Thu 15 Oct · you're off")).toBeTruthy();
    expect(list.textContent).toContain("Dr Sam Example");
    expect(list.textContent).toContain("Night · 21:30–08:00 +1");
  });
  it("lists the colleagues whose shifts overlap the reader's shift tomorrow", async () => {
    const mine = {
      ...samsNight,
      id: "mine",
      userId: "alex",
      name: "Alex Example",
      startsAt: "2026-10-15T13:00:00+08:00",
      endsAt: "2026-10-15T22:00:00+08:00",
      shiftCode: "E",
      kind: "evening",
    };
    const early = {
      ...samsNight,
      id: "early",
      userId: "pat",
      name: "Dr Pat Example",
      startsAt: "2026-10-15T07:00:00+08:00",
      endsAt: "2026-10-15T12:00:00+08:00",
      kind: "day",
    };
    mockTeam(true, false, [mine, samsNight, early]);
    render(<RosterTeamPage now={new Date("2026-10-14T00:00:00Z")} />);
    const list = await screen.findByTestId("roster-team-tomorrow");
    expect(screen.getByRole("heading", { name: "On with you tomorrow" })).toBeTruthy();
    expect(screen.getByText("Thu 15 Oct · you're on evening")).toBeTruthy();
    expect(list.textContent).toContain("Dr Sam Example");
    // Pat's shift ends before Alex's starts, so Pat is not "on with" Alex.
    expect(list.textContent).not.toContain("Dr Pat Example");
  });
  it("says nobody is on tomorrow rather than showing an empty list", async () => {
    mockTeam(true, false, []);
    render(<RosterTeamPage now={new Date("2026-10-14T00:00:00Z")} />);
    expect(await screen.findByText("Nobody on the team is rostered tomorrow.")).toBeTruthy();
    expect(screen.queryByTestId("roster-team-tomorrow")).toBeNull();
  });
  it("offers Join a team, and Manage a team only to a manager", async () => {
    mockTeam();
    const { unmount } = render(<RosterTeamPage now={new Date("2026-10-16T00:00:00Z")} />);
    expect((await screen.findByRole("link", { name: /Join a team/ })).getAttribute("href")).toBe("/roster/join");
    expect(screen.queryByRole("link", { name: /Manage a team/ })).toBeNull();
    unmount();
    mockTeam(true, false, [samsNight], "manager");
    render(<RosterTeamPage now={new Date("2026-10-16T00:00:00Z")} />);
    expect((await screen.findByRole("link", { name: /Manage a team/ })).getAttribute("href")).toBe("/roster/manage");
  });
  it("names the week and explains the calendar's real letters", async () => {
    url.set("");
    mockTeam();
    render(<RosterTeamPage now={new Date("2026-10-16T00:00:00Z")} />);
    expect(await screen.findByRole("heading", { name: "Team week · 12 to 18 Oct" })).toBeTruthy();
    expect(screen.getByTestId("roster-team-legend").textContent).toBe(
      "D day · E evening · N night · C on call · L leave · W other work · blank is off.",
    );
  });
});
