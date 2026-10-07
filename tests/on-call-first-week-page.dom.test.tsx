/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HospitalHandbookState } from "@/components/on-call/use-hospital-handbook";
import { ToastProvider } from "@/components/ui/toast";
import {
  ON_CALL_FIRST_WEEK_READ_STORAGE_KEY,
  clearAccountScopedBrowserStorage,
} from "@/lib/account-scoped-browser-state";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { onCallEntryFixture } from "./helpers/on-call-entry-fixture";
import { handbookItems, readyHandbook, SITE } from "./helpers/on-call-handbook-fixtures";

vi.mock("next/navigation", () => ({
  usePathname: () => "/on-call/first-week",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({ isAuthenticated: true, isSaved: () => false, setFavourite: vi.fn(async () => true) }),
}));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => ({ status: "authenticated", authEpoch: 1 }) }));
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({ AccountSetupDialog: () => null }));

const handbook = vi.hoisted(() => ({ state: null as unknown as HospitalHandbookState }));
vi.mock("@/components/on-call/use-hospital-handbook", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/on-call/use-hospital-handbook")>()),
  useHospitalHandbook: () => handbook.state,
}));

const entryState = vi.hoisted(() => ({
  entries: [] as OnCallEntry[],
  loading: false,
  isOffline: false,
  loadError: null as "offline" | "failed" | null,
  signedOut: false,
  demoMode: false,
  cachedAt: null as string | null,
  retry: vi.fn(),
}));
vi.mock("@/lib/on-call/entry-store", () => ({
  useOnCallEntries: () => entryState,
  cacheOnCallEntries: vi.fn(),
}));

const download = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin/download-file", () => ({ downloadTextFile: download }));

const clipboard = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/copy-to-clipboard", () => ({ copyTextToClipboard: clipboard }));

const rosterTeams = vi.hoisted(() => ({
  state: { status: "ready", data: { teams: [] }, message: null, readAt: null, reload: () => undefined } as {
    status: string;
    data: { teams: { serviceId: string; name: string; enabled: boolean }[] } | null;
    message: string | null;
    readAt: Date | null;
    reload: () => void;
  },
}));
vi.mock("@/components/roster/use-roster-team", () => ({ useRosterTeams: () => rosterTeams.state }));

const { OnCallFirstWeekPage } = await import("@/components/on-call/first-week/first-week-page");
const { FirstWeekTodayCard } = await import("@/components/on-call/first-week/first-week-today-card");
const { firstWeekPhase } = await import("@/lib/on-call/first-week-pack");

// 09:00 Perth, Mon 26 Oct 2026.
const NOW = new Date("2026-10-26T01:00:00Z");

function login(title: string, details: Record<string, unknown>, isOwn = true): OnCallEntry {
  return onCallEntryFixture({
    section: "logistics",
    title,
    details: { category: "Logins", ...details },
    isOwn,
    isPersonal: false,
  });
}

const ITEMS = handbookItems([
  {
    id: "b1",
    title: "Collect your badge",
    section: "orientation",
    phase: "before_start",
    body: "From security, level 1.",
  },
  { id: "f1", title: "Find the handover room", section: "orientation", phase: "first_shift" },
  { id: "w1", title: "Ward round", section: "orientation", phase: "first_week", body: "Tuesday and Friday mornings." },
  { id: "c1", title: "Psychiatry: Nurse in charge", phone: "9000 0040" },
  { id: "e1", title: "Emergency: Synthetic code", kind: "clinical", phone: "55" },
]);

function renderPage(section?: string) {
  return render(
    <ToastProvider>
      <OnCallFirstWeekPage now={NOW} section={section} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  download.mockClear();
  clipboard.mockClear();
  rosterTeams.state = { status: "ready", data: { teams: [] }, message: null, readAt: null, reload: () => undefined };
  handbook.state = readyHandbook(ITEMS);
  Object.assign(entryState, {
    entries: [
      login("Hospital email", { done: true, jobStartsOn: "2026-11-02" }),
      login("Pathology results", {}),
      login("Shared systems guide", {}, false),
    ],
    loading: false,
    isOffline: false,
    loadError: null,
    signedOut: false,
    demoMode: false,
  });
});
afterEach(cleanup);

describe("Your first week, the pack", () => {
  it("shows the start date, the countdown and every section with its count", () => {
    renderPage();
    expect(screen.getByTestId("on-call-first-week-eyebrow")).toHaveTextContent("Starts in 7 days");
    expect(screen.getByTestId("on-call-first-week-start")).toHaveTextContent("Starts Mon 2 Nov 2026");
    expect(screen.getAllByTestId(/^on-call-first-week-row-/).map((row) => row.getAttribute("data-testid"))).toEqual([
      "on-call-first-week-row-who",
      "on-call-first-week-row-expect",
      "on-call-first-week-row-escalate",
      "on-call-first-week-row-logins",
      "on-call-first-week-row-first-day",
    ]);
    expect(screen.getByTestId("on-call-first-week-row-first-day")).toHaveTextContent("Mon 2 Nov · 2 items");
    expect(screen.getByTestId("on-call-first-week-row-expect")).toHaveTextContent("1 item");
    expect(screen.getByTestId("on-call-first-week-row-who")).toHaveTextContent("1 role");
    expect(screen.getByTestId("on-call-first-week-row-escalate")).toHaveTextContent("1 emergency line");
    expect(screen.getByTestId("on-call-first-week-row-logins")).toHaveTextContent("1 of 2 ready");
    expect(screen.getByTestId("on-call-first-week-row-logins")).toHaveTextContent("1 to do");
    const strip = screen.getByRole("progressbar", { name: "Sections read" });
    expect(strip).toHaveAttribute("aria-valuetext", "0 of 5 sections read");
    expect(screen.getByTestId("on-call-first-week-row-who")).toHaveAttribute("href", "/on-call/first-week?section=who");
  });

  it("asks for a start date in New job when there is none, and never guesses one", () => {
    entryState.entries = [login("Pathology results", {})];
    renderPage();
    expect(screen.getByTestId("on-call-first-week-eyebrow")).toHaveTextContent("No start date yet");
    expect(screen.getByTestId("on-call-first-week-add-start")).toHaveAttribute("href", "/admin/new-job");
    expect(screen.queryByTestId("on-call-first-week-calendar")).toBeNull();
  });

  it("says a failed New job read failed, with Try again, rather than no date", () => {
    Object.assign(entryState, { loadError: "failed", isOffline: true });
    renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("Your start date could not be loaded.");
    fireEvent.click(screen.getByTestId("on-call-first-week-start-retry"));
    expect(entryState.retry).toHaveBeenCalled();
    expect(screen.getByTestId("on-call-first-week-row-logins")).toHaveTextContent("Could not load your New job list");
  });

  it("says when the pack moves to the top, for a start more than a week away", () => {
    entryState.entries = [login("Hospital email", { jobStartsOn: "2026-11-30" })];
    renderPage();
    expect(screen.getByTestId("on-call-first-week-eyebrow")).toHaveTextContent("Starts in 5 weeks");
    expect(screen.getByTestId("on-call-first-week-ahead")).toHaveTextContent("from Mon 23 Nov 2026");
  });

  it("offers one alert when the pack lands, on by default, and remembers turning it off with Undo", () => {
    entryState.entries = [login("Hospital email", { jobStartsOn: "2026-11-30" })];
    renderPage();
    const toggle = screen.getByRole("switch", { name: "Tell me when it lands" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("on-call-first-week-land-alert")).toHaveTextContent(
      "One alert in Needs you on Mon 23 Nov",
    );
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(JSON.parse(window.localStorage.getItem(ON_CALL_FIRST_WEEK_READ_STORAGE_KEY) ?? "{}")).toMatchObject({
      landAlertOff: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("shows no alert switch once the pack has landed", () => {
    renderPage();
    expect(screen.queryByTestId("on-call-first-week-land-alert")).toBeNull();
  });

  it("does not claim counts while the handbook loads, or when it could not load", () => {
    handbook.state = readyHandbook([], { status: "loading" });
    renderPage();
    expect(screen.getByTestId("on-call-first-week-row-who")).toHaveTextContent("Loading");
    expect(screen.queryByRole("progressbar")).toBeNull();
    cleanup();
    handbook.state = readyHandbook([], { status: "unavailable" });
    renderPage();
    expect(screen.getByTestId("on-call-first-week-row-who")).toHaveTextContent("Could not load");
    expect(screen.getByTestId("on-call-handbook-state-unavailable")).toBeInTheDocument();
    expect(screen.getByTestId("on-call-crisis-lines")).toBeInTheDocument();
  });

  it("picks what goes in the calendar file, and says the calendar copy will not follow later edits", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("on-call-first-week-calendar"));
    expect(download).not.toHaveBeenCalled();
    const sheet = screen.getByTestId("on-call-first-week-calendar-sheet");
    expect(sheet).toHaveTextContent("the calendar does not follow");
    expect(within(sheet).getByRole("checkbox", { name: "Your first day" })).toBeDisabled();
    fireEvent.click(within(sheet).getByRole("checkbox", { name: "A week before" }));
    fireEvent.click(screen.getByTestId("on-call-first-week-calendar-save"));
    const [ics, name, type] = download.mock.calls[0] as [string, string, string];
    expect(ics).toContain("SUMMARY:First day at Synthetic Hospital");
    expect(ics).not.toContain("TRIGGER:-P7D");
    expect(ics).toContain("TRIGGER:-P1D");
    expect([name, type]).toEqual(["first-day.ics", "text/calendar"]);
    expect(screen.getByText("Calendar file saved. Open it to add your first day.")).toBeInTheDocument();
  });

  it("says when the hospital has written no pack, and copies a note to ask for one without sending it", async () => {
    handbook.state = readyHandbook([]);
    renderPage();
    expect(screen.getByTestId("on-call-first-week-no-pack")).toHaveTextContent("No pack from Synthetic Hospital yet");
    fireEvent.click(screen.getByTestId("on-call-first-week-ask"));
    await screen.findByText("Note copied. Paste it into a message to your department. Nothing was sent.");
    const [text] = clipboard.mock.calls[0] as unknown as [string];
    expect(text).toContain("I am starting at Synthetic Hospital on Mon 2 Nov 2026.");
    // Logins still count when the hospital wrote nothing.
    expect(screen.getByTestId("on-call-first-week-row-logins")).toHaveTextContent("1 of 2 ready");
  });

  it("says so when offline, without claiming the pack is current", () => {
    const original = Object.getOwnPropertyDescriptor(window.navigator, "onLine");
    Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => false });
    try {
      renderPage();
      expect(screen.getByTestId("on-call-first-week-offline")).toHaveTextContent(
        "A later change by your hospital would not show",
      );
    } finally {
      if (original) Object.defineProperty(window.navigator, "onLine", original);
      else delete (window.navigator as { onLine?: boolean }).onLine;
    }
  });

  it("marks everything read with Undo, then can start again", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("on-call-first-week-mark-all"));
    expect(screen.getByRole("progressbar", { name: "Sections read" })).toHaveAttribute(
      "aria-valuetext",
      "5 of 5 sections read",
    );
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("progressbar", { name: "Sections read" })).toHaveAttribute(
      "aria-valuetext",
      "0 of 5 sections read",
    );
    fireEvent.click(screen.getByTestId("on-call-first-week-mark-all"));
    fireEvent.click(screen.getByTestId("on-call-first-week-start-again"));
    expect(screen.getByRole("progressbar", { name: "Sections read" })).toHaveAttribute(
      "aria-valuetext",
      "0 of 5 sections read",
    );
  });
});

describe("Your first week, one section", () => {
  it("opens a section, marks it read on this device with Undo, and offers the next one", () => {
    renderPage("first-day");
    expect(screen.getByRole("heading", { level: 1, name: "Your first day" })).toBeInTheDocument();
    expect(screen.getByTestId("on-call-first-week-before")).toHaveTextContent("Before you start");
    expect(screen.getByTestId("on-call-first-week-item-b1")).toHaveTextContent("From security, level 1.");
    expect(screen.getByTestId("on-call-first-week-first-shift")).toHaveTextContent("Find the handover room");
    expect(screen.getByTestId("on-call-first-week-next")).toHaveAttribute("href", "/on-call/first-week");
    expect(screen.getByTestId("on-call-first-week-next")).toHaveTextContent("Done");
    fireEvent.click(screen.getByTestId("on-call-first-week-mark-read"));
    const stored = JSON.parse(window.localStorage.getItem(ON_CALL_FIRST_WEEK_READ_STORAGE_KEY) ?? "{}");
    expect(Object.keys(stored.hospitals[`svc:${SITE}`])).toEqual(["first-day"]);
    // Ids and times only: no title, number or name is stored.
    expect(JSON.stringify(stored)).not.toMatch(/badge|security|9000/i);
    expect(screen.getByTestId("on-call-first-week-mark-unread")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByTestId("on-call-first-week-mark-read")).toBeInTheDocument();
    expect(window.localStorage.getItem(ON_CALL_FIRST_WEEK_READ_STORAGE_KEY)).toBe('{"version":1,"hospitals":{}}');
  });

  it("says a section changed since it was read, how many things and when, and marks the changed items", () => {
    window.localStorage.setItem(
      ON_CALL_FIRST_WEEK_READ_STORAGE_KEY,
      JSON.stringify({ version: 1, hospitals: { [`svc:${SITE}`]: { "first-day": "2026-09-01T00:00:00.000Z" } } }),
    );
    renderPage("first-day");
    expect(screen.getByTestId("on-call-first-week-changed")).toHaveTextContent("2 things changed since you read it");
    expect(screen.getByTestId("on-call-first-week-changed")).toHaveTextContent("updated this on Sun 20 Sep");
    expect(within(screen.getByTestId("on-call-first-week-item-b1")).getByText("Changed")).toBeInTheDocument();
    expect(screen.getByTestId("on-call-first-week-mark-read")).toHaveTextContent("Mark as read again");
  });

  it("keeps marks from an earlier layout of the pack only for sections that still exist", () => {
    window.localStorage.setItem(
      ON_CALL_FIRST_WEEK_READ_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        hospitals: { [`svc:${SITE}`]: { before: "2026-10-25T00:00:00.000Z", who: "2026-10-25T00:00:00.000Z" } },
      }),
    );
    renderPage();
    expect(screen.getByRole("progressbar", { name: "Sections read" })).toHaveAttribute(
      "aria-valuetext",
      "1 of 5 sections read",
    );
  });

  it("forgets the marks at an account transition", () => {
    renderPage("first-day");
    fireEvent.click(screen.getByTestId("on-call-first-week-mark-read"));
    clearAccountScopedBrowserStorage();
    expect(window.localStorage.getItem(ON_CALL_FIRST_WEEK_READ_STORAGE_KEY)).toBeNull();
  });

  it("draws roles and emergency rows as dialable rows, with the public crisis lines", () => {
    renderPage("who");
    expect(screen.getByTestId("on-call-first-week-role-c1")).toHaveTextContent("Nurse in charge");
    expect(screen.getByTestId("on-call-first-week-roster-link")).toHaveAttribute("href", "/on-call/whos-on/roster");
    expect(screen.getByTestId("on-call-first-week-next")).toHaveTextContent("Next: Expect");
    cleanup();
    renderPage("escalate");
    expect(screen.getByTestId("on-call-first-week-emergency-e1")).toBeInTheDocument();
    expect(screen.getByTestId("on-call-first-week-crisis-lines")).toHaveTextContent("1300 555 788");
    expect(screen.getByTestId("on-call-first-week-next")).toHaveTextContent("Next: Logins");
  });

  it("shows what we expect from the hospital, and sends hours and overtime to the agreement, never a figure", () => {
    renderPage("expect");
    expect(screen.getByTestId("on-call-first-week-item-w1")).toHaveTextContent("Tuesday and Friday mornings.");
    expect(screen.getByTestId("on-call-first-week-agreement-link")).toHaveAttribute(
      "href",
      "/my-day/profile/agreement",
    );
    expect(screen.getByTestId("on-call-first-week-agreement-link")).toHaveTextContent("Check your agreement");
    expect(screen.getByTestId("on-call-first-week-leave-link")).toHaveAttribute("href", "/roster/requests");
    expect(screen.getByTestId("on-call-first-week-hours").textContent).not.toMatch(/\d+ ?(hours|h|minutes)/i);
  });

  it("says a section the hospital has not written, and offers no Mark as read", () => {
    handbook.state = readyHandbook(handbookItems([{ id: "c1", title: "Switchboard", phone: "9000 0000" }]));
    renderPage("first-day");
    expect(screen.getByTestId("on-call-first-week-empty-first-day")).toHaveTextContent(
      "Not written by your hospital yet",
    );
    expect(screen.queryByTestId("on-call-first-week-mark-read")).toBeNull();
  });

  it("shows logins as status only, and never asks for a password", () => {
    renderPage("logins");
    expect(screen.getByTestId("on-call-first-week-logins")).toHaveTextContent("Ready for day one · 1 of 2");
    expect(screen.getByRole("progressbar", { name: "Logins ready" })).toHaveAttribute(
      "aria-valuetext",
      "1 of 2 logins ready",
    );
    const rows = screen.getAllByTestId(/^on-call-first-week-login-/);
    expect(rows.map((row) => row.textContent)).toEqual([
      "Hospital emailReady",
      "Pathology resultsNot yet",
      "Shared systems guideGuide",
    ]);
    expect(screen.getByTestId("on-call-first-week-no-passwords")).toHaveTextContent("Never put a password here");
    expect(screen.getByTestId("on-call-first-week-new-job-link")).toHaveAttribute("href", "/admin/new-job");
    expect(document.querySelector("input")).toBeNull();
    // Not in a roster team yet: the roster login opens Join a team.
    expect(screen.getByTestId("on-call-first-week-roster-login")).toHaveAttribute("href", "/roster/join");
    expect(screen.getByTestId("on-call-first-week-roster-login")).toHaveTextContent("Join");
  });

  it("shows the roster login as ready once you are in a team", () => {
    rosterTeams.state = {
      ...rosterTeams.state,
      data: { teams: [{ serviceId: "t1", name: "Ward 4 registrars", enabled: true }] },
    };
    renderPage("logins");
    expect(screen.getByTestId("on-call-first-week-roster-login")).toHaveTextContent("Ward 4 registrarsReady");
    expect(screen.getByTestId("on-call-first-week-roster-login").getAttribute("href")).toBeNull();
  });

  it("treats an unknown section as the pack", () => {
    renderPage("passwords");
    expect(screen.getByTestId("on-call-first-week-pack")).toBeInTheDocument();
  });

  it("keeps the signed-out sample's marks in memory only", () => {
    handbook.state = readyHandbook(ITEMS, { demo: true, hospitalKey: null });
    renderPage("first-day");
    fireEvent.click(screen.getByTestId("on-call-first-week-mark-read"));
    expect(screen.getByTestId("on-call-first-week-mark-unread")).toBeInTheDocument();
    expect(window.localStorage.getItem(ON_CALL_FIRST_WEEK_READ_STORAGE_KEY)).toBeNull();
  });
});

describe("FirstWeekTodayCard", () => {
  it("shows only while highlighted, with what is left to read", () => {
    const progress = { read: 2, total: 5, changed: 0 };
    const { rerender } = render(
      <FirstWeekTodayCard
        phase={firstWeekPhase("2026-11-02", NOW)}
        progress={progress}
        hospitalName="Synthetic Hospital"
      />,
    );
    expect(screen.getByTestId("on-call-first-week-today-card")).toHaveTextContent("Starts in 7 days");
    expect(screen.getByTestId("on-call-first-week-today-card")).toHaveTextContent("Synthetic Hospital · 3 to read");
    rerender(<FirstWeekTodayCard phase={firstWeekPhase("2026-12-30", NOW)} progress={progress} hospitalName={null} />);
    expect(screen.queryByTestId("on-call-first-week-today-card")).toBeNull();
  });
});
