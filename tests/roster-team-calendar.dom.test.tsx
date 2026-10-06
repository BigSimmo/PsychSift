/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A tiny reactive stand-in for the URL: router.replace updates it and the
// components read it back through useSearchParams, as they do in the app.
const url = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = { search: "", params: new URLSearchParams() };
  return {
    state,
    set(search: string) {
      state.search = search;
      state.params = new URLSearchParams(search);
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    replace: vi.fn(),
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/roster/team",
  useRouter: () => ({ push: vi.fn(), replace: url.replace, back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () =>
    useSyncExternalStore(
      url.subscribe,
      () => url.state.params,
      () => url.state.params,
    ),
}));
vi.mock("@/components/roster/ask/roster-ask-box", () => ({ RosterAskButton: () => null }));

import { canRequestShift } from "@/components/roster/team/calendar/shift-sheet";
import { RosterTeamPage } from "@/components/roster/team/roster-team-page";
import { SHIFT_LETTER_TONE } from "@/lib/roster/shift-kind";
import type { RosterAssignment } from "@/lib/roster/team/model";

const ME = "11111111-1111-4111-8111-111111111111";
const SAM = "22222222-2222-4222-8222-222222222222";
const TEAM = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-10-15T00:00:00Z"); // 08:00 Thursday 15 October, Perth

const mine = {
  id: "44444444-4444-4444-8444-444444444444",
  userId: ME,
  name: "Alex Example",
  grade: "registrar",
  siteId: null,
  siteName: "Example Hospital",
  startsAt: "2026-10-15T09:00:00+08:00",
  endsAt: "2026-10-15T17:00:00+08:00",
  shiftCode: "D",
  kind: "day",
};
const sams = {
  id: "55555555-5555-4555-8555-555555555555",
  userId: SAM,
  name: "Dr Sam Example",
  grade: "registrar",
  siteId: null,
  siteName: "Example Hospital",
  startsAt: "2026-10-15T21:30:00+08:00",
  endsAt: "2026-10-16T08:00:00+08:00",
  shiftCode: "N",
  kind: "night",
};
const overview = {
  service: { id: TEAM, name: "Example team" },
  me: { role: "member", grade: "registrar", rotationEndsOn: null },
  latestPublication: null,
  seenLatest: true,
  settings: { rules: {} },
  sites: [],
};

function mockFetch(assignments: unknown[] | "fail" = [mine, sams]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const address = String(input);
    if (address === "/api/roster/team")
      return Response.json({
        actorId: ME,
        teams: [{ serviceId: TEAM, name: "Example team", enabled: true, role: "member", grade: "registrar" }],
      });
    if (address.includes("what=overview")) return Response.json(overview);
    if (address.includes("what=assignments")) {
      if (assignments === "fail") return Response.json({ message: "Roster couldn't be reached." }, { status: 500 });
      return Response.json({ assignments });
    }
    return Response.json({ swaps: [], openShifts: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  url.replace.mockReset();
  url.replace.mockImplementation((target: string) => act(() => url.set(target.split("?")[1] ?? "")));
  url.set("");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Team calendar", () => {
  it("opens on the Week view with a Month / Week / Day switch", async () => {
    mockFetch();
    render(<RosterTeamPage now={NOW} />);
    const views = await screen.findByRole("radiogroup", { name: "View" });
    const labels = within(views)
      .getAllByRole("radio")
      .map((radio) => radio.textContent);
    expect(labels).toEqual(["Month", "Week", "Day"]);
    expect((within(views).getByRole("radio", { name: "Week" }) as HTMLInputElement).getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("writes the chosen view to the URL without adding history", async () => {
    mockFetch();
    render(<RosterTeamPage now={NOW} />);
    fireEvent.click(await screen.findByRole("radio", { name: "Day" }));
    expect(url.replace).toHaveBeenCalledWith("/roster/team?view=day&date=2026-10-15", { scroll: false });
  });

  it("asks for one window of assignments matching the view", async () => {
    const fetchMock = mockFetch();
    url.set("view=day&date=2026-10-15");
    render(<RosterTeamPage now={NOW} />);
    await screen.findByRole("button", { name: /Dr Sam Example/ });
    const reads = fetchMock.mock.calls.map(([input]) => String(input)).filter((item) => item.includes("assignments"));
    // The "On with you tomorrow" list reads its own small window (Thu 15 to Sat 17 Oct); the calendar reads one.
    const tomorrow = reads.filter((item) => item.includes("from=2026-10-15") && item.includes("to=2026-10-17"));
    expect(tomorrow).toHaveLength(1);
    const calendar = reads.filter((item) => !tomorrow.includes(item));
    expect(calendar).toHaveLength(1);
    expect(calendar[0]).toContain("from=2026-10-14");
    expect(calendar[0]).toContain("to=2026-10-16");
  });

  it("jumps the Day view to a chosen date", async () => {
    mockFetch();
    url.set("view=day&date=2026-10-15");
    render(<RosterTeamPage now={NOW} />);
    fireEvent.change(await screen.findByLabelText("Go to date"), { target: { value: "2026-10-20" } });
    expect(url.replace).toHaveBeenCalledWith("/roster/team?view=day&date=2026-10-20", { scroll: false });
    expect(await screen.findByRole("heading", { name: /20 Oct/ })).toBeTruthy();
  });

  it("steps back beyond a week when the day is far from today", async () => {
    mockFetch();
    url.set("view=day&date=2026-10-01");
    render(<RosterTeamPage now={NOW} />);
    const previous = await screen.findByRole("button", { name: "Previous day" });
    expect((previous as HTMLButtonElement).disabled).toBe(false);
  });

  it("hides other people when Just me is chosen", async () => {
    mockFetch();
    url.set("view=day&date=2026-10-15");
    render(<RosterTeamPage now={NOW} />);
    expect(await screen.findByRole("button", { name: /Dr Sam Example/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Filter/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Just me" }));
    expect(url.replace).toHaveBeenCalledWith("/roster/team?view=day&date=2026-10-15&show=me", { scroll: false });
    expect(screen.queryByRole("button", { name: /Dr Sam Example/ })).toBeNull();
    expect(screen.getByText("You")).toBeTruthy();
  });

  it("shows Try again after a failed read, not an empty calendar", async () => {
    mockFetch("fail");
    url.set("view=day&date=2026-10-15");
    render(<RosterTeamPage now={NOW} />);
    // Both the tomorrow list and the calendar say their read failed, each with its own retry.
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Try again" })).toHaveLength(2));
    expect(screen.getByText(/Couldn't load who's on tomorrow/)).toBeTruthy();
    expect(screen.queryByText("Appears once your manager adds you.")).toBeNull();
  });

  it("opens my own future shift with Swap and Give away", async () => {
    mockFetch();
    url.set("view=day&date=2026-10-15");
    render(<RosterTeamPage now={NOW} />);
    fireEvent.click(await screen.findByRole("button", { name: /You.*09:00–17:00/ }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("button", { name: "Swap" })).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Give away" })).toBeTruthy();
  });

  it("offers no Swap or Give away on someone else's shift", async () => {
    mockFetch();
    url.set("view=day&date=2026-10-15");
    render(<RosterTeamPage now={NOW} />);
    fireEvent.click(await screen.findByRole("button", { name: /Dr Sam Example/ }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText(/21:30–08:00 \+1/)).toBeTruthy();
    expect(within(sheet).queryByRole("button", { name: "Swap" })).toBeNull();
    expect(within(sheet).queryByRole("button", { name: "Give away" })).toBeNull();
  });

  it("offers no Swap or Give away on my own leave", async () => {
    const leave = { ...mine, kind: "leave", shiftCode: "AL" };
    expect(canRequestShift(leave as RosterAssignment, ME, NOW)).toBe(false);
    expect(canRequestShift(mine as RosterAssignment, ME, NOW)).toBe(true);
    mockFetch([leave, sams]);
    render(<RosterTeamPage now={NOW} />);
    fireEvent.click(await screen.findByRole("button", { name: /^You, Leave/ }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).queryByRole("button", { name: "Swap" })).toBeNull();
    expect(within(sheet).queryByRole("button", { name: "Give away" })).toBeNull();
  });

  it("offers no Swap or Give away on my own shift once it has started", async () => {
    mockFetch();
    url.set("view=day&date=2026-10-15");
    render(<RosterTeamPage now={new Date("2026-10-15T03:00:00Z")} />);
    fireEvent.click(await screen.findByRole("button", { name: /You.*09:00–17:00/ }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).queryByRole("button", { name: "Swap" })).toBeNull();
  });

  it("shows the Week view as a board with me first and a sticky names column", async () => {
    mockFetch();
    render(<RosterTeamPage now={NOW} />);
    const board = await screen.findByRole("table", { name: "Week roster" });
    const names = within(board)
      .getAllByRole("rowheader")
      .map((header) => header.textContent);
    expect(names[0]).toMatch(/^You/);
    expect(names[1]).toMatch(/Dr Sam Example/);
    expect(within(board).getAllByRole("rowheader")[0].className).toContain("sticky left-0");
    expect(board.parentElement?.className).toContain("overflow-x-auto");
    // Positioned, so the screen-reader text inside the board (absolutely placed)
    // scrolls with it instead of widening the page on a phone.
    expect(board.parentElement?.className).toMatch(/(^|\s)relative(\s|$)/);
    expect(within(board).getByRole("button", { name: /Dr Sam Example.*Night.*21:30–08:00 \+1/ })).toBeTruthy();
  });

  it("opens the shift sheet from a board cell", async () => {
    mockFetch();
    render(<RosterTeamPage now={NOW} />);
    fireEvent.click(await screen.findByRole("button", { name: /You.*Day.*09:00–17:00/ }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("Compare shows exactly two rows: me and the chosen colleague", async () => {
    const third = {
      ...sams,
      id: "66666666-6666-4666-8666-666666666666",
      userId: "77777777-7777-4777-8777-777777777777",
      name: "Pat Example",
    };
    mockFetch([mine, sams, third]);
    url.set(`show=compare:${SAM}`);
    render(<RosterTeamPage now={NOW} />);
    const board = await screen.findByRole("table", { name: "Week roster" });
    const headers = within(board)
      .getAllByRole("rowheader")
      .map((header) => header.textContent ?? "");
    expect(headers).toHaveLength(2);
    expect(headers[0]).toMatch(/^You/);
    expect(headers[1]).toMatch(/Dr Sam Example/);
  });

  it("Compare still shows the colleague's row when they have no shifts that week", async () => {
    mockFetch([mine]);
    url.set(`show=compare:${SAM}`);
    render(<RosterTeamPage now={NOW} />);
    const board = await screen.findByRole("table", { name: "Week roster" });
    expect(within(board).getAllByRole("rowheader")).toHaveLength(2);
  });

  it("Compare with myself shows one row, not a second 'You'", async () => {
    mockFetch([]);
    url.set(`show=compare:${ME}`);
    render(<RosterTeamPage now={NOW} />);
    const board = await screen.findByRole("table", { name: "Week roster" });
    const headers = within(board).getAllByRole("rowheader");
    expect(headers).toHaveLength(1);
    expect(headers[0].textContent).toMatch(/^You/);
  });

  it("offers With me next to Just me and keeps only colleagues who overlap my shifts", async () => {
    const overlapping = { ...sams, startsAt: "2026-10-15T13:00:00+08:00", endsAt: "2026-10-15T21:00:00+08:00" };
    const apart = {
      ...sams,
      id: "66666666-6666-4666-8666-666666666666",
      userId: "77777777-7777-4777-8777-777777777777",
      name: "Pat Example",
      startsAt: "2026-10-16T09:00:00+08:00",
      endsAt: "2026-10-16T17:00:00+08:00",
    };
    mockFetch([mine, overlapping, apart]);
    url.set("view=day&date=2026-10-15");
    render(<RosterTeamPage now={NOW} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Filter/ }));
    const show = await screen.findByRole("radiogroup", { name: "Show" });
    expect(
      within(show)
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual(["Everyone", "Just me", "With me"]);
    fireEvent.click(within(show).getByRole("radio", { name: "With me" }));
    expect(url.replace).toHaveBeenCalledWith("/roster/team?view=day&date=2026-10-15&show=with-me", { scroll: false });
    expect(await screen.findByRole("button", { name: /Dr Sam Example/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Pat Example/ })).toBeNull();
  });

  it("keeps every filter behind one Filter button that names the active filter", async () => {
    mockFetch();
    render(<RosterTeamPage now={NOW} />);
    const button = await screen.findByRole("button", { name: "Filter: Everyone" });
    expect(screen.queryByRole("radiogroup", { name: "Show" })).toBeNull();
    fireEvent.click(button);
    const sheet = await screen.findByRole("dialog", { name: "Filter" });
    fireEvent.click(within(sheet).getByRole("radio", { name: "Just me" }));
    expect(await screen.findByRole("button", { name: "Filter: Just me" })).toBeTruthy();
  });

  it("filters by grade and by person from the Filter sheet, with no inert Show option chosen", async () => {
    mockFetch();
    render(<RosterTeamPage now={NOW} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Filter/ }));
    const sheet = await screen.findByRole("dialog", { name: "Filter" });
    fireEvent.change(within(sheet).getByLabelText("Grade"), { target: { value: "registrar" } });
    expect(url.replace).toHaveBeenLastCalledWith("/roster/team?date=2026-10-15&show=grade:registrar", {
      scroll: false,
    });
    expect(screen.getByRole("button", { name: "Filter: Registrars" })).toBeTruthy();
    const show = within(sheet).getByRole("radiogroup", { name: "Show" });
    expect(
      within(show)
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual(["Everyone", "Just me", "With me"]);
    expect(within(show).queryByRole("radio", { checked: true })).toBeNull();
    fireEvent.change(within(sheet).getByLabelText("Person"), { target: { value: SAM } });
    expect(url.replace).toHaveBeenLastCalledWith(`/roster/team?date=2026-10-15&show=person:${SAM}`, { scroll: false });
    expect(screen.getByRole("button", { name: "Filter: Dr Sam Example" })).toBeTruthy();
    const board = screen.getByRole("table", { name: "Week roster" });
    expect(
      within(board)
        .getAllByRole("rowheader")
        .map((header) => header.textContent),
    ).toEqual([expect.stringMatching(/Dr Sam Example/)]);
  });

  it("offers Compare with me once a colleague is chosen, and compares the two of us", async () => {
    mockFetch();
    url.set(`show=person:${SAM}`);
    render(<RosterTeamPage now={NOW} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Filter/ }));
    const sheet = await screen.findByRole("dialog", { name: "Filter" });
    const compare = within(sheet).getByRole("button", { name: "Compare with me" });
    expect(compare.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(compare);
    expect(url.replace).toHaveBeenLastCalledWith(`/roster/team?date=2026-10-15&show=compare:${SAM}`, {
      scroll: false,
    });
    expect(within(sheet).getByRole("button", { name: "Compare with me" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Filter: You and Dr Sam Example" })).toBeTruthy();
    const board = screen.getByRole("table", { name: "Week roster" });
    expect(within(board).getAllByRole("rowheader")).toHaveLength(2);
    // Pressed again, it goes back to just the colleague.
    fireEvent.click(within(sheet).getByRole("button", { name: "Compare with me" }));
    expect(url.replace).toHaveBeenLastCalledWith(`/roster/team?date=2026-10-15&show=person:${SAM}`, { scroll: false });
  });

  it("does not offer Compare with me with no one chosen, or with myself chosen", async () => {
    mockFetch();
    render(<RosterTeamPage now={NOW} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Filter/ }));
    const sheet = await screen.findByRole("dialog", { name: "Filter" });
    expect(within(sheet).queryByRole("button", { name: "Compare with me" })).toBeNull();
    fireEvent.change(within(sheet).getByLabelText("Person"), { target: { value: ME } });
    expect(within(sheet).queryByRole("button", { name: "Compare with me" })).toBeNull();
  });

  it("opens the date picker from the period title", async () => {
    mockFetch();
    render(<RosterTeamPage now={NOW} />);
    const heading = await screen.findByRole("heading", { name: /Week of/ });
    const input = screen.getByLabelText("Go to date");
    // The date input lies over the title, so a tap on the title lands on it.
    expect(input.parentElement).toBe(heading.parentElement);
    expect(input.className).toContain("absolute inset-0");
  });

  it("does not mark an expired, unanswered swap as pending", async () => {
    const fetchMock = mockFetch();
    const base = fetchMock.getMockImplementation()!;
    const requested = (expiresAt: string) => ({
      id: "88888888-8888-4888-8888-888888888888",
      status: "requested",
      autoApproved: false,
      needsManagerBecause: null,
      cancelReason: null,
      requesterId: ME,
      counterpartyId: SAM,
      give: mine,
      take: sams,
      expiresAt,
      createdAt: "2026-10-10T00:00:00Z",
      decidedAt: null,
    });
    // My shift is in an expired request; Sam's is in a live one. The live one turning up
    // is the sign that the requests read has been applied.
    fetchMock.mockImplementation(async (input: RequestInfo | URL) =>
      String(input).includes("what=requests")
        ? Response.json({
            openShifts: [],
            swaps: [
              { ...requested("2026-10-14T00:00:00Z"), take: null },
              {
                ...requested("2026-10-20T00:00:00Z"),
                id: "88888888-8888-4888-8888-888888888889",
                give: sams,
                take: null,
              },
            ],
          })
        : base(input),
    );
    render(<RosterTeamPage now={NOW} />);
    const live = await screen.findByRole("button", { name: /Dr Sam Example.*Night/ });
    await vi.waitFor(() => expect(live.getAttribute("data-pending-swap")).toBe("true"));
    const cell = screen.getByRole("button", { name: /You.*Day.*09:00–17:00/ });
    expect(cell.getAttribute("data-pending-swap")).toBeNull();
  });

  it("shows the Open shifts row only when an open shift starts in the week shown", async () => {
    const openShift = (startsAt: string, endsAt: string) => ({
      id: "99999999-9999-4999-8999-999999999999",
      status: "open",
      urgent: false,
      startsAt,
      endsAt,
      shiftCode: "D",
      kind: "day",
      minGrade: null,
      siteId: null,
      mine: false,
      claimedByMe: false,
    });
    const fetchMock = mockFetch();
    const base = fetchMock.getMockImplementation()!;
    let shiftInWeek = false;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) =>
      String(input).includes("what=requests")
        ? Response.json({
            swaps: [
              {
                id: "88888888-8888-4888-8888-888888888888",
                status: "requested",
                autoApproved: false,
                needsManagerBecause: null,
                cancelReason: null,
                requesterId: ME,
                counterpartyId: SAM,
                give: sams,
                take: null,
                expiresAt: "2026-10-20T00:00:00Z",
                createdAt: "2026-10-14T00:00:00Z",
                decidedAt: null,
              },
            ],
            openShifts: [
              shiftInWeek
                ? openShift("2026-10-16T09:00:00+08:00", "2026-10-16T17:00:00+08:00")
                : openShift("2026-10-22T09:00:00+08:00", "2026-10-22T17:00:00+08:00"),
            ],
          })
        : base(input),
    );
    const first = render(<RosterTeamPage now={NOW} />);
    // A live request on Sam's shift turning up shows the requests read has been applied.
    const sam = await screen.findByRole("button", { name: /Dr Sam Example.*Night/ });
    await vi.waitFor(() => expect(sam.getAttribute("data-pending-swap")).toBe("true"));
    expect(screen.queryByRole("rowheader", { name: /Open shifts/ })).toBeNull();
    first.unmount();
    shiftInWeek = true;
    render(<RosterTeamPage now={NOW} />);
    expect(await screen.findByRole("rowheader", { name: /Open shifts/ })).toBeTruthy();
  });

  it("marks the cell of a shift in my own pending swap", async () => {
    const fetchMock = mockFetch();
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("what=requests"))
        return Response.json({
          openShifts: [],
          swaps: [
            {
              id: "88888888-8888-4888-8888-888888888888",
              status: "requested",
              autoApproved: false,
              needsManagerBecause: null,
              cancelReason: null,
              requesterId: ME,
              counterpartyId: SAM,
              give: mine,
              take: sams,
              expiresAt: "2026-10-20T00:00:00Z",
              createdAt: "2026-10-14T00:00:00Z",
              decidedAt: null,
            },
          ],
        });
      return base(input);
    });
    render(<RosterTeamPage now={NOW} />);
    const cell = await screen.findByRole("button", { name: /You.*Day.*09:00–17:00/ });
    await vi.waitFor(() => expect(cell.getAttribute("data-pending-swap")).toBe("true"));
    expect(screen.getByRole("button", { name: /Dr Sam Example.*Night/ }).getAttribute("data-pending-swap")).toBe(
      "true",
    );
  });

  it("shows open shifts in an amber row labelled Open shift", async () => {
    const fetchMock = mockFetch();
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("what=requests"))
        return Response.json({
          swaps: [],
          openShifts: [
            {
              id: "99999999-9999-4999-8999-999999999999",
              status: "open",
              urgent: false,
              startsAt: "2026-10-16T09:00:00+08:00",
              endsAt: "2026-10-16T17:00:00+08:00",
              shiftCode: "D",
              kind: "day",
              minGrade: null,
              siteId: null,
              mine: false,
              claimedByMe: false,
            },
          ],
        });
      return base(input);
    });
    render(<RosterTeamPage now={NOW} />);
    const cell = await screen.findByText("Open shift");
    expect(cell.closest("[data-open-shift]")?.className).toContain("--warning");
    expect(screen.getByRole("rowheader", { name: /Open shifts/ })).toBeTruthy();
  });

  describe("Month view", () => {
    const shift = (
      id: string,
      userId: string,
      name: string,
      kind: string,
      code: string,
      start: string,
      end: string,
    ) => ({
      ...mine,
      id,
      userId,
      name,
      kind,
      shiftCode: code,
      startsAt: start,
      endsAt: end,
    });
    const busyDay = [
      mine,
      shift(
        "66666666-6666-4666-8666-666666666666",
        SAM,
        "Dr Sam Example",
        "evening",
        "E",
        "2026-10-15T13:00:00+08:00",
        "2026-10-15T21:00:00+08:00",
      ),
      shift(
        "77777777-7777-4777-8777-777777777777",
        "88888888-8888-4888-8888-888888888888",
        "Dr Pat Example",
        "evening",
        "E",
        "2026-10-15T14:00:00+08:00",
        "2026-10-15T22:00:00+08:00",
      ),
      sams,
    ];
    const cellFor = (container: HTMLElement, date: string) =>
      container.querySelector<HTMLElement>(`[data-date="${date}"]`)!;

    it("shows three shift letters and +1 for a day with four shifts", async () => {
      mockFetch(busyDay);
      url.set("view=month&date=2026-10-15");
      const { container } = render(<RosterTeamPage now={NOW} />);
      await screen.findByRole("grid");
      const cell = cellFor(container, "2026-10-15");
      const letters = [...cell.querySelectorAll("[data-shift-letter]")].map((node) => node.textContent);
      expect(letters).toEqual(["D", "E", "E"]);
      expect(within(cell).getByText("+1")).toBeTruthy();
    });

    it("at lg and in print shows every shift grouped by kind, not three letters and +n", async () => {
      mockFetch(busyDay);
      url.set("view=month&date=2026-10-15");
      const { container } = render(<RosterTeamPage now={NOW} />);
      await screen.findByRole("grid");
      const cell = cellFor(container, "2026-10-15");
      const summary = cell.querySelector<HTMLElement>("[data-month-summary]")!;
      const full = cell.querySelector<HTMLElement>("[data-month-full]")!;
      // The phone summary gives way at lg and in print; the full list is print-specific, not left to lg.
      expect(summary.className).toMatch(/lg:hidden/);
      expect(summary.className).toMatch(/print:hidden/);
      expect(full.className).toMatch(/(^|\s)hidden(\s|$)/);
      expect(full.className).toMatch(/lg:grid/);
      expect(full.className).toMatch(/print:grid/);
      const groups = [...full.querySelectorAll<HTMLElement>("[data-kind-group]")].map((group) => group.textContent);
      expect(groups).toEqual(["DYou", "EDr Sam Example, Dr Pat Example", "NDr Sam Example"]);
    });

    it("prints the team name, the Perth date it was printed and a shift-letter legend", async () => {
      mockFetch(busyDay);
      url.set("view=month&date=2026-10-15");
      const { container } = render(<RosterTeamPage now={NOW} />);
      await screen.findByRole("grid");
      const header = container.querySelector<HTMLElement>("[data-roster-print-header]")!;
      expect(header.className).toMatch(/(^|\s)hidden(\s|$)/);
      expect(header.className).toMatch(/print:grid/);
      expect(within(header).getByText("Example team")).toBeTruthy();
      expect(within(header).getByText("Printed Thu 15 Oct 2026")).toBeTruthy();
      expect(within(header).getByText("D Day · E Evening · N Night · C On call · L Leave · W Other work")).toBeTruthy();
    });

    it("prints no header on the Week view, which has no Print button", async () => {
      mockFetch();
      const { container } = render(<RosterTeamPage now={NOW} />);
      await screen.findByRole("table", { name: "Week roster" });
      expect(container.querySelector("[data-roster-print-header]")).toBeNull();
    });

    it("marks the cell of my own shift and no other", async () => {
      mockFetch(busyDay);
      url.set("view=month&date=2026-10-15");
      const { container } = render(<RosterTeamPage now={NOW} />);
      await screen.findByRole("grid");
      expect(cellFor(container, "2026-10-15").getAttribute("data-mine")).toBe("true");
      expect(cellFor(container, "2026-10-16").getAttribute("data-mine")).not.toBe("true");
    });

    it("gives a public holiday the words for screen readers", async () => {
      mockFetch([]);
      url.set("view=month&date=2026-09-28");
      const { container } = render(<RosterTeamPage now={NOW} />);
      await screen.findByRole("grid");
      expect(within(cellFor(container, "2026-09-28")).getByText("Public holiday")).toBeTruthy();
      expect(within(cellFor(container, "2026-09-29")).queryByText("Public holiday")).toBeNull();
    });

    it("lays out a grid with Monday-first column headers", async () => {
      mockFetch([]);
      url.set("view=month&date=2026-10-15");
      render(<RosterTeamPage now={NOW} />);
      const grid = await screen.findByRole("grid");
      const headers = within(grid)
        .getAllByRole("columnheader")
        .map((header) => header.textContent);
      expect(headers).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
      expect(within(grid).getAllByRole("rowheader").length).toBeGreaterThan(3);
    });

    it("colours each shift letter by its kind and outlines my own cell", async () => {
      mockFetch(busyDay);
      url.set("view=month&date=2026-10-15");
      const { container } = render(<RosterTeamPage now={NOW} />);
      await screen.findByRole("grid");
      const cell = cellFor(container, "2026-10-15");
      const [day, evening] = [...cell.querySelectorAll("[data-shift-letter]")];
      expect(day.classList.contains(SHIFT_LETTER_TONE.day)).toBe(true);
      expect(evening.classList.contains(SHIFT_LETTER_TONE.evening)).toBe(true);
      expect(SHIFT_LETTER_TONE.day).not.toBe(SHIFT_LETTER_TONE.evening);
      expect(cell.classList.contains("ring-2")).toBe(true);
      expect(cellFor(container, "2026-10-16").classList.contains("ring-2")).toBe(false);
    });

    it("offers Swap and Give away in the day sheet on my future shift only", async () => {
      mockFetch(busyDay);
      url.set("view=month&date=2026-10-15");
      const { container } = render(<RosterTeamPage now={NOW} />);
      await screen.findByRole("grid");
      fireEvent.click(within(cellFor(container, "2026-10-15")).getByRole("button"));
      const sheet = await screen.findByRole("dialog");
      expect(within(sheet).getAllByRole("button", { name: "Swap" })).toHaveLength(1);
      expect(within(sheet).getAllByRole("button", { name: "Give away" })).toHaveLength(1);
      const mineRow = within(sheet).getByRole("button", { name: /You/ }).closest("li")!;
      expect(within(mineRow).getByRole("button", { name: "Swap" })).toBeTruthy();
    });

    it("offers no Swap or Give away in the day sheet once my shift has started", async () => {
      mockFetch(busyDay);
      url.set("view=month&date=2026-10-15");
      const { container } = render(<RosterTeamPage now={new Date("2026-10-15T03:00:00Z")} />);
      await screen.findByRole("grid");
      fireEvent.click(within(cellFor(container, "2026-10-15")).getByRole("button"));
      const sheet = await screen.findByRole("dialog");
      expect(within(sheet).queryByRole("button", { name: "Swap" })).toBeNull();
      expect(within(sheet).queryByRole("button", { name: "Give away" })).toBeNull();
    });

    it("says nothing to show, not nobody, on an empty day while a filter is on", async () => {
      mockFetch([sams]);
      url.set("view=month&date=2026-10-15&show=me");
      const { container } = render(<RosterTeamPage now={NOW} />);
      await screen.findByRole("grid");
      fireEvent.click(within(cellFor(container, "2026-10-15")).getByRole("button"));
      const sheet = await screen.findByRole("dialog");
      expect(within(sheet).getByText("No shifts to show on this day.")).toBeTruthy();
    });

    it("opens a day sheet listing names by grade, then the shift", async () => {
      mockFetch(busyDay);
      url.set("view=month&date=2026-10-15");
      const { container } = render(<RosterTeamPage now={NOW} />);
      await screen.findByRole("grid");
      fireEvent.click(within(cellFor(container, "2026-10-15")).getByRole("button"));
      const sheet = await screen.findByRole("dialog");
      expect(within(sheet).getByText("Registrars")).toBeTruthy();
      expect(within(sheet).getByText("Dr Pat Example")).toBeTruthy();
      expect(within(sheet).getByText("You")).toBeTruthy();
      fireEvent.click(within(sheet).getByRole("button", { name: /Dr Sam Example.*Night/ }));
      const shiftSheet = await screen.findByRole("dialog");
      expect(within(shiftSheet).getByText(/21:30–08:00 \+1/)).toBeTruthy();
    });
  });

  it("writes nothing to the device", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    mockFetch();
    render(<RosterTeamPage now={NOW} />);
    fireEvent.click(await screen.findByRole("radio", { name: "Day" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Filter/ }));
    fireEvent.click(await screen.findByRole("radio", { name: "Just me" }));
    expect(setItem).not.toHaveBeenCalled();
  });
});
