/** @vitest-environment jsdom */
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RosterManagePage } from "@/components/roster/manage/roster-manage-page";
import { RosterApproveTab } from "@/components/roster/manage/roster-approve-tab";
import { RosterTeamSettings } from "@/components/roster/manage/roster-team-settings";
import type { RosterOverview } from "@/lib/roster/team/model";
const search = vi.hoisted(() => ({ value: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/roster/manage",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search.value),
}));
vi.mock("@/components/roster/manage/roster-manage-nav-header", () => ({ RosterManageNavHeader: () => null }));
afterEach(() => {
  cleanup();
  search.value = "";
  vi.unstubAllGlobals();
});
it("never fetches manager data or renders controls for an ordinary member", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    Response.json({
      actorId: "alex",
      teams: [{ serviceId: "team", name: "Example team", enabled: true, role: "member", grade: null }],
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<RosterManagePage />);
  expect(await screen.findByText("Only your team's roster manager can see this page.")).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Approve")).toBeNull();
});

it("opens the team named by ?team= when the reader manages more than one", async () => {
  window.history.replaceState(null, "", "/roster/manage?team=second");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        actorId: "alex",
        teams: [
          { serviceId: "first", name: "First team", enabled: true, role: "manager", grade: null },
          { serviceId: "second", name: "Second team", enabled: true, role: "manager", grade: null },
        ],
      }),
    ),
  );
  render(<RosterManagePage />);
  expect(await screen.findByText(/Second team · Cover, publishing and team settings\./)).toBeTruthy();
  window.history.replaceState(null, "", "/");
});

const overview: RosterOverview = {
  service: { id: "team", name: "Example team" },
  me: { role: "manager", grade: null, rotationEndsOn: null },
  latestPublication: null,
  seenLatest: true,
  settings: { swapApproval: "auto_same_grade", rules: {}, rulesSource: null, payFortnightAnchor: null },
  sites: [],
};
it("rechecks a waiting swap before approving and sends no actor", async () => {
  const posts: unknown[] = [];
  const swap = {
    id: "swap",
    status: "accepted",
    requesterId: "alex",
    counterpartyId: "sam",
    needsManagerBecause: "within_7_days",
    autoApproved: false,
    give: {
      id: "give",
      userId: "alex",
      name: "Alex",
      grade: "registrar",
      startsAt: "2026-10-01T00:00:00Z",
      endsAt: "2026-10-01T09:00:00Z",
      kind: "day",
      shiftCode: "D",
      siteName: null,
      siteId: null,
    },
    take: null,
  };
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)));
      return Response.json({ result: { ok: true } });
    }
    const what = new URL(String(input), "http://localhost").searchParams.get("what");
    return Response.json(
      what === "manage"
        ? { swaps: [swap], openShifts: [], seen: null }
        : what === "people"
          ? {
              people: [
                { userId: "alex", displayName: "Alex" },
                { userId: "sam", displayName: "Sam" },
              ],
            }
          : what === "assignments"
            ? { assignments: [swap.give] }
            : { leave: [] },
    );
  });
  vi.stubGlobal("fetch", fetcher);
  render(<RosterApproveTab serviceId="team" />);
  expect(await screen.findByText("Needs you because it's within 7 days")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Swap · Alex and Sam/ }));
  await screen.findByText(/Rechecked/);
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  const review = await screen.findByRole("dialog", { name: "Review fresh roster checks" });
  expect(posts).toEqual([]);
  fireEvent.click(within(review).getByRole("button", { name: "Approve after review" }));
  await waitFor(() => expect(posts).toEqual([{ action: "swap.approve", swapId: "swap" }]));
  expect(fetcher.mock.calls.some(([input]) => String(input).includes("what=assignments"))).toBe(true);
});
it("saves all settings fields together when only one changes", async () => {
  const posts: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input, init) => {
      posts.push(JSON.parse(init.body));
      return Response.json({ result: { ok: true } });
    }),
  );
  render(<RosterTeamSettings serviceId="team" overview={overview} />);
  fireEvent.change(screen.getByLabelText("Where the rules come from"), {
    target: { value: "Example service agreement" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save team settings" }));
  await waitFor(() =>
    expect(posts).toEqual([
      {
        action: "settings.set",
        swapApproval: "auto_same_grade",
        rules: {},
        rulesSource: "Example service agreement",
        payFortnightAnchor: null,
      },
    ]),
  );
});

function stubManagerTeam() {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const what = new URL(String(input), "http://localhost").searchParams.get("what");
    if (!what)
      return Response.json({
        actorId: "alex",
        teams: [{ serviceId: "team", name: "Example team", enabled: true, role: "manager", grade: null }],
      });
    if (what === "overview") return Response.json(overview);
    if (what === "assignments") return Response.json({ assignments: [] });
    if (what === "requests") return Response.json({ swaps: [], openShifts: [] });
    return Response.json({ swaps: [], openShifts: [], seen: null, people: [], leave: [] });
  });
  vi.stubGlobal("fetch", fetcher);
}

it("shows the team calendar beside the manage tabs, marked for printing", async () => {
  stubManagerTeam();
  render(<RosterManagePage />);
  const calendar = await screen.findByTestId("roster-manage-calendar");
  expect(calendar.hasAttribute("data-roster-print")).toBe(true);
  expect(calendar.className).toContain("lg:");
  expect(await within(calendar).findByRole("radiogroup", { name: "View" })).toBeTruthy();
});

it("offers Print in Month view only, and it prints the page", async () => {
  const print = vi.fn();
  vi.stubGlobal("print", print);
  stubManagerTeam();
  search.value = "view=week";
  const { unmount } = render(<RosterManagePage />);
  await screen.findByTestId("roster-manage-calendar");
  await screen.findByRole("radiogroup", { name: "View" });
  expect(screen.queryByRole("button", { name: "Print" })).toBeNull();
  unmount();
  search.value = "view=month";
  render(<RosterManagePage />);
  fireEvent.click(await screen.findByRole("button", { name: "Print" }));
  expect(print).toHaveBeenCalledTimes(1);
});

it("a decision in the calendar strip also refreshes the Approve tab, from one shared reload", async () => {
  const waiting = {
    id: "swap",
    status: "accepted",
    requesterId: "sam",
    counterpartyId: "noor",
    needsManagerBecause: "within_7_days",
    autoApproved: false,
    give: null,
    take: null,
    decidedAt: null,
    requesterName: "Sam",
    counterpartyName: "Noor",
  };
  const reads: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return Response.json({ result: { swapId: "swap", status: "approved" } });
      const what = new URL(String(input), "http://localhost").searchParams.get("what");
      if (!what)
        return Response.json({
          actorId: "alex",
          teams: [{ serviceId: "team", name: "Example team", enabled: true, role: "manager", grade: null }],
        });
      reads.push(what);
      if (what === "overview") return Response.json(overview);
      if (what === "assignments") return Response.json({ assignments: [] });
      if (what === "requests") return Response.json({ swaps: [], openShifts: [] });
      if (what === "maker") return Response.json({ codes: [], needs: [], drafts: [] });
      if (what === "manage") return Response.json({ swaps: [waiting], openShifts: [], seen: null });
      return Response.json({ people: [], leave: [] });
    }),
  );
  render(<RosterManagePage />);
  const strip = await screen.findByRole("region", { name: "Needs you" });
  await screen.findByRole("region", { name: "Inbox" });
  const manageReads = () => reads.filter((what) => what === "manage").length;
  const before = manageReads();
  fireEvent.click(within(strip).getByRole("button", { name: "Approve" }));
  const review = await screen.findByRole("dialog", { name: "Review fresh roster checks" });
  fireEvent.click(within(review).getByRole("button", { name: "Approve after review" }));
  // The calendar reads again for itself, and the Approve tab reads again with it.
  await waitFor(() => expect(manageReads()).toBeGreaterThanOrEqual(before + 2));
});

it("points to the Needs you strip instead of listing its decisions twice, and keeps the shifts only it decides", async () => {
  const waiting = {
    id: "swap",
    status: "accepted",
    requesterId: "sam",
    counterpartyId: "noor",
    needsManagerBecause: "within_7_days",
    autoApproved: false,
    give: null,
    take: null,
  };
  const reported = {
    id: "open",
    status: "reported",
    postedBy: "noor",
    claimedBy: null,
    startsAt: "2026-10-06T00:00:00Z",
    endsAt: "2026-10-06T09:00:00Z",
    kind: "day",
    shiftCode: "D",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const what = new URL(String(input), "http://localhost").searchParams.get("what");
      return Response.json(
        what === "manage"
          ? { swaps: [waiting], openShifts: [reported], seen: null }
          : what === "people"
            ? {
                people: [
                  { userId: "sam", displayName: "Sam" },
                  { userId: "noor", displayName: "Noor" },
                ],
              }
            : { leave: [] },
      );
    }),
  );
  render(<RosterApproveTab serviceId="team" decisionsInStrip actorId="alex" />);
  expect(await screen.findByRole("button", { name: "Go to Needs you" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Swap · Sam and Noor/ })).toBeNull();
  expect(screen.getByRole("button", { name: /Noor can't make/ })).toBeTruthy();
  const summary = screen.getByRole("list", { name: "Summary" });
  expect(within(summary).getByTestId("roster-stat-waiting").textContent).toContain("2");
});

it("lists everything waiting in one Inbox: swaps, taken shifts, shifts someone can't make, then short days", async () => {
  const swap = {
    id: "swap",
    status: "accepted",
    requesterId: "sam",
    counterpartyId: "noor",
    needsManagerBecause: "within_7_days",
    autoApproved: false,
    give: null,
    take: null,
  };
  const open = (id: string, status: string, claimedBy: string | null) => ({
    id,
    status,
    postedBy: "noor",
    claimedBy,
    startsAt: "2026-10-06T00:00:00Z",
    endsAt: "2026-10-06T09:00:00Z",
    kind: "day",
    shiftCode: "D",
  });
  // A day target on every weekday with nobody rostered: every day in the next two weeks is short.
  const needs = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    id: `c1000000-0000-4000-8000-00000000000${weekday}`,
    weekday,
    date: null,
    kind: "day",
    grade: null,
    siteId: null,
    needed: 1,
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const what = new URL(String(input), "http://localhost").searchParams.get("what");
      if (what === "manage")
        return Response.json({
          swaps: [swap],
          openShifts: [open("reported", "reported", null), open("claimed", "claimed", "sam")],
          seen: null,
        });
      if (what === "people")
        return Response.json({
          people: [
            { userId: "sam", displayName: "Sam" },
            { userId: "noor", displayName: "Noor" },
          ],
        });
      if (what === "assignments") return Response.json({ assignments: [] });
      if (what === "maker") return Response.json({ codes: [], needs, drafts: [] });
      return Response.json({ leave: [] });
    }),
  );
  render(<RosterApproveTab serviceId="team" overview={overview} />);
  const inbox = await screen.findByRole("region", { name: "Inbox" });
  const list = await within(inbox).findByTestId("roster-inbox-list");
  await waitFor(() => expect(list.querySelectorAll('[data-inbox-kind="short"]').length).toBe(14));
  const kinds = [...list.querySelectorAll("[data-inbox-kind]")].map((item) => item.getAttribute("data-inbox-kind"));
  expect(kinds.slice(0, 3)).toEqual(["swap", "claimed", "reported"]);
  expect(new Set(kinds.slice(3))).toEqual(new Set(["short"]));
  expect(
    within(screen.getByRole("list", { name: "Summary" })).getByTestId("roster-stat-waiting").textContent,
  ).toContain("3");
  // A request opens the live-rechecked Review sheet.
  fireEvent.click(within(list).getByRole("button", { name: /Swap · Sam and Noor/ }));
  expect(await screen.findByRole("dialog", { name: "Review swap" })).toBeTruthy();
});
