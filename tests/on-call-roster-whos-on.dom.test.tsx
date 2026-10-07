/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RosterAssignment } from "@/lib/roster/team/model";

vi.mock("next/navigation", () => ({
  usePathname: () => "/on-call/whos-on/roster",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

type ReadState = {
  status: "loading" | "ready" | "signed-out" | "not-confirmed" | "unavailable" | "error";
  data: unknown;
  message: string | null;
  reload: () => void;
  readAt: Date | null;
};

const roster = vi.hoisted(() => ({
  teams: null as unknown as ReadState,
  overview: null as unknown as ReadState,
  assignments: null as unknown as ReadState,
  asked: [] as (string | null)[],
}));
vi.mock("@/components/roster/use-roster-team", () => ({
  useRosterTeams: () => roster.teams,
  useRosterRead: (serviceId: string | null, what: "overview" | "assignments") => {
    roster.asked.push(serviceId);
    return what === "overview" ? roster.overview : roster.assignments;
  },
}));

const handbook = vi.hoisted(() => ({ state: null as unknown }));
vi.mock("@/components/on-call/use-hospital-handbook", () => ({ useHospitalHandbook: () => handbook.state }));

const clipboard = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/copy-to-clipboard", () => ({ copyTextToClipboard: clipboard }));

const { OnCallRosterWhosOnPage, OnCallRosterRightNow } =
  await import("@/components/on-call/roster-whos-on/on-call-roster-whos-on-page");
const { ToastProvider } = await import("@/components/ui/toast");
const { handbookItems, readyHandbook } = await import("./helpers/on-call-handbook-fixtures");
const { RosterWhosOnEntryLink } = await import("@/components/on-call/roster-whos-on/roster-whos-on-entry-link");

// 21:40 Perth on Tue 6 Oct 2026.
const NOW = new Date("2026-10-06T13:40:00Z");
const ME = "00000000-0000-4000-8000-0000000000aa";
const TEAM_A = "10000000-0000-4000-8000-00000000000a";
const TEAM_B = "10000000-0000-4000-8000-00000000000b";

let counter = 0;
function shift(over: Partial<RosterAssignment> & { start: string; end: string }): RosterAssignment {
  counter += 1;
  const { start, end, ...rest } = over;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    userId: `00000000-0000-4000-8000-1${String(counter).padStart(11, "0")}`,
    name: "Dr Example",
    grade: "registrar",
    siteId: null,
    siteName: null,
    startsAt: `${start}+08:00`,
    endsAt: `${end}+08:00`,
    shiftCode: "D",
    kind: "day",
    ...rest,
  };
}

const NIGHT = shift({ name: "Dr Tran Nguyen", kind: "night", start: "2026-10-06T21:00", end: "2026-10-07T08:30" });
const EVENING = shift({ name: "Dr Sam Lee", kind: "evening", start: "2026-10-06T14:00", end: "2026-10-06T22:00" });
const MINE = shift({ userId: ME, name: "Dr Me", start: "2026-10-06T08:00", end: "2026-10-06T16:30" });
const LEAVE = shift({ name: "Dr On Leave", kind: "leave", start: "2026-10-06T00:00", end: "2026-10-07T00:00" });
const TOMORROW = shift({ name: "Dr Ana Patel", start: "2026-10-07T08:00", end: "2026-10-07T16:30" });
const GAP = shift({ name: "  ", kind: "on_call", start: "2026-10-06T17:00", end: "2026-10-06T23:00" });

const PUBLICATION = {
  id: "20000000-0000-4000-8000-000000000001",
  version: 4,
  publishedAt: "2026-10-03T08:10:00.000Z",
  periodStart: "2026-09-28",
  periodEnd: "2026-10-25",
};

function ready(data: unknown, reload = vi.fn()): ReadState {
  return { status: "ready", data, message: null, reload, readAt: new Date("2026-10-06T13:35:00Z") };
}

function setTeams(teams: { serviceId: string; name: string; enabled?: boolean }[], extra: object = {}) {
  roster.teams = ready({
    teams: teams.map((team) => ({ role: "member", grade: "registrar", enabled: true, ...team })),
    actorId: ME,
    ...extra,
  });
}

function renderPage() {
  return render(
    <ToastProvider>
      <OnCallRosterWhosOnPage now={NOW} />
    </ToastProvider>,
  );
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value });
}

beforeEach(() => {
  roster.asked = [];
  clipboard.mockClear();
  setOnline(true);
  handbook.state = readyHandbook(handbookItems([{ id: "sb", title: "Switchboard", phone: "9000 0000" }]));
  setTeams([{ serviceId: TEAM_A, name: "Inpatient Psychiatry" }]);
  roster.overview = ready({ latestPublication: PUBLICATION });
  roster.assignments = ready({ assignments: [NIGHT, EVENING, MINE, LEAVE, TOMORROW] });
});
afterEach(cleanup);

describe("From your team roster", () => {
  it("lists today's people, on now first, and never shows leave", () => {
    renderPage();
    const list = screen.getByTestId("on-call-roster-list");
    const rows = within(list).getAllByRole("button");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Dr Sam Lee"),
      expect.stringContaining("Dr Tran Nguyen"),
      expect.stringContaining("You"),
    ]);
    expect(rows[0]).toHaveTextContent("Late registrar · on now");
    expect(rows[0]).toHaveTextContent("14:00 to 22:00 · then Dr Tran Nguyen");
    expect(rows[1]).toHaveTextContent("Night registrar · on now");
    expect(rows[2]).toHaveTextContent("You");
    expect(within(rows[2]!).getAllByText("You").length).toBeGreaterThan(0);
    expect(rows[1]).toHaveTextContent("21:00 to 08:30 Wed");
    expect(rows[2]).not.toHaveTextContent("on now");
    expect(list).not.toHaveTextContent("Leave");
    expect(list).not.toHaveTextContent("Dr On Leave");
    // One heading for the list, never a hidden h1 and a visible h2 saying the same thing.
    expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual([
      "Who is on, from your team roster",
    ]);
    expect(screen.getByRole("region", { name: "Who is on, from your team roster" })).toBeInTheDocument();
    expect(screen.getByTestId("on-call-roster-whos-on")).toHaveTextContent("From your team roster");
    // The count says what it counts.
    expect(screen.getByTestId("on-call-roster-whos-on").querySelector(".work-label__count")).toHaveTextContent(
      "3 shifts",
    );
    // Names sit on the row, never inside the rail, where a short shift would clip them.
    for (const rail of within(list).getAllByRole("img")) expect(rail.textContent).toBe("");
    // A visible way back to Who's on.
    expect(screen.getByTestId("on-call-roster-back")).toHaveAttribute("href", "/on-call/whos-on");
    // The now marker sits on today's rails only.
    expect(screen.getAllByTestId("on-call-roster-now-mark").length).toBe(3);
    // A full list with nobody missing needs no switchboard prompt.
    expect(screen.queryByTestId("on-call-roster-switchboard")).toBeNull();
    // The time rail is described in words for screen readers.
    expect(within(rows[1]!).getByRole("img").getAttribute("aria-label")).toMatch(/21:00/);
  });

  it("says where the list comes from and when it was loaded", () => {
    renderPage();
    const provenance = screen.getByTestId("on-call-roster-provenance");
    expect(provenance).toHaveTextContent("From the Inpatient Psychiatry roster. Published Sat 3 Oct 16:10, version 4");
    expect(provenance).toHaveTextContent("Loaded 21:35");
  });

  it("switches to tomorrow, and says a day past the published period is not out", () => {
    renderPage();
    fireEvent.click(screen.getByRole("radio", { name: "Tomorrow" }));
    expect(screen.getByTestId("on-call-roster-list")).toHaveTextContent("Dr Ana Patel");
    cleanup();
    roster.overview = ready({ latestPublication: { ...PUBLICATION, periodEnd: "2026-10-06" } });
    renderPage();
    fireEvent.click(screen.getByRole("radio", { name: "Tomorrow" }));
    expect(screen.getByTestId("on-call-roster-not-out")).toHaveTextContent("Not published yet");
    expect(screen.queryByTestId("on-call-roster-list")).toBeNull();
  });

  it("says no roster is published, and nobody is rostered, without guessing", () => {
    roster.overview = ready({ latestPublication: null });
    renderPage();
    expect(screen.getByTestId("on-call-roster-unpublished")).toHaveTextContent("Nobody is guessed");
    cleanup();
    roster.overview = ready({ latestPublication: PUBLICATION });
    roster.assignments = ready({ assignments: [LEAVE] });
    renderPage();
    expect(screen.getByTestId("on-call-roster-nobody")).toHaveTextContent("Ring switchboard");
    expect(screen.getByTestId("on-call-roster-switchboard")).toHaveTextContent("Switchboard");
  });

  it("marks a shift with nobody rostered instead of guessing who covers it, and offers switchboard", () => {
    roster.assignments = ready({ assignments: [GAP] });
    renderPage();
    const row = within(screen.getByTestId("on-call-roster-list")).getByRole("button");
    expect(row).toHaveTextContent("Nobody rostered");
    expect(screen.getByTestId("on-call-roster-gap")).toHaveTextContent("1 shift with nobody rostered");
    expect(screen.getByTestId("on-call-roster-switchboard-row")).toBeInTheDocument();
    fireEvent.click(row);
    expect(screen.getByTestId("on-call-roster-person-sheet")).toHaveTextContent("Nobody is guessed");
  });

  it("keeps the last read on screen when the connection drops, dimmed and marked not live", () => {
    const view = renderPage();
    expect(screen.getByTestId("on-call-roster-provenance")).toHaveTextContent("Loaded 21:35");
    // Only the connection drops: the read itself stays "ready", as it does on a real phone.
    setOnline(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    view.rerender(
      <ToastProvider>
        <OnCallRosterWhosOnPage now={NOW} />
      </ToastProvider>,
    );
    expect(screen.getByTestId("on-call-roster-provenance")).toHaveTextContent("Offline. Roster as of 21:35");
    expect(screen.getByTestId("on-call-roster-provenance")).toHaveTextContent("Not live");
    expect(screen.getByTestId("on-call-roster-list")).toHaveTextContent("Dr Tran Nguyen");
    expect(screen.queryByTestId("on-call-roster-now-mark")).toBeNull();
    expect(screen.getByTestId("on-call-roster-stale")).toHaveTextContent("A later change would not show");
    expect(screen.getByTestId("on-call-roster-switchboard")).toBeInTheDocument();
  });

  it("says a failed refresh while online is not live, without calling it offline", () => {
    const view = renderPage();
    roster.assignments = { status: "error", data: null, message: "x", reload: vi.fn(), readAt: null };
    view.rerender(
      <ToastProvider>
        <OnCallRosterWhosOnPage now={NOW} />
      </ToastProvider>,
    );
    const strip = screen.getByTestId("on-call-roster-provenance");
    expect(strip).toHaveTextContent("Could not refresh. Roster as of 21:35");
    expect(strip).toHaveTextContent("Not live");
    expect(strip).not.toHaveTextContent("Offline");
  });

  it("shows a change from the roster by itself, with a count on the source strip", () => {
    const view = renderPage();
    expect(screen.queryByTestId("on-call-roster-change-count")).toBeNull();
    const covered = { ...EVENING, name: "Dr Ana Lowe", userId: "00000000-0000-4000-8000-0000000000fe" };
    roster.assignments = {
      ...ready({ assignments: [NIGHT, covered, MINE, LEAVE, TOMORROW] }),
      readAt: new Date("2026-10-06T13:41:00Z"),
    };
    view.rerender(
      <ToastProvider>
        <OnCallRosterWhosOnPage now={NOW} />
      </ToastProvider>,
    );
    expect(screen.getByTestId("on-call-roster-change-count")).toHaveTextContent("1 change");
    expect(screen.getByTestId(`on-call-roster-changed-${EVENING.id}`)).toHaveTextContent(
      "Changed on the roster, seen 21:41",
    );
    expect(screen.getByTestId("on-call-roster-list")).toHaveTextContent("Dr Ana Lowe");
  });

  it("reads the roster again every two minutes while open", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const reload = vi.fn();
      roster.assignments = ready({ assignments: [NIGHT] }, reload);
      renderPage();
      act(() => {
        vi.advanceTimersByTime(2 * 60_000);
      });
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("builds a note for the roster manager, catches patient details, and never changes the list", async () => {
    roster.overview = ready({ latestPublication: PUBLICATION, managers: [{ userId: ME, name: "Dr Grant" }] });
    renderPage();
    fireEvent.click(within(screen.getByTestId("on-call-roster-list")).getAllByRole("button")[1]!);
    expect(screen.getByTestId("on-call-roster-person-manager")).toHaveTextContent("Dr Grant");
    fireEvent.click(screen.getByTestId("on-call-roster-report"));
    const copy = screen.getByTestId("on-call-roster-report-copy");
    expect(copy).toBeDisabled();
    fireEvent.click(screen.getByTestId("on-call-roster-reason-someone-else"));
    expect(copy).not.toBeDisabled();
    fireEvent.change(screen.getByTestId("on-call-roster-report-note"), { target: { value: "Bed 7 review ran over" } });
    expect(screen.getByRole("alert")).toHaveTextContent("This looks like a bed number");
    expect(copy).toBeDisabled();
    for (const value of ["J Smith rang", "45M in ED", "Room 4 review", "Call 0412 345 678", "Mrs\u200BSmith"]) {
      fireEvent.change(screen.getByTestId("on-call-roster-report-note"), { target: { value } });
      expect(copy).toBeDisabled();
    }
    fireEvent.change(screen.getByTestId("on-call-roster-report-note"), {
      target: { value: "Dr Patel answered the page" },
    });
    expect(copy).not.toBeDisabled();
    fireEvent.click(copy);
    await screen.findByText("Note copied for Dr Grant. The list is unchanged until the roster is.");
    const [text] = clipboard.mock.calls[0] as unknown as [string];
    expect(text).toContain("Dr Tran Nguyen");
    expect(text).toContain("Dr Patel answered the page");
    expect(screen.getByTestId("on-call-roster-list")).toHaveTextContent("Dr Tran Nguyen");
  });

  it("draws the compact Right now block with only who is on at this moment", () => {
    render(<OnCallRosterRightNow now={NOW} />);
    const block = screen.getByTestId("on-call-roster-right-now");
    expect(block).toHaveTextContent("Right now, from your roster");
    expect(within(block).getByRole("link", { name: "All roles" })).toHaveAttribute("href", "/on-call/whos-on/roster");
    expect(within(screen.getByTestId("on-call-roster-list")).getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("asks a signed-out reader to sign in", () => {
    roster.teams = { status: "signed-out", data: null, message: null, reload: vi.fn(), readAt: null };
    renderPage();
    expect(screen.getByTestId("on-call-roster-signed-out")).toHaveTextContent("Sign in to see who is on");
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("shows no old list after a failed read, and Try again reloads both reads", () => {
    const reload = vi.fn();
    roster.assignments = { status: "error", data: null, message: "x", reload, readAt: null };
    roster.overview = ready({ latestPublication: PUBLICATION }, reload);
    renderPage();
    expect(screen.getByTestId("on-call-roster-failed")).toHaveAttribute("role", "alert");
    expect(screen.queryByTestId("on-call-roster-list")).toBeNull();
    fireEvent.click(screen.getByTestId("on-call-roster-retry"));
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("retries a failed read when the connection comes back", () => {
    const reload = vi.fn();
    roster.teams = { status: "error", data: null, message: null, reload, readAt: null };
    setOnline(false);
    renderPage();
    expect(screen.getByTestId("on-call-roster-teams-failed")).toHaveTextContent("You are offline");
    expect(reload).not.toHaveBeenCalled();
    setOnline(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("opens one person's shift and its source in a sheet", () => {
    renderPage();
    fireEvent.click(within(screen.getByTestId("on-call-roster-list")).getAllByRole("button")[1]!);
    const sheet = screen.getByTestId("on-call-roster-person-sheet");
    expect(screen.getByTestId("on-call-roster-person-headline")).toHaveTextContent("Until Wed 7 Oct 08:30");
    expect(sheet).toHaveTextContent("Inpatient Psychiatry");
    expect(screen.getByTestId("on-call-roster-person-published")).toHaveTextContent("Sat 3 Oct 16:10, version 4");
    expect(screen.getByTestId("on-call-roster-open-team")).toHaveAttribute("href", "/roster/team");
    expect(sheet).not.toHaveTextContent(/\d{4} \d{4}/);
  });

  it("labels the signed-out sample as made up", () => {
    setTeams([{ serviceId: TEAM_A, name: "General Medicine" }], { sample: true });
    renderPage();
    expect(screen.getByTestId("on-call-roster-sample")).toHaveTextContent("Every name and shift here is made up");
  });

  it("offers Roster when the reader has no team, and a team picker when they have several", () => {
    setTeams([]);
    renderPage();
    expect(within(screen.getByTestId("on-call-roster-no-team")).getByRole("link")).toHaveAttribute("href", "/roster");
    cleanup();
    setTeams([
      { serviceId: TEAM_A, name: "Inpatient Psychiatry" },
      { serviceId: TEAM_B, name: "Consultation Liaison" },
      { serviceId: "10000000-0000-4000-8000-00000000000c", name: "Switched off", enabled: false },
    ]);
    renderPage();
    const picker = screen.getByLabelText("Team");
    expect(
      within(picker)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Inpatient Psychiatry", "Consultation Liaison"]);
    roster.asked = [];
    fireEvent.change(picker, { target: { value: TEAM_B } });
    expect(roster.asked).toContain(TEAM_B);
  });

  it("links in from the entry link, and out to hospital roles", () => {
    render(<RosterWhosOnEntryLink />);
    expect(screen.getByTestId("on-call-roster-whos-on-entry")).toHaveAttribute("href", "/on-call/whos-on/roster");
    cleanup();
    renderPage();
    expect(screen.getByTestId("on-call-roster-hospital-roles")).toHaveAttribute("href", "/on-call/whos-on");
  });
});
