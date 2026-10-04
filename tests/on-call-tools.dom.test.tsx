import { act, cleanup, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OnCallEntry } from "@/lib/on-call/entry-model";

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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => "/on-call/now",
  useSearchParams: () => new URLSearchParams(),
}));

import { OnCallCallNowPage } from "@/components/on-call/on-call-call-now-page";
import { OnCallCheckPage } from "@/components/on-call/on-call-check-page";
import { OnCallCalendarPage } from "@/components/on-call/on-call-calendar-page";
import { OnCallFirstNightPage } from "@/components/on-call/on-call-first-night-page";

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

describe("who to call now", () => {
  it("does not present the historical anchor as the current working-hours period on the server", () => {
    state.entries = [LADDER];
    const markup = renderToString(<OnCallCallNowPage />);
    expect(markup).toContain("Loading current on-call context");
    expect(markup).not.toContain("Working hours: working-hours steps are listed first.");
    expect(markup).not.toContain("tel:0890000001");
    expect(markup).toContain('href="tel:000"');
    expect(markup).toContain('href="tel:1300555788"');
  });

  it("keeps the public crisis lines on screen while the playbook is still loading", () => {
    state.loading = true;
    state.entries = [];
    render(<OnCallCallNowPage />);
    const crisis = screen.getByTestId("on-call-crisis-lines");
    expect(screen.getByTestId("on-call-now-loading")).toBeInTheDocument();
    expect(within(crisis).getByRole("link", { name: /^call emergency services/i })).toHaveAttribute("href", "tel:000");
    expect(within(crisis).getByRole("link", { name: /mherl/i })).toHaveAttribute("href", "tel:1300555788");
  });

  it("puts the after-hours steps first at night, with a call button, and keeps the rest below", () => {
    state.entries = [LADDER];
    render(<OnCallCallNowPage now={new Date(2026, 8, 22, 23, 0)} />);
    expect(screen.getByTestId("on-call-now-period")).toHaveTextContent("After hours");
    const now = screen.getByTestId("on-call-now-steps");
    expect(
      within(now)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([expect.stringContaining("Nurse in charge"), expect.stringContaining("Consultant on call")]);
    expect(within(now).getByRole("link", { name: /Call 08 9000 0002/ })).toHaveAttribute("href", "tel:0890000002");
    expect(screen.getByTestId("on-call-now-other-steps")).toHaveTextContent("Day consultant");
  });

  it("finds a scenario by search", async () => {
    const user = userEvent.setup();
    state.entries = [LADDER, { ...LADDER, id: "fire", slug: "fire", title: "Fire alarm", sortOrder: 1 }];
    render(<OnCallCallNowPage now={new Date(2026, 8, 22, 10, 0)} />);
    await user.type(screen.getByLabelText("What is happening?"), "fire");
    expect(screen.getByTestId("on-call-now-ladder")).toHaveTextContent("Fire alarm");
  });

  it("points to the Playbook when there are no scenarios", () => {
    render(<OnCallCallNowPage now={new Date(2026, 8, 22, 10, 0)} />);
    expect(screen.getByTestId("on-call-now-empty")).toBeInTheDocument();
  });
});

describe("check these", () => {
  it("updates the review queue when left open overnight", () => {
    vi.useFakeTimers();
    try {
      const justBeforeMidnight = new Date(2026, 8, 26, 23, 59);
      const due = new Date(new Date(2026, 8, 27).getTime() + 30 * 86_400_000);
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
    render(<OnCallCalendarPage now={new Date(2026, 8, 30, 9, 0)} />);
    const day = screen.getByTestId("on-call-calendar-view-day");
    expect(day).toHaveTextContent("Registrar teaching");
    expect(day).toHaveTextContent("12:30 pm");
    expect(day).toHaveTextContent("Every week");
  });

  it("is titled for what it holds and points to where the shifts are", () => {
    state.entries = [];
    render(<OnCallCalendarPage now={new Date(2026, 8, 30, 9, 0)} />);
    expect(screen.getByRole("heading", { level: 1, name: "Teaching and expiry dates" })).toBeInTheDocument();
    expect(screen.getByTestId("on-call-calendar-shifts-link")).toHaveAttribute("href", "/roster/shifts");
  });

  it("moves today at midnight on a page nobody is touching", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 8, 30, 23, 58));
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
