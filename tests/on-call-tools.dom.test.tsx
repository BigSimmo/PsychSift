import { act, cleanup, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HospitalHandbookState } from "@/components/on-call/use-hospital-handbook";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { readOnCallYouCalled, rememberOnCallYouCalled } from "@/lib/on-call/call-marks";
import { onCallLadderStepMarkId } from "@/lib/on-call/now-rows";
import { handbookItems, readyHandbook } from "./helpers/on-call-handbook-fixtures";

const state = {
  entries: [] as OnCallEntry[],
  loading: false,
  isOffline: false,
  loadError: null,
  retry: vi.fn(),
  cachedAt: null,
  signedOut: false,
  demoMode: false,
};
const cacheOnCallEntries = vi.fn();

vi.mock("@/lib/on-call/entry-store", () => ({
  useOnCallEntries: () => state,
  cacheOnCallEntries: (entries: OnCallEntry[]) => cacheOnCallEntries(entries),
}));
const hospital = vi.hoisted(() => ({ state: null as unknown as HospitalHandbookState }));
vi.mock("@/components/on-call/use-hospital-handbook", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/on-call/use-hospital-handbook")>()),
  useHospitalHandbook: () => hospital.state,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => "/on-call/now",
  useSearchParams: () => new URLSearchParams(),
}));

import { OnCallCallNowPage } from "@/components/on-call/on-call-call-now-page";
import { OnCallCheckPage } from "@/components/on-call/on-call-check-page";
import { OnCallCalendarPage } from "@/components/on-call/on-call-calendar-page";
import { OnCallFirstNightPage } from "@/components/on-call/on-call-first-night-page";
import { onCallLadderAnsweredMarkId } from "@/components/on-call/now/needs-you";

/**
 * A Perth wall-clock instant, with the same arguments as `new Date(y, m, d, h)`
 * (month from 0). Working hours and "today" are read in the work time zone
 * (Perth by default), never the device's, so these tests no longer depend on
 * the zone the test runner happens to be in.
 */
const perthWall = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0) =>
  new Date(Date.UTC(year, month, day, hour - 8, minute, second));

const AFTER_HOURS = new Date("2026-09-26T14:00:00.000Z"); // Saturday 22:00 Perth
const HOSPITAL_LADDER_ID = "40000000-0000-4000-8000-000000000001";
const EMERGENCY_ID = "40000000-0000-4000-8000-000000000002";
const HOSPITAL_LADDER = handbookItems([
  { id: HOSPITAL_LADDER_ID, title: "Deteriorating patient", section: "playbook", kind: "clinical" },
]).map((item) => ({
  ...item,
  steps: [
    { order: 1, whoToCall: "Registrar on call", when: "First", phone: "08 9000 0001", waitMinutes: 10 },
    { order: 2, whoToCall: "Consultant on call", when: "No answer from step 1, or any time", phone: "08 9000 0002" },
    { order: 3, whoToCall: "Nurse in charge", when: "Any time" },
  ],
}));
const EMERGENCY = handbookItems([
  { id: EMERGENCY_ID, title: "Emergency: Synthetic medical emergency team", phone: "08 9000 0055", kind: "clinical" },
]);

function entry(overrides: Partial<OnCallEntry> & Pick<OnCallEntry, "id" | "section">): OnCallEntry {
  return {
    slug: overrides.id,
    title: `Entry ${overrides.id}`,
    subtitle: null,
    body: null,
    details: {},
    linkedDocumentIds: [],
    tags: [],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 0,
    lastVerifiedAt: null,
    ...overrides,
  };
}

const LADDER = entry({
  id: "agitation",
  section: "playbook",
  title: "Agitated patient on the ward",
  details: {
    trigger: "Agitation",
    escalationSteps: [
      { order: 1, whoToCall: "Nurse in charge", when: "First" },
      { order: 2, whoToCall: "Day consultant", when: "Weekdays", phone: "08 9000 0001", hours: "in-hours" },
      { order: 3, whoToCall: "Consultant on call", when: "Nights", phone: "08 9000 0002", hours: "after-hours" },
    ],
  },
});

beforeEach(() => {
  window.localStorage.clear();
  hospital.state = readyHandbook([], { status: "no-service" });
  state.entries = [];
  state.loading = false;
  state.isOffline = false;
  state.loadError = null;
  state.signedOut = false;
  state.demoMode = false;
  cacheOnCallEntries.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("who to call now (Escalate)", () => {
  it("does not present the historical anchor as the current working-hours period on the server", () => {
    state.entries = [LADDER];
    const markup = renderToString(<OnCallCallNowPage />);
    expect(markup).toContain("Loading current on-call context");
    expect(markup).not.toContain("Working hours ladder");
    expect(markup).not.toContain("tel:0890000001");
    expect(markup).toContain('href="tel:000"');
    expect(markup).toContain('href="tel:1300555788"');
  });

  it("keeps the public crisis lines on screen while the playbook is still loading", () => {
    state.loading = true;
    state.entries = [];
    hospital.state = readyHandbook([], { status: "loading" });
    render(<OnCallCallNowPage />);
    const crisis = screen.getByTestId("on-call-crisis-lines");
    expect(screen.getByTestId("on-call-now-loading")).toBeInTheDocument();
    expect(within(crisis).getByRole("link", { name: /^call emergency services/i })).toHaveAttribute("href", "tel:000");
    expect(within(crisis).getByRole("link", { name: /mherl/i })).toHaveAttribute("href", "tel:1300555788");
  });

  it("puts the after-hours steps first at night, with a call button, and keeps the rest below", () => {
    state.entries = [LADDER];
    render(<OnCallCallNowPage now={perthWall(2026, 8, 22, 23, 0)} />);
    expect(screen.getByTestId("on-call-now-period")).toHaveTextContent("After hours");
    const now = screen.getByTestId("on-call-now-steps");
    expect(
      within(now)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([expect.stringContaining("Nurse in charge"), expect.stringContaining("Consultant on call")]);
    expect(within(now).getByRole("link", { name: /^Call Consultant on call,/ })).toHaveAttribute(
      "href",
      "tel:0890000002",
    );
    expect(screen.getByTestId("on-call-now-other-steps")).toHaveTextContent("Day consultant");
  });

  it("switches the ladder with the situation chips", async () => {
    const user = userEvent.setup();
    state.entries = [LADDER, { ...LADDER, id: "fire", slug: "fire", title: "Fire alarm", sortOrder: 1 }];
    render(<OnCallCallNowPage now={perthWall(2026, 8, 22, 10, 0)} />);
    const chips = screen.getByTestId("on-call-now-scenarios");
    expect(within(chips).getByRole("button", { name: "Agitated patient on the ward" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(within(chips).getByRole("button", { name: "Fire alarm" }));
    expect(screen.getByTestId("on-call-now-ladder")).toHaveTextContent("Fire alarm");
    expect(within(chips).getByRole("button", { name: "Fire alarm" })).toHaveAttribute("aria-pressed", "true");
  });

  it("opens the situation Now linked to, and falls back quietly when the link matches nothing", () => {
    state.entries = [LADDER, { ...LADDER, id: "fire", slug: "fire", title: "Fire alarm", sortOrder: 1 }];
    window.history.replaceState(null, "", "/on-call/now?situation=fire");
    render(<OnCallCallNowPage now={perthWall(2026, 8, 22, 10, 0)} />);
    expect(screen.getByRole("button", { name: "Fire alarm" })).toHaveAttribute("aria-pressed", "true");
    cleanup();
    window.history.replaceState(null, "", "/on-call/now?situation=nothing-here");
    render(<OnCallCallNowPage now={perthWall(2026, 8, 22, 10, 0)} />);
    expect(screen.getByRole("button", { name: "Agitated patient on the ward" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    window.history.replaceState(null, "", "/on-call/now");
  });

  it("points to the Playbook when there are no scenarios", () => {
    render(<OnCallCallNowPage now={perthWall(2026, 8, 22, 10, 0)} />);
    expect(screen.getByTestId("on-call-now-empty")).toBeInTheDocument();
  });

  it("runs the hospital ladder from the call marks, with the hospital-set wait and the emergency rung", async () => {
    const user = userEvent.setup();
    hospital.state = readyHandbook([...HOSPITAL_LADDER, ...EMERGENCY]);
    rememberOnCallYouCalled(
      onCallLadderStepMarkId(HOSPITAL_LADDER_ID, 1),
      new Date(AFTER_HOURS.getTime() - 3 * 60_000),
    );
    render(<OnCallCallNowPage now={AFTER_HOURS} />);

    expect(screen.getByRole("button", { name: "Deteriorating patient" })).toHaveAttribute("aria-pressed", "true");
    const run = screen.getByTestId("on-call-now-ladder-run");
    expect(run).toHaveTextContent("Started 21:57");
    expect(run).toHaveTextContent("Step 1: Registrar on call called");
    expect(run).toHaveTextContent("Next step suggested at 22:07");
    expect(within(run).getByTestId("on-call-now-ring")).toHaveTextContent("7min left");
    expect(run).toHaveTextContent("You can call any step, or the emergency team, at any time.");
    expect(screen.getByTestId("on-call-now-wait")).toHaveTextContent("Hospital-set wait7 min left");
    expect(screen.getByTestId("on-call-now-step-called")).toHaveTextContent("called 21:57");

    // The emergency rung keeps its quiet red dot and red disc, and writes no criteria of its own.
    const emergency = screen.getByTestId(`on-call-now-emergency-${EMERGENCY_ID}`);
    expect(within(emergency).getByTestId(`on-call-now-emergency-${EMERGENCY_ID}-dot`)).toBeInTheDocument();
    expect(within(emergency).getByRole("link", { name: /emergency/ })).toHaveAttribute("href", "tel:0890000055");
    expect(emergency).toHaveTextContent("Calling criteria: the hospital's existing guidance, shown unchanged");
    // The hospital's emergency route is on screen, so the public lines step back.
    expect(screen.queryByTestId("on-call-crisis-lines")).toBeNull();
    // The WA consultant-call headings are not captured yet, so no link points at an empty card.
    expect(screen.queryByTestId("on-call-now-consultant-link")).toBeNull();
    expect(screen.getByTestId("on-call-now-source")).toHaveTextContent("Ladder from Synthetic Hospital's handbook");
    expect(screen.queryByText(/families can escalate/i)).toBeNull();
    expect(screen.queryByText(/log this for handover/i)).toBeNull();

    // "They answered" leaves Now's own mark, so Now's Escalating card closes too.
    await user.click(within(run).getByRole("button", { name: "They answered" }));
    expect(screen.queryByTestId("on-call-now-ladder-run")).toBeNull();
    expect(readOnCallYouCalled(AFTER_HOURS).map((mark) => mark.entryId)).toContain(
      onCallLadderAnsweredMarkId(HOSPITAL_LADDER_ID),
    );
  });

  it("never suggests a next-step time when the hospital recorded no wait", () => {
    hospital.state = readyHandbook([...HOSPITAL_LADDER, ...EMERGENCY]);
    rememberOnCallYouCalled(
      onCallLadderStepMarkId(HOSPITAL_LADDER_ID, 2),
      new Date(AFTER_HOURS.getTime() - 4 * 60_000),
    );
    render(<OnCallCallNowPage now={AFTER_HOURS} />);
    const run = screen.getByTestId("on-call-now-ladder-run");
    expect(run).toHaveTextContent("Step 2: Consultant on call called");
    expect(within(run).queryByTestId("on-call-now-next-at")).toBeNull();
    expect(within(run).getByTestId("on-call-now-ring")).toHaveTextContent("4min ago");
    expect(screen.queryByTestId("on-call-now-wait")).toBeNull();
  });

  it("marks a rung with no number as done, and keeps the crisis lines when no emergency route is set up", async () => {
    const user = userEvent.setup();
    hospital.state = readyHandbook(HOSPITAL_LADDER);
    render(<OnCallCallNowPage now={AFTER_HOURS} />);
    expect(screen.getByTestId("on-call-now-emergency-not-set-up")).toHaveTextContent(
      "Emergency number not set up for this hospital",
    );
    expect(screen.getByTestId("on-call-crisis-lines")).toBeInTheDocument();
    expect(screen.queryByTestId("on-call-now-ladder-run")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Mark Nurse in charge as done now" }));
    expect(readOnCallYouCalled(new Date()).map((mark) => mark.entryId)).toContain(
      onCallLadderStepMarkId(HOSPITAL_LADDER_ID, 3),
    );
  });
});

describe("check these", () => {
  it("updates the review queue when left open overnight", () => {
    vi.useFakeTimers();
    try {
      const justBeforeMidnight = perthWall(2026, 8, 26, 23, 59);
      const due = new Date(perthWall(2026, 8, 27).getTime() + 30 * 86_400_000);
      due.setUTCFullYear(due.getUTCFullYear() - 1);
      vi.setSystemTime(justBeforeMidnight);
      state.entries = [entry({ id: "due", section: "contacts", lastVerifiedAt: due.toISOString() })];
      render(<OnCallCheckPage />);
      expect(screen.getByTestId("on-call-check-empty")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(2 * 60 * 1000));
      expect(screen.getByTestId("on-call-check-group-soon")).toHaveTextContent("Entry due");
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it("confirms an entry and writes the updated entry to the saved copy", async () => {
    const user = userEvent.setup();
    const never = entry({ id: "switch", section: "contacts", title: "Switchboard", details: { role: "Switch" } });
    state.entries = [never];
    const updated = { ...never, lastVerifiedAt: "2026-09-25T02:00:00Z" };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ entry: updated }), { status: 200 }));
    render(<OnCallCheckPage now={new Date("2026-09-25T02:00:00Z")} />);
    expect(screen.getByTestId("on-call-check-group-never")).toHaveTextContent("Switchboard");
    await user.click(screen.getByTestId("on-call-check-confirm-switch"));
    expect(fetchMock).toHaveBeenCalledWith("/api/on-call/entries/switch/verify", { method: "POST" });
    expect(cacheOnCallEntries).toHaveBeenCalledWith([updated]);
  });

  it("says so when nothing needs checking", () => {
    state.entries = [entry({ id: "ok", section: "contacts", lastVerifiedAt: "2026-06-01T00:00:00Z" })];
    render(<OnCallCheckPage now={new Date("2026-09-25T02:00:00Z")} />);
    expect(screen.getByTestId("on-call-check-empty")).toHaveTextContent("Your one entry was checked");
  });

  it("never says entries were checked when there are none", () => {
    state.entries = [];
    render(<OnCallCheckPage now={new Date("2026-09-25T02:00:00Z")} />);
    expect(screen.getByTestId("on-call-check-no-entries")).toHaveTextContent("No entries yet");
    expect(screen.queryByTestId("on-call-check-empty")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/checked in the last/i);
  });

  it("asks a signed-out reader to sign in rather than reporting checks", () => {
    state.entries = [];
    state.signedOut = true;
    try {
      render(<OnCallCheckPage now={new Date("2026-09-25T02:00:00Z")} />);
      expect(screen.getByTestId("on-call-check-no-entries")).toHaveTextContent("Sign in to see your checks");
    } finally {
      state.signedOut = false;
    }
  });

  it("does not claim a check when no entry is the reader's to confirm", () => {
    state.entries = [entry({ id: "shared", section: "contacts", isOwn: false })];
    render(<OnCallCheckPage now={new Date("2026-09-25T02:00:00Z")} />);
    expect(screen.getByTestId("on-call-check-none-assessed")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/checked in the last/i);
  });
});

describe("first night", () => {
  it("shows the three stages and the service's own induction manuals", () => {
    state.entries = [
      entry({
        id: "induct",
        section: "orientation",
        title: "Hospital induction",
        details: { pinnedSummaryIsOwnerNote: true, category: "Induction", checklist: [{ text: "Collect pager" }] },
      }),
    ];
    render(<OnCallFirstNightPage />);
    expect(screen.getByTestId("on-call-first-night-before")).toHaveTextContent("Hospital induction");
    expect(screen.getByTestId("on-call-first-night-before")).toHaveTextContent("Collect pager");
    expect(screen.getByTestId("on-call-first-night-night")).toHaveTextContent("Your first night");
    expect(screen.getByTestId("on-call-first-night-wrong")).toHaveTextContent("If something goes wrong");
  });
});

describe("On Call calendar", () => {
  it("shows a repeating teaching session in this month", () => {
    state.entries = [
      entry({
        id: "teach",
        section: "education",
        title: "Registrar teaching",
        details: { nextOccurrence: "12:30", nextOccurrenceDate: "2026-09-02", recurrenceRule: { frequency: "weekly" } },
      }),
    ];
    render(<OnCallCalendarPage now={perthWall(2026, 8, 30, 9, 0)} />);
    const day = screen.getByTestId("on-call-calendar-view-day");
    expect(day).toHaveTextContent("Registrar teaching");
    expect(day).toHaveTextContent("12:30");
    expect(day).toHaveTextContent("Every week");
  });

  it("is titled for what it holds and points to where the shifts are", () => {
    state.entries = [];
    render(<OnCallCalendarPage now={perthWall(2026, 8, 30, 9, 0)} />);
    expect(screen.getByRole("heading", { level: 1, name: "Teaching and expiry dates" })).toBeInTheDocument();
    expect(screen.getByTestId("on-call-calendar-shifts-link")).toHaveAttribute("href", "/roster/shifts");
  });

  it("moves today at midnight on a page nobody is touching", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(perthWall(2026, 8, 30, 23, 58));
      state.entries = [];
      render(<OnCallCalendarPage />);
      expect(screen.getByTestId("on-call-calendar-view-day")).toHaveTextContent("Wednesday 30 September · Today");
      act(() => {
        vi.advanceTimersByTime(3 * 60 * 1000);
      });
      expect(screen.getByTestId("on-call-calendar-view-day")).toHaveTextContent("Thursday 1 October · Today");
    } finally {
      vi.useRealTimers();
    }
  });
});
