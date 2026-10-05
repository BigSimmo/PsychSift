// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchRead: vi.fn(), post: vi.fn(), reload: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => ({ status: "authenticated", authEpoch: 1 }) }));
vi.mock("@/components/roster/use-roster-team", () => ({
  useRosterTeams: () => teamsState,
  useRosterRead: (serviceId: string | null, what: string) =>
    serviceId
      ? {
          status: "ready",
          data: reads[what as keyof typeof reads],
          message: null,
          reload: mocks.reload,
          readAt: new Date("2030-03-01T02:00:00Z"),
        }
      : { status: "loading", data: null, message: null, reload: mocks.reload, readAt: null },
  fetchRosterRead: mocks.fetchRead,
  postRosterAction: mocks.post,
}));
vi.mock("@/components/roster/ask/roster-ask-box", () => ({ RosterAskButton: () => null }));
vi.mock("@/components/roster/use-roster-shifts", () => ({ useRosterShifts: () => ({ status: "ready", shifts: [] }) }));

import { RosterSwapsPage } from "@/components/roster/swaps/roster-swaps-page";
import { SwapProgressLine } from "@/components/roster/swaps/swap-progress-line";
import { swapProgress } from "@/lib/roster/team/swap-progress";

const ME = "5e000000-0000-4000-8000-000000000001";
const SAM = "5e000000-0000-4000-8000-000000000002";
const SERVICE = "5e000000-0000-4000-8000-000000000003";
const NOOR = "5e000000-0000-4000-8000-000000000008";
const OPEN = "5e000000-0000-4000-8000-000000000005";
const GIVE = "5e000000-0000-4000-8000-000000000006";
const TAKE = "5e000000-0000-4000-8000-000000000007";
const teamsState = {
  status: "ready",
  data: {
    teams: [{ serviceId: SERVICE, name: "Example team", enabled: true, role: "member", grade: "resident" }],
    actorId: ME,
  },
};
const overview = {
  service: { id: SERVICE, name: "Example team" },
  me: { role: "member", grade: "resident" as string | null, rotationEndsOn: null },
  latestPublication: null,
  seenLatest: false,
  settings: { swapApproval: "auto_same_grade", rules: {}, rulesSource: null, payFortnightAnchor: null },
  sites: [],
};
const sams = {
  id: GIVE,
  userId: SAM,
  name: "Sam",
  grade: "resident",
  siteId: null,
  siteName: null,
  startsAt: "2030-03-12T00:00:00Z",
  endsAt: "2030-03-12T08:00:00Z",
  shiftCode: "D",
  kind: "day",
};
const mine = {
  ...sams,
  id: TAKE,
  userId: ME,
  name: "You",
  startsAt: "2030-03-19T00:00:00Z",
  endsAt: "2030-03-19T08:00:00Z",
};
const swap = {
  id: "5e000000-0000-4000-8000-000000000004",
  status: "requested",
  requesterId: SAM,
  counterpartyId: ME,
  requesterName: "Sam",
  counterpartyName: "You",
  give: sams,
  take: mine,
  autoApproved: false,
  needsManagerBecause: null,
  cancelReason: null,
  expiresAt: "2099-01-01T00:00:00Z",
  createdAt: "2030-03-01T00:00:00Z",
  decidedAt: null,
};
const open = {
  id: OPEN,
  status: "open",
  mine: false,
  claimedByMe: false,
  urgent: false,
  startsAt: "2030-03-26T00:00:00Z",
  endsAt: "2030-03-26T08:00:00Z",
  shiftCode: "D",
  kind: "day",
  minGrade: "resident",
  siteId: null,
};
const reads = {
  overview,
  assignments: { assignments: [sams, mine] as unknown[] },
  requests: { swaps: [swap] as unknown[], openShifts: [] as unknown[] },
  manage: { swaps: [] as unknown[], openShifts: [], seen: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  teamsState.data.teams[0]!.role = "member";
  reads.requests.swaps = [swap];
  reads.requests.openShifts = [];
  reads.manage.swaps = [];
  reads.assignments.assignments = [sams, mine];
  overview.me.grade = "resident";
  mocks.fetchRead.mockImplementation(async (_serviceId: string, what: string) => ({
    ok: true,
    data: reads[what as keyof typeof reads],
    readAt: new Date("2030-03-01T02:00:00Z"),
  }));
  mocks.post.mockResolvedValue({ ok: true, result: { swapId: swap.id, status: "approved", autoApproved: false } });
});
afterEach(cleanup);

const sectionNames = () => screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);

describe("Swaps page team link", () => {
  it("selects the team named by ?team= when the reader has more than one", () => {
    const OTHER = "5e000000-0000-4000-8000-000000000009";
    teamsState.data.teams.push({
      serviceId: OTHER,
      name: "Other team",
      enabled: true,
      role: "member",
      grade: "resident",
    });
    window.history.replaceState(null, "", `/roster/swaps?team=${OTHER}`);
    try {
      render(<RosterSwapsPage />);
      expect(mocks.fetchRead).toHaveBeenCalledWith(OTHER, expect.anything(), expect.anything());
    } finally {
      teamsState.data.teams.pop();
      window.history.replaceState(null, "", "/");
    }
  });
});

describe("Swaps page sections", () => {
  it("gives a member Waiting on you, You sent and Open shifts, and no team section", () => {
    render(<RosterSwapsPage />);
    expect(sectionNames()).toEqual(["Waiting on you", "You sent", "Open shifts · 0"]);
  });

  it("shows History only when asked", async () => {
    const user = userEvent.setup();
    render(<RosterSwapsPage />);
    const toggle = screen.getByRole("button", { name: "History", expanded: false });
    await user.click(toggle);
    expect(sectionNames()).toEqual(["Waiting on you", "You sent", "History", "Open shifts · 0"]);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(toggle);
    expect(sectionNames()).not.toContain("History");
  });

  it("gives a manager an All team swaps section that lists every swap with its progress", () => {
    teamsState.data.teams[0]!.role = "manager";
    reads.manage.swaps = [
      {
        ...swap,
        status: "accepted",
        needsManagerBecause: "within_7_days",
        counterpartyId: NOOR,
        counterpartyName: "Noor",
      },
    ];
    render(<RosterSwapsPage />);
    expect(sectionNames()).toEqual(["Waiting on you", "You sent", "Open shifts · 0", "All team swaps"]);
    const team = screen.getByRole("list", { name: "All team swaps" });
    expect(within(team).getByText("Sam and Noor")).toBeTruthy();
    expect(within(team).getByText("Waiting on you")).toBeTruthy();
  });
});

describe("Swaps page swaps", () => {
  it("shows a swap waiting on me in Waiting on you with Accept, and sends the accept", async () => {
    const user = userEvent.setup();
    render(<RosterSwapsPage />);
    expect(screen.getByText("Sam asks to swap")).toBeTruthy();
    await user.click(await screen.findByRole("button", { name: "Accept swap" }));
    expect(mocks.post).toHaveBeenCalledWith(SERVICE, { action: "swap.accept", swapId: swap.id });
    expect(await screen.findByText("Swap accepted")).toBeTruthy();
  });

  it("shows a swap that ran out of time in History as Expired, with no Accept", async () => {
    const user = userEvent.setup();
    reads.requests.swaps = [{ ...swap, expiresAt: "2020-01-01T00:00:00Z" }];
    render(<RosterSwapsPage />);
    expect(screen.queryByRole("button", { name: "Accept swap" })).toBeNull();
    expect(screen.getByText("Nothing needs you right now")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "History", expanded: false }));
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept swap" })).toBeNull();
  });

  it("shows a swap I sent in Sent and lets me withdraw it", async () => {
    const user = userEvent.setup();
    reads.requests.swaps = [
      { ...swap, requesterId: ME, counterpartyId: SAM, requesterName: "You", counterpartyName: "Sam" },
    ];
    render(<RosterSwapsPage />);
    expect(screen.getByText("Waiting on Sam, expires Thu 1 Jan")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /^Withdraw swap for/ }));
    // Withdrawing asks first; nothing is sent until it is confirmed.
    expect(mocks.post).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Withdraw swap" }));
    expect(mocks.post).toHaveBeenCalledWith(SERVICE, { action: "swap.cancel", swapId: swap.id });
  });

  it("says when a swap I sent runs out, in Perth time", () => {
    reads.requests.swaps = [
      { ...swap, requesterId: ME, counterpartyId: SAM, requesterName: "You", counterpartyName: "Sam" },
    ];
    render(<RosterSwapsPage />);
    expect(screen.getByText("Waiting on Sam, expires Thu 1 Jan")).toBeTruthy();
  });

  it("says when a swap waiting on me runs out", () => {
    render(<RosterSwapsPage />);
    expect(screen.getByText("Answer by Thu 1 Jan")).toBeTruthy();
  });

  it("shows a declined swap in History with its reason", async () => {
    const user = userEvent.setup();
    reads.requests.swaps = [{ ...swap, status: "declined" }];
    render(<RosterSwapsPage />);
    await user.click(screen.getByRole("button", { name: "History", expanded: false }));
    expect(screen.getByText("Declined")).toBeTruthy();
    expect(screen.queryByText(/expires/)).toBeNull();
  });

  it("shows a cancelled swap in History with why it was cancelled", async () => {
    const user = userEvent.setup();
    reads.requests.swaps = [{ ...swap, status: "cancelled", cancelReason: "roster_changed" }];
    render(<RosterSwapsPage />);
    await user.click(screen.getByRole("button", { name: "History", expanded: false }));
    expect(screen.getByText("Cancelled: the roster changed")).toBeTruthy();
  });

  it("shows an ended swap in All team swaps without an expiry", () => {
    teamsState.data.teams[0]!.role = "manager";
    reads.manage.swaps = [
      { ...swap, status: "declined", counterpartyId: NOOR, counterpartyName: "Noor" },
      { ...swap, id: "5e000000-0000-4000-8000-000000000009", status: "requested", counterpartyId: NOOR },
    ];
    render(<RosterSwapsPage />);
    expect(screen.getByText("Declined")).toBeTruthy();
    expect(screen.queryByText(/expires/)).toBeNull();
  });

  it("marks the current step of the progress line", () => {
    reads.requests.swaps = [
      { ...swap, requesterId: ME, counterpartyId: SAM, requesterName: "You", counterpartyName: "Sam" },
    ];
    render(<RosterSwapsPage />);
    const line = screen.getByRole("list", { name: "Swap progress" });
    const current = within(line)
      .getAllByRole("listitem")
      .filter((item) => item.getAttribute("aria-current") === "step");
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toContain("Accepted");
  });
});

describe("Swaps page sent rows", () => {
  it("says who said yes when a swap I sent waits for the manager", () => {
    reads.requests.swaps = [
      {
        ...swap,
        status: "accepted",
        needsManagerBecause: "within_7_days",
        requesterId: ME,
        counterpartyId: SAM,
        requesterName: "You",
        counterpartyName: "Sam",
      },
    ];
    render(<RosterSwapsPage />);
    expect(screen.getByText("Sam said yes · now waiting for your manager")).toBeTruthy();
    // Only a swap still waiting for an answer can be withdrawn here.
    expect(screen.queryByRole("button", { name: /^Withdraw swap for/ })).toBeNull();
  });
});

describe("Swaps page open shifts", () => {
  beforeEach(() => {
    reads.requests.swaps = [];
    reads.requests.openShifts = [open];
  });

  it("takes an eligible open shift with its id and removes it after someone else took it", async () => {
    const user = userEvent.setup();
    mocks.post.mockResolvedValueOnce({
      ok: false,
      code: "roster_open_shift_taken",
      message: "Someone else took this shift first.",
    });
    render(<RosterSwapsPage />);
    await user.click(screen.getByRole("button", { name: /^Take the open/ }));
    expect(mocks.post).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Take shift" }));
    expect(mocks.post).toHaveBeenCalledWith(SERVICE, { action: "open.claim", openShiftId: OPEN });
    expect(await screen.findByText("Someone else took this shift first.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Take the open/ })).toBeNull();
  });

  it("shows an open shift by its times and shift type, with the count in the heading", () => {
    render(<RosterSwapsPage />);
    expect(screen.getByRole("heading", { name: "Open shifts · 1" })).toBeTruthy();
    expect(screen.getByText("08:00 to 16:00")).toBeTruthy();
    expect(screen.getByText("Day")).toBeTruthy();
  });

  it("hides an open shift that clashes with my team shift", () => {
    reads.requests.openShifts = [{ ...open, startsAt: mine.startsAt, endsAt: mine.endsAt }];
    render(<RosterSwapsPage />);
    expect(screen.queryByRole("button", { name: /^Take the open/ })).toBeNull();
  });

  it("hides Take and explains grade setup when the actor has no known grade", () => {
    overview.me.grade = null;
    render(<RosterSwapsPage />);
    expect(screen.queryByRole("button", { name: /^Take the open/ })).toBeNull();
    expect(screen.getByText("Add your grade in Your team before taking an open shift.")).toBeTruthy();
  });

  it("lets me withdraw a shift I offered", async () => {
    const user = userEvent.setup();
    reads.requests.openShifts = [{ ...open, mine: true }];
    render(<RosterSwapsPage />);
    await user.click(screen.getByRole("button", { name: /^Withdraw offer of/ }));
    expect(mocks.post).toHaveBeenCalledWith(SERVICE, { action: "open.cancel", openShiftId: OPEN });
  });
});

describe("SwapProgressLine", () => {
  it("is a list with the current step marked and says how an ended swap ended", () => {
    const progress = swapProgress({ ...swap, expiresAt: "2020-01-01T00:00:00Z" } as never, ME, new Date());
    render(<SwapProgressLine steps={progress.steps} waitingOn={progress.waitingOn} ended={progress.ended} />);
    expect(screen.getByRole("list")).toBeTruthy();
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.queryByText(/Waiting on/)).toBeNull();
  });
});
