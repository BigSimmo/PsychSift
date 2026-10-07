// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchRead: vi.fn(),
  post: vi.fn(),
  copy: vi.fn(),
  announce: vi.fn(),
  auth: { status: "authenticated", authEpoch: 1 },
  teams: {
    status: "ready" as string,
    message: null as string | null,
    reload: vi.fn(),
    data: null as unknown,
  },
}));
vi.mock("@/components/roster/use-roster-team", () => ({
  useRosterTeams: () => mocks.teams,
  fetchRosterRead: mocks.fetchRead,
  postRosterAction: mocks.post,
}));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => mocks.auth }));
vi.mock("@/components/roster/ask/roster-ask-box", () => ({ RosterAskButton: () => null }));
vi.mock("@/lib/copy-to-clipboard", () => ({ copyTextToClipboard: mocks.copy }));
vi.mock("@/components/ui/live-announcer", () => ({ announce: mocks.announce }));

import { RosterSickPage } from "@/components/roster/sick/roster-sick-page";

// Tue 6 Oct 2026, 19:30 in Perth.
const NOW = new Date("2026-10-06T11:30:00Z");
const ME = "5e000000-0000-4000-8000-000000000001";
const SERVICE = "5e000000-0000-4000-8000-000000000003";
const DAY = "5e000000-0000-4000-8000-000000000010";
const CALL = "5e000000-0000-4000-8000-000000000011";
const OPEN = "5e000000-0000-4000-8000-0000000000f1";

const team = { serviceId: SERVICE, name: "Ward 4", enabled: true, role: "member", grade: "registrar" };
const base = { userId: ME, name: "Me", grade: "registrar", siteId: null, siteName: "Example Hospital" };
const tomorrowDay = {
  ...base,
  id: DAY,
  startsAt: "2026-10-07T00:00:00Z",
  endsAt: "2026-10-07T08:30:00Z",
  shiftCode: "D",
  kind: "day",
};
const tonightCall = {
  ...base,
  id: CALL,
  startsAt: "2026-10-06T13:00:00Z",
  endsAt: "2026-10-07T00:00:00Z",
  shiftCode: "OC",
  kind: "on_call",
};

let assignments: unknown[];
let openShifts: unknown[];
let managers: unknown;
let readFails: boolean;
let ownShifts: unknown[];

function overview() {
  return {
    service: { id: SERVICE, name: "Ward 4" },
    me: { role: "member", grade: "registrar", rotationEndsOn: null },
    latestPublication: null,
    seenLatest: true,
    settings: { swapApproval: "auto_same_grade", rules: {}, rulesSource: null, payFortnightAnchor: null },
    sites: [],
    ...(managers ? { managers } : {}),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  assignments = [tomorrowDay, tonightCall];
  openShifts = [];
  managers = [{ userId: "5e000000-0000-4000-8000-0000000000aa", name: "Dr Grant" }];
  readFails = false;
  ownShifts = [];
  mocks.auth = { status: "authenticated", authEpoch: 1 };
  mocks.teams = { status: "ready", message: null, reload: vi.fn(), data: { teams: [team], actorId: ME } };
  mocks.fetchRead.mockReset().mockImplementation(async (_service: string, what: string) => {
    if (readFails) return { ok: false, code: "roster_unavailable", message: "down" };
    const readAt = new Date();
    if (what === "assignments") return { ok: true, data: { assignments }, readAt };
    if (what === "requests") return { ok: true, data: { swaps: [], openShifts }, readAt };
    return { ok: true, data: overview(), readAt };
  });
  mocks.post.mockReset().mockResolvedValue({ ok: true, result: { openShiftId: OPEN, status: "reported" } });
  mocks.copy.mockReset().mockResolvedValue(undefined);
  mocks.announce.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ shifts: ownShifts }), { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

async function renderPage() {
  render(<RosterSickPage now={NOW} />);
  return screen.findByRole("list", { name: "Which shift" });
}

it("picks tomorrow's shift first and says exactly what will happen", async () => {
  const picker = await renderPage();
  expect(screen.getByRole("heading", { name: "Sick for tomorrow" })).toBeTruthy();
  expect((within(picker).getByLabelText(/Wed 7 · Day/) as HTMLInputElement).checked).toBe(true);
  expect((within(picker).getByLabelText(/Tonight · On call/) as HTMLInputElement).checked).toBe(false);
  expect(within(picker).getByText("21:00 to Wed 08:00 · Example Hospital")).toBeTruthy();
  const send = screen.getByTestId("sick-send");
  expect(send.textContent).toContain("I'm sick for tomorrow");
  expect(send.textContent).toContain("Sends to Dr Grant · 10 s to undo");
  const plan = screen.getByRole("list", { name: "What happens next" });
  expect(plan.textContent).toContain("Dr Grant is told");
  expect(plan.textContent).toContain("Posted on Open shifts");
  expect(plan.textContent).toContain("A locum only if nobody takes it");
  expect(screen.getByText(/never asks for or keeps health details/)).toBeTruthy();
  expect(screen.queryByTestId("sick-short-notice")).toBeNull();
});

it("picking tonight too sends both and warns that tonight is short notice", async () => {
  const picker = await renderPage();
  await user().click(within(picker).getByLabelText(/Tonight · On call/));
  expect(screen.getByTestId("sick-send").textContent).toContain("I'm sick for both");
  expect(screen.getByTestId("sick-short-notice").textContent).toContain("Tonight starts in 1 h 30");
  expect(screen.getByText("2 picked")).toBeTruthy();
});

it("holds the report for 10 seconds and Undo sends nothing", async () => {
  await renderPage();
  await user().click(screen.getByTestId("sick-send"));
  expect(screen.getByRole("timer", { name: "10 seconds to undo" })).toBeTruthy();
  expect(screen.getByText("Nothing has gone yet")).toBeTruthy();
  expect(screen.getByText(/Leave this page in the next 10 seconds/)).toBeTruthy();
  // The picks are fixed while held.
  expect((screen.getByLabelText(/Tonight · On call/) as HTMLInputElement).disabled).toBe(true);
  await user().click(screen.getByRole("button", { name: "Undo" }));
  await act(async () => {
    vi.advanceTimersByTime(12_000);
  });
  expect(mocks.post).not.toHaveBeenCalled();
  expect(screen.getByTestId("sick-outcome").textContent).toContain("Not sent. Your Wed 7 · Day is unchanged.");
  expect(mocks.announce).toHaveBeenCalledWith("Not sent. Your Wed 7 · Day is unchanged.");
});

it("sends open.report with keepalive once the 10 seconds are up, then reads again", async () => {
  await renderPage();
  await user().click(screen.getByTestId("sick-send"));
  expect(mocks.post).not.toHaveBeenCalled();
  const readsBefore = mocks.fetchRead.mock.calls.length;
  await act(async () => {
    vi.advanceTimersByTime(10_000);
  });
  expect(mocks.post).toHaveBeenCalledWith(SERVICE, { action: "open.report", assignmentId: DAY }, { keepalive: true });
  expect((await screen.findByTestId("sick-outcome")).textContent).toMatch(/Sent at \d\d:\d\d\. Dr Grant is told\./);
  expect(mocks.fetchRead.mock.calls.length).toBeGreaterThan(readsBefore);
});

it("Send now skips the wait", async () => {
  await renderPage();
  await user().click(screen.getByTestId("sick-send"));
  await user().click(screen.getByRole("button", { name: "Send now" }));
  expect(mocks.post).toHaveBeenCalledTimes(1);
});

it("leaving the page while held cancels the report", async () => {
  await renderPage();
  await user().click(screen.getByTestId("sick-send"));
  act(() => {
    window.dispatchEvent(new Event("pagehide"));
  });
  await act(async () => {
    vi.advanceTimersByTime(12_000);
  });
  expect(mocks.post).not.toHaveBeenCalled();
});

it("a refused send says so in plain words and nothing claims it was sent", async () => {
  mocks.post.mockResolvedValue({ ok: false, code: "roster_request_exists", message: "Server internals" });
  await renderPage();
  await user().click(screen.getByTestId("sick-send"));
  await user().click(screen.getByRole("button", { name: "Send now" }));
  const outcome = await screen.findByTestId("sick-outcome");
  expect(outcome.getAttribute("role")).toBe("alert");
  expect(outcome.textContent).toContain("Nothing was sent. Phone your roster manager.");
  expect(outcome.textContent).toContain("already has a swap or offer waiting");
  expect(outcome.textContent).not.toMatch(/Server internals|roster_request_exists/);
});

it("one of two failing is reported as partial", async () => {
  mocks.post
    .mockResolvedValueOnce({ ok: true, result: { openShiftId: OPEN, status: "reported" } })
    .mockResolvedValueOnce({ ok: false, code: "roster_not_found", message: "x" });
  const picker = await renderPage();
  await user().click(within(picker).getByLabelText(/Tonight · On call/));
  await user().click(screen.getByTestId("sick-send"));
  await user().click(screen.getByRole("button", { name: "Send now" }));
  const outcome = await screen.findByTestId("sick-outcome");
  expect(outcome.textContent).toContain("1 of 2 sent. Phone your roster manager about the rest.");
  expect(outcome.textContent).toContain("Wed 7 · Day: This shift has changed");
});

it("the example team refuses to send and says to phone", async () => {
  mocks.teams = { ...mocks.teams, data: { teams: [team], actorId: ME, sample: true } };
  await renderPage();
  const send = screen.getByTestId("sick-send");
  expect(send.getAttribute("aria-disabled")).toBe("true");
  expect(screen.getByText(/example team, so nothing can be sent/)).toBeTruthy();
  await user().click(send);
  expect(screen.queryByRole("timer")).toBeNull();
  expect(mocks.post).not.toHaveBeenCalled();
});

it("signed out cannot send", async () => {
  mocks.auth = { status: "signed_out", authEpoch: 0 };
  await renderPage();
  expect(screen.getByText(/Sign in to send this/)).toBeTruthy();
  await user().click(screen.getByTestId("sick-send"));
  expect(screen.queryByRole("timer")).toBeNull();
});

it("offline shows the no-connection state and blocks the send", async () => {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  await renderPage();
  expect(screen.getByTestId("sick-offline").textContent).toContain("No connection. Nothing sent.");
  expect(screen.getByTestId("sick-send").getAttribute("aria-disabled")).toBe("true");
});

it("offline, Send when I'm back online starts the 10 second window when the signal returns", async () => {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  await renderPage();
  await user().click(screen.getByTestId("sick-queue"));
  expect(screen.getByTestId("sick-queued").textContent).toContain("Only while this page stays open");
  expect(mocks.post).not.toHaveBeenCalled();
  await act(async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    window.dispatchEvent(new Event("online"));
  });
  expect(screen.getByRole("timer", { name: "10 seconds to undo" })).toBeTruthy();
  expect(mocks.post).not.toHaveBeenCalled();
  await act(async () => {
    vi.advanceTimersByTime(10_000);
  });
  expect(mocks.post).toHaveBeenCalledWith(SERVICE, { action: "open.report", assignmentId: DAY }, { keepalive: true });
});

it("offline, Don't send drops the queued report", async () => {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  await renderPage();
  await user().click(screen.getByTestId("sick-queue"));
  await user().click(screen.getByTestId("sick-queue-cancel"));
  await act(async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    window.dispatchEvent(new Event("online"));
    vi.advanceTimersByTime(12_000);
  });
  expect(mocks.post).not.toHaveBeenCalled();
});

it("shows a report already sent with its progress, and Take back cancels it", async () => {
  assignments = [tomorrowDay];
  openShifts = [
    {
      id: OPEN,
      status: "open",
      urgent: true,
      startsAt: tomorrowDay.startsAt,
      endsAt: tomorrowDay.endsAt,
      shiftCode: "D",
      kind: "day",
      minGrade: null,
      siteId: null,
      mine: true,
      claimedByMe: false,
    },
  ];
  mocks.post.mockResolvedValue({ ok: true, result: { openShiftId: OPEN, status: "cancelled" } });
  render(<RosterSickPage now={NOW} />);
  const sent = await screen.findByTestId("sick-sent");
  expect(sent.getAttribute("aria-label")).toBe("Wed 7 · Day: On Open shifts");
  expect(sent.textContent).toContain("Marked urgent · no taker yet");
  // Already reported: it is not offered again.
  expect(screen.queryByRole("list", { name: "Which shift" })).toBeNull();
  await user().click(within(sent).getByRole("button", { name: "Take back" }));
  expect(mocks.post).toHaveBeenCalledWith(SERVICE, { action: "open.cancel", openShiftId: OPEN });
  expect((await screen.findByTestId("sick-outcome")).textContent).toContain(
    "Taken back. Your Wed 7 · Day is yours again.",
  );
});

it("a covered report says so and offers no take back", async () => {
  assignments = [];
  openShifts = [
    {
      id: OPEN,
      status: "approved",
      urgent: true,
      startsAt: tomorrowDay.startsAt,
      endsAt: tomorrowDay.endsAt,
      shiftCode: "D",
      kind: "day",
      minGrade: null,
      siteId: null,
      mine: true,
      claimedByMe: false,
    },
  ];
  render(<RosterSickPage now={NOW} />);
  const sent = await screen.findByTestId("sick-sent");
  expect(sent.textContent).toContain("Covered");
  expect(sent.textContent).toContain("Locum not needed");
  expect(within(sent).queryByRole("button", { name: "Take back" })).toBeNull();
});

it("a shift already offered to the team is locked with the reason", async () => {
  openShifts = [
    {
      id: OPEN,
      status: "open",
      urgent: false,
      startsAt: tomorrowDay.startsAt,
      endsAt: tomorrowDay.endsAt,
      shiftCode: "D",
      kind: "day",
      minGrade: null,
      siteId: null,
      mine: true,
      claimedByMe: false,
    },
  ];
  const picker = await renderPage();
  const locked = within(picker).getByLabelText(/Wed 7 · Day/) as HTMLInputElement;
  expect(locked.disabled).toBe(true);
  expect(within(picker).getByText(/Already offered to your team/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Open Swaps" }).getAttribute("href")).toBe("/roster/swaps");
});

it("lists own-roster shifts honestly: nobody can be told from here", async () => {
  ownShifts = [
    {
      id: "own-1",
      startsAt: "2026-10-07T10:00:00Z",
      endsAt: "2026-10-07T14:00:00Z",
      title: "Clinic",
      workplace: "Rooms",
    },
  ];
  await renderPage();
  const list = await screen.findByTestId("sick-personal");
  expect(list.textContent).toContain("Wed 7 · Clinic");
  expect(list.textContent).toContain("PsychSift can't tell anyone. Phone your manager.");
});

it("copies a message with the shifts only", async () => {
  await renderPage();
  await user().click(screen.getByTestId("sick-copy"));
  expect(mocks.copy).toHaveBeenCalledWith(
    "Hi, I'm unwell and can't work my day shift on Wed 7 (08:00 to 16:30). I've reported it in PsychSift Roster so it can go on Open shifts.",
  );
  expect(await screen.findByText("Copied")).toBeTruthy();
});

it("with no shifts today or tomorrow it says so and links My shifts", async () => {
  assignments = [];
  render(<RosterSickPage now={NOW} />);
  const empty = await screen.findByTestId("sick-empty");
  expect(empty.textContent).toContain("No shifts today or tomorrow");
  expect(within(empty).getByRole("link", { name: "See my shifts" }).getAttribute("href")).toBe("/roster/shifts");
  expect(screen.queryByTestId("sick-send")).toBeNull();
});

it("with no team it says where sick reports go and links Join a team", async () => {
  mocks.teams = { ...mocks.teams, data: { teams: [], actorId: ME } };
  render(<RosterSickPage now={NOW} />);
  const note = await screen.findByTestId("sick-no-team");
  expect(within(note).getByRole("link", { name: "Join a team" }).getAttribute("href")).toBe("/roster/join");
});

it("a failed read fails closed with Try again", async () => {
  readFails = true;
  render(<RosterSickPage now={NOW} />);
  expect((await screen.findByRole("alert")).textContent).toContain("couldn't be checked. Nothing was sent.");
  readFails = false;
  await user().click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("list", { name: "Which shift" })).toBeTruthy();
});

it("links the agreement for personal leave without stating any entitlement", async () => {
  await renderPage();
  const link = screen.getByRole("link", { name: /Check your agreement/ });
  expect(link.getAttribute("href")).toMatch(/^https:\/\/www\.health\.wa\.gov\.au\//);
  expect(document.body.textContent).not.toMatch(/\d+ days? (of )?(personal|sick) leave/i);
});
