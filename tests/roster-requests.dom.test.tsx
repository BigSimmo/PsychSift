// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({ fetchRead: vi.fn(), post: vi.fn(), reload: vi.fn() }));
vi.mock("@/components/roster/use-roster-team", () => ({
  useRosterTeams: () => teamsState,
  useRosterRead: (_serviceId: string | null, what: string) => ({
    status: "ready",
    data: reads[what as keyof typeof reads],
    message: null,
    reload: mocks.reload,
    readAt: new Date("2026-10-20T10:21:00Z"),
  }),
  fetchRosterRead: mocks.fetchRead,
  postRosterAction: mocks.post,
}));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => ({ status: "authenticated", authEpoch: 1 }) }));
vi.mock("@/components/roster/ask/roster-ask-box", () => ({ RosterAskButton: () => null }));
vi.mock("@/components/roster/use-roster-shifts", () => ({ useRosterShifts: () => ({ status: "ready", shifts: [] }) }));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, title, children }: { open: boolean; title: string; children: ReactNode }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
}));

import { RosterRequestsPage } from "@/components/roster/requests/roster-requests-page";

const ME = "5e000000-0000-4000-8000-000000000001";
const MEI = "5e000000-0000-4000-8000-000000000002";
const SERVICE = "5e000000-0000-4000-8000-000000000003";
const SWAP = "5e000000-0000-4000-8000-000000000004";
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
const give = {
  id: GIVE,
  userId: MEI,
  name: "Mei",
  grade: "resident",
  siteId: null,
  siteName: null,
  startsAt: "2026-10-31T08:00:00Z",
  endsAt: "2026-10-31T16:00:00Z",
  shiftCode: "D",
  kind: "day",
};
const take = {
  ...give,
  id: TAKE,
  userId: ME,
  name: "You",
  startsAt: "2026-11-07T08:00:00Z",
  endsAt: "2026-11-07T16:00:00Z",
};
const swap = {
  id: SWAP,
  status: "requested",
  requesterId: MEI,
  counterpartyId: ME,
  requesterName: "Mei",
  counterpartyName: "You",
  give,
  take,
  autoApproved: false,
  needsManagerBecause: null,
  cancelReason: null,
  expiresAt: "2026-10-30T00:00:00Z",
  createdAt: "2026-10-19T00:00:00Z",
  decidedAt: null,
};
const open = {
  id: OPEN,
  status: "open",
  mine: false,
  claimedByMe: false,
  urgent: false,
  startsAt: "2026-11-12T08:00:00Z",
  endsAt: "2026-11-12T16:00:00Z",
  shiftCode: "D",
  kind: "day",
  minGrade: "resident",
  siteId: null,
};
const reads = {
  overview,
  assignments: { assignments: [give, take] },
  requests: { swaps: [swap], openShifts: [] as (typeof open)[] },
  unavailability: { unavailability: [] },
  members: {
    members: [
      { userId: ME, name: "You", grade: "resident" },
      { userId: MEI, name: "Mei", grade: "resident" },
    ],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  teamsState.data.teams.length = 1;
  window.history.replaceState({}, "", "/roster/requests");
  reads.requests.swaps = [swap];
  reads.requests.openShifts = [];
  overview.me.grade = "resident";
  reads.assignments.assignments = [give, take];
  mocks.fetchRead.mockImplementation(async (_serviceId: string, what: string) => ({
    ok: true,
    data: what === "leave_overlap" ? { alreadyOff: 2 } : reads[what as keyof typeof reads],
    readAt: new Date("2026-10-20T10:21:00Z"),
  }));
  mocks.post.mockResolvedValue({
    ok: true,
    result: { swapId: SWAP, openShiftId: OPEN, status: "approved", autoApproved: true },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ leave: [] })),
  );
});

it("opens the calendar swap flow from a handoff, using a valid team ID and never takes an actor from the URL", async () => {
  const second = "5e000000-0000-4000-8000-000000000009";
  teamsState.data.teams.push({ ...teamsState.data.teams[0]!, serviceId: second, name: "Other team" });
  window.history.replaceState({}, "", `/roster/requests?start=swap&team=${second}&assignment=${TAKE}&actorId=${MEI}`);
  render(<RosterRequestsPage />);
  expect(await screen.findByRole("dialog", { name: "Swap this shift" })).toBeTruthy();
  expect(mocks.fetchRead).toHaveBeenCalledWith(second, "overview");
  expect(mocks.post).not.toHaveBeenCalled();
});

it("opens a swap handoff with the colleague from Who can cover? already chosen", async () => {
  window.history.replaceState({}, "", `/roster/requests?start=swap&assignment=${TAKE}&person=${MEI}`);
  render(<RosterRequestsPage />);
  expect(await screen.findByRole("dialog", { name: "Swap this shift" })).toBeTruthy();
  expect(await screen.findByText("What would you take from Mei?")).toBeTruthy();
  expect(mocks.post).not.toHaveBeenCalled();
});

it("drops a person that is not an ID and opens the swap at Who", async () => {
  window.history.replaceState({}, "", `/roster/requests?start=swap&assignment=${TAKE}&person=not-an-id`);
  render(<RosterRequestsPage />);
  expect(await screen.findByRole("dialog", { name: "Swap this shift" })).toBeTruthy();
  expect(await screen.findByText("Can swap")).toBeTruthy();
  expect(screen.queryByText(/What would you take from/)).toBeNull();
});

it("opens an Ask dates handoff with Prefer off already selected", async () => {
  const day = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  window.history.replaceState({}, "", `/roster/requests?start=dates&team=${SERVICE}&date=${day}&kind=prefer_off`);
  render(<RosterRequestsPage />);
  expect(await screen.findByRole("dialog", { name: "Dates I can't work" })).toBeTruthy();
  expect(await screen.findByRole("button", { name: `${day}: Prefer off` })).toBeTruthy();
});

it("no longer lists swaps or open shifts, and points to the Swaps page", () => {
  reads.requests.openShifts = [open];
  render(<RosterRequestsPage />);
  expect(screen.queryByRole("button", { name: "Review" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Take it" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Swap a shift" })).toBeNull();
  expect(screen.getByRole("link", { name: /Swaps and open shifts/ }).getAttribute("href")).toBe("/roster/swaps");
});

it("still opens I can't make my shift from the New menu", async () => {
  const user = userEvent.setup();
  render(<RosterRequestsPage />);
  await user.click(screen.getByRole("button", { name: "New" }));
  expect(screen.queryByRole("button", { name: "Swap a shift" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "I can't make my shift" }));
  expect(await screen.findByRole("dialog", { name: "I can't make my shift" })).toBeTruthy();
});

it("shows an anonymous leave overlap count", async () => {
  const user = userEvent.setup();
  reads.requests.swaps = [];
  render(<RosterRequestsPage />);
  await user.click(screen.getByRole("button", { name: "New" }));
  await user.click(screen.getByRole("button", { name: "Plan leave" }));
  await user.type(screen.getByLabelText("From"), "2026-12-22");
  await user.type(screen.getByLabelText("To"), "2027-01-02");
  expect(await screen.findByText("2 of the team are already off these dates")).toBeTruthy();
  expect(mocks.fetchRead).toHaveBeenCalledWith(SERVICE, "leave_overlap", { from: "2026-12-22", to: "2027-01-02" });
});

it("shows leave as loading, not as empty, until the leave read answers", async () => {
  let answer: (response: Response) => void = () => undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    ),
  );
  render(<RosterRequestsPage />);
  expect(await screen.findByText("Loading your leave…")).toBeTruthy();
  expect(screen.queryByText(/Nothing yet/)).toBeNull();
  answer(Response.json({ leave: [] }));
  expect(await screen.findByText(/Nothing yet/)).toBeTruthy();
});

it("lists leave with the HR status the doctor marked, and opens it for review", async () => {
  const user = userEvent.setup();
  const id = "5e000000-0000-4000-8000-00000000000a";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        leave: [
          { id, kind: "annual", startsOn: "2099-10-07", endsOn: "2099-10-07", status: "planned", serviceId: null },
        ],
      }),
    ),
  );
  render(<RosterRequestsPage />);
  expect(await screen.findByText("Wed 7 Oct · 1 day · you marked it: not yet lodged in HR")).toBeTruthy();
  expect(screen.getByText("HR status is what you mark yourself. PsychSift does not talk to HR.")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /^Review annual leave/ }));
  expect(await screen.findByRole("dialog")).toBeTruthy();
});

it("lists my dates I can't work, joining back-to-back days, and leaves out other people's", () => {
  const original = reads.unavailability;
  reads.unavailability = {
    unavailability: [
      { userId: ME, date: "2026-10-24", kind: "cant" },
      { userId: ME, date: "2026-10-31", kind: "prefer_off" },
      { userId: ME, date: "2026-11-01", kind: "prefer_off" },
      { userId: MEI, date: "2026-10-25", kind: "cant" },
    ],
  } as never;
  try {
    render(<RosterRequestsPage />);
    const list = screen.getByRole("list", { name: "Dates I can't work" });
    expect(list.querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByText("Can't work")).toBeTruthy();
    expect(screen.getByText("October")).toBeTruthy();
    expect(screen.getByText("Sat 31 Oct to Sun 1 Nov · 2 days")).toBeTruthy();
    expect(screen.getByText("Your manager sees these dates. Reasons are not saved.")).toBeTruthy();
  } finally {
    reads.unavailability = original;
  }
});

it("opens the dates sheet from Add", async () => {
  const user = userEvent.setup();
  render(<RosterRequestsPage />);
  await user.click(screen.getByRole("button", { name: "Add dates I can't work" }));
  expect(await screen.findByRole("dialog", { name: "Dates I can't work" })).toBeTruthy();
});
