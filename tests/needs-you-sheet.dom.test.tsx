/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NeedsYouSheet } from "@/components/needs-you/needs-you-sheet";
import { MY_DAY_SNOOZED_ITEMS_STORAGE_KEY, REMIND_ME_STORAGE_KEY } from "@/lib/account-scoped-browser-state";
import { myDaySourceModes, type MyDayItem, type MyDaySourceMode, type MyDaySourceStatus } from "@/lib/my-day/model";
import { perthToday } from "@/lib/needs-you/feed";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import type { OnCallNotification } from "@/lib/on-call/notifications";

const myDay = vi.hoisted(() => ({
  status: "ready" as "ready" | "loading" | "signed-out",
  items: [] as MyDayItem[],
  sourceStatus: {} as Partial<Record<string, string>>,
  retry: () => undefined as void,
}));

const onCall = vi.hoisted(() => ({
  notifications: [] as OnCallNotification[],
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/my-day",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => ({ status: "authenticated" }),
}));

// Work-mode redesign, owner request 6 Oct 2026: the Notification centre reads each
// source's own status (for the partial and failed states), so the stub reports them.
vi.mock("@/components/my-day/use-my-day-items", () => ({
  useMyDayItems: () => ({
    status: myDay.status,
    items: myDay.items,
    retry: myDay.retry,
    sources: myDaySourceModes.map((mode: MyDaySourceMode) => ({
      mode,
      status: (myDay.sourceStatus[mode] ?? (myDay.status === "loading" ? "loading" : "ready")) as MyDaySourceStatus,
      items: myDay.items.filter((item) => item.mode === mode),
    })),
  }),
}));

vi.mock("@/lib/on-call/entry-store", () => ({
  useOnCallEntries: () => ({ entries: [] }),
}));

vi.mock("@/lib/on-call/notifications", async () => {
  const actual = await vi.importActual<typeof import("@/lib/on-call/notifications")>("@/lib/on-call/notifications");
  return {
    ...actual,
    deriveOnCallNotifications: () => onCall.notifications,
    visibleOnCallNotifications: (list: OnCallNotification[]) => list,
  };
});

vi.mock("@/components/clinical-dashboard/use-app-preferences", () => ({
  useAppPreferences: () => ({
    preferences: { reminders: { types: {} } },
    setPreference: vi.fn(),
  }),
}));

function entry(): OnCallEntry {
  return {
    id: "bls",
    slug: "bls",
    section: "logistics",
    title: "Basic life support",
    subtitle: null,
    body: null,
    details: { kind: "compliance", expiresOn: "2026-01-01" },
    tags: [],
    isPersonal: true,
    sortOrder: 0,
    lastVerifiedAt: null,
  } as unknown as OnCallEntry;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** A Perth date `days` from today, so the urgency groups hold whatever day the suite runs. */
function inDays(days: number): string {
  return perthToday(new Date(Date.now() + days * DAY_MS));
}

function item(partial: Partial<MyDayItem> & Pick<MyDayItem, "id" | "mode" | "title">): MyDayItem {
  return { due: null, severity: "info", href: `/${partial.mode}`, ...partial };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 204 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  myDay.status = "ready";
  myDay.items = [];
  myDay.sourceStatus = {};
  onCall.notifications = [];
  window.localStorage.clear();
});

describe("Needs you sheet", () => {
  const close = vi.fn();
  const returnFocusRef = { current: null };

  // Work-mode redesign, owner request 6 Oct 2026: the sheet is the Notification
  // centre, titled Notifications and grouped by urgency rather than by mode.
  it("groups by urgency under Notifications, never alerts or compliant", () => {
    myDay.items = [
      {
        id: "cme:1",
        mode: "cme",
        title: "Log this week's hours",
        detail: "Routine due",
        due: "2026-10-01",
        severity: "soon",
        href: "/cme",
      },
    ];
    render(<NeedsYouSheet open onClose={close} returnFocusRef={returnFocusRef} />);
    expect(screen.getByTestId("needs-you-sheet").textContent).toContain("Notifications");
    expect(screen.getByTestId("needs-you-urgency-overdue")).toBeTruthy();
    expect(screen.getByText("Log this week's hours")).toBeTruthy();
    expect(screen.getByText(/Routine due · Was due/)).toBeTruthy();
    expect(screen.getByTestId("needs-you-sheet").textContent?.toLowerCase()).not.toMatch(
      /alert|compliant|you.?re behind/,
    );
  });

  it("includes On Call notifications in the On Call group", () => {
    onCall.notifications = [
      {
        id: "bls:compliance-date-passed",
        kind: "compliance-date-passed",
        title: "Basic life support",
        detail: "The date recorded for this was 2026-01-01, which has passed.",
        entry: entry(),
      },
    ];
    render(<NeedsYouSheet open onClose={close} returnFocusRef={returnFocusRef} />);
    expect(screen.getByTestId("on-call-notifications-list")).toBeTruthy();
    const row = screen.getByTestId("on-call-notification-compliance-date-passed");
    expect(row.getAttribute("href")).toMatch(/^\/admin\/renewals#on-call-entry-/);
    fireEvent.click(row);
    expect(close).toHaveBeenCalledWith(true);
  });

  it("sends an unconfirmed compliance requirement to Renewals, not Admin Help", () => {
    // Kind is never-verified because nobody confirmed it, but the row is still a
    // compliance requirement. Routing from kind used to land on Admin Help,
    // which filters those rows out.
    onCall.notifications = [
      {
        id: "mand:never-verified",
        kind: "never-verified",
        title: "Mandatory training",
        detail: "Nobody has confirmed this in a year.",
        entry: {
          ...entry(),
          id: "mand",
          slug: "mand",
          title: "Mandatory training",
          details: { kind: "compliance", expiresOn: "2099-01-01" },
        },
      },
    ];
    render(<NeedsYouSheet open onClose={close} returnFocusRef={returnFocusRef} />);
    expect(screen.getByTestId("on-call-notification-never-verified").getAttribute("href")).toMatch(
      /^\/admin\/renewals#on-call-entry-/,
    );
  });

  it("says nothing needs you when the lists are empty", () => {
    render(<NeedsYouSheet open onClose={close} returnFocusRef={returnFocusRef} />);
    expect(screen.getByTestId("needs-you-empty").textContent).toBe("Nothing needs you right now.");
    expect(screen.getByText("You're all caught up")).toBeTruthy();
  });
});

describe("Notification centre behaviours", () => {
  const returnFocusRef = { current: null };

  const mixed = (): MyDayItem[] => [
    item({
      id: "my-work:date:bls",
      mode: "my-work",
      title: "Basic life support",
      due: inDays(-3),
      severity: "overdue",
    }),
    item({ id: "roster:swap:1", mode: "roster", title: "A colleague asks to swap", due: inDays(0), severity: "soon" }),
    item({ id: "teaching:prep:9", mode: "teaching", title: "Prep your talk", due: inDays(3), severity: "soon" }),
    item({ id: "my-work:date:mh", mode: "my-work", title: "Manual handling", due: inDays(40), severity: "info" }),
    item({ id: "teaching:catch-up", mode: "teaching", title: "Catch up on 2 sessions", severity: "info" }),
  ];

  it("orders the groups Overdue, Today, This week, Later, with counts", () => {
    myDay.items = mixed();
    render(<NeedsYouSheet open onClose={vi.fn()} returnFocusRef={returnFocusRef} />);
    const groups = screen.getAllByTestId(/^needs-you-urgency-/).map((node) => node.getAttribute("data-testid"));
    expect(groups).toEqual([
      "needs-you-urgency-overdue",
      "needs-you-urgency-today",
      "needs-you-urgency-week",
      "needs-you-urgency-later",
    ]);
    expect(within(screen.getByTestId("needs-you-urgency-later")).getAllByRole("listitem")).toHaveLength(2);
  });

  it("filters by Action needed and Updates, with arrow keys moving the choice", () => {
    myDay.items = mixed();
    render(<NeedsYouSheet open onClose={vi.fn()} returnFocusRef={returnFocusRef} />);
    const all = screen.getByTestId("needs-you-segment-all");
    expect(all.getAttribute("aria-checked")).toBe("true");
    expect(all.textContent).toContain("5");
    fireEvent.click(screen.getByTestId("needs-you-segment-update"));
    expect(screen.queryByTestId("needs-you-item-roster:swap:1")).toBeNull();
    expect(screen.getByTestId("needs-you-item-teaching:catch-up")).toBeTruthy();
    expect(screen.getByTestId("needs-you-item-my-work:date:mh")).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId("needs-you-segment-update"), { key: "ArrowLeft" });
    expect(screen.getByTestId("needs-you-segment-action").getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(screen.getByTestId("needs-you-segment-action"));
    expect(screen.getByTestId("needs-you-item-roster:swap:1")).toBeTruthy();
    expect(screen.queryByTestId("needs-you-item-teaching:catch-up")).toBeNull();
  });

  it("shows area chips with counts and filters to one area", () => {
    myDay.items = mixed();
    render(<NeedsYouSheet open onClose={vi.fn()} returnFocusRef={returnFocusRef} />);
    expect(screen.getByTestId("needs-you-area-all").textContent).toContain("5");
    // work-mode redesign, owner request 6 Oct 2026: WorkChip puts a screen-reader
    // space between the label and its count, so the text reads "Admin 2".
    expect(screen.getByTestId("needs-you-area-my-work").textContent).toBe("Admin 2");
    fireEvent.click(screen.getByTestId("needs-you-area-teaching"));
    expect(screen.getByTestId("needs-you-area-teaching").getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId("needs-you-item-my-work:date:bls")).toBeNull();
    expect(screen.getByTestId("needs-you-item-teaching:prep:9")).toBeTruthy();
    // Tapping the chosen chip again shows every area.
    fireEvent.click(screen.getByTestId("needs-you-area-teaching"));
    expect(screen.getByTestId("needs-you-item-my-work:date:bls")).toBeTruthy();
  });

  it("offers Show all when a filter leaves nothing", () => {
    myDay.items = [item({ id: "roster:swap:1", mode: "roster", title: "Swap", due: inDays(0), severity: "soon" })];
    render(<NeedsYouSheet open onClose={vi.fn()} returnFocusRef={returnFocusRef} />);
    fireEvent.click(screen.getByTestId("needs-you-segment-update"));
    expect(screen.getByTestId("needs-you-filter-empty")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getByTestId("needs-you-item-roster:swap:1")).toBeTruthy();
  });

  it("opens the exact page and closes, and links settings to Alerts", () => {
    const onClose = vi.fn();
    myDay.items = [
      item({ id: "roster:swap:1", mode: "roster", title: "Swap", href: "/roster/swaps?team=a", due: inDays(0) }),
    ];
    render(<NeedsYouSheet open onClose={onClose} returnFocusRef={returnFocusRef} />);
    const row = screen.getByTestId("needs-you-item-roster:swap:1");
    expect(row.getAttribute("href")).toBe("/roster/swaps?team=a");
    expect(screen.getByTestId("needs-you-settings").getAttribute("href")).toBe("/my-day/alerts");
    expect(screen.getByTestId("needs-you-settings").getAttribute("aria-label")).toBe("Notification settings");
    fireEvent.click(row);
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it("snoozes to the next working day in My Day's store, lists it, and Undo brings it back", () => {
    myDay.items = mixed();
    render(<NeedsYouSheet open onClose={vi.fn()} returnFocusRef={returnFocusRef} />);
    fireEvent.click(screen.getByTestId("needs-you-options-roster:swap:1"));
    expect(screen.getByTestId("needs-you-options-roster:swap:1").getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByTestId("needs-you-snooze-roster:swap:1"));
    expect(screen.queryByTestId("needs-you-item-roster:swap:1")).toBeNull();
    const stored = JSON.parse(window.localStorage.getItem(MY_DAY_SNOOZED_ITEMS_STORAGE_KEY) ?? "{}");
    expect(Object.keys(stored)).toEqual(["roster:swap:1"]);
    expect(stored["roster:swap:1"] > perthToday(new Date())).toBe(true);
    expect(screen.getByTestId("needs-you-segment-all").textContent).toContain("4");
    expect(screen.getByTestId("needs-you-snoozed").textContent).toContain("1 snoozed");
    expect(screen.getByTestId("needs-you-undo").textContent).toMatch(/^Snoozed to /);
    fireEvent.click(within(screen.getByTestId("needs-you-undo")).getByRole("button", { name: "Undo" }));
    expect(screen.getByTestId("needs-you-item-roster:swap:1")).toBeTruthy();
    expect(window.localStorage.getItem(MY_DAY_SNOOZED_ITEMS_STORAGE_KEY)).toBeNull();
  });

  it("brings a snoozed item back from the snoozed list", () => {
    myDay.items = mixed();
    window.localStorage.setItem(MY_DAY_SNOOZED_ITEMS_STORAGE_KEY, JSON.stringify({ "teaching:prep:9": inDays(2) }));
    render(<NeedsYouSheet open onClose={vi.fn()} returnFocusRef={returnFocusRef} />);
    expect(screen.queryByTestId("needs-you-item-teaching:prep:9")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /1 snoozed/ }));
    fireEvent.click(screen.getByTestId("needs-you-unsnooze-teaching:prep:9"));
    expect(screen.getByTestId("needs-you-item-teaching:prep:9")).toBeTruthy();
  });

  it("sets a Remind me note from a row, shows it on the row, and Undo removes it", () => {
    myDay.items = mixed();
    render(<NeedsYouSheet open onClose={vi.fn()} returnFocusRef={returnFocusRef} />);
    fireEvent.click(screen.getByTestId("needs-you-options-teaching:prep:9"));
    fireEvent.click(screen.getByTestId("needs-you-remind-teaching:prep:9"));
    fireEvent.click(screen.getByTestId("needs-you-remind-hour"));
    const saved = JSON.parse(window.localStorage.getItem(REMIND_ME_STORAGE_KEY) ?? "[]");
    expect(saved).toHaveLength(1);
    expect(saved[0].text).toBe("Prep your talk");
    expect(screen.getByTestId("needs-you-undo").textContent).toContain("Reminder set for In 1 hour");
    expect(screen.getByTestId("needs-you-item-teaching:prep:9").textContent).toMatch(/Reminder \d\d:\d\d/);
    fireEvent.click(within(screen.getByTestId("needs-you-undo")).getByRole("button", { name: "Undo" }));
    expect(window.localStorage.getItem(REMIND_ME_STORAGE_KEY)).toBeNull();
  });

  it("refuses a reminder whose words look like a patient detail, and says why", () => {
    myDay.items = [item({ id: "teaching:prep:1", mode: "teaching", title: "Ring ward about bed 12 bloods" })];
    render(<NeedsYouSheet open onClose={vi.fn()} returnFocusRef={returnFocusRef} />);
    fireEvent.click(screen.getByTestId("needs-you-options-teaching:prep:1"));
    fireEvent.click(screen.getByTestId("needs-you-remind-teaching:prep:1"));
    fireEvent.click(screen.getByTestId("needs-you-remind-hour"));
    expect(screen.getByRole("alert").textContent).toMatch(/can't go in a reminder/);
    expect(window.localStorage.getItem(REMIND_ME_STORAGE_KEY)).toBeNull();
  });

  it("closes a row's options with Escape without closing the sheet", () => {
    const onClose = vi.fn();
    myDay.items = mixed();
    render(<NeedsYouSheet open onClose={onClose} returnFocusRef={returnFocusRef} />);
    fireEvent.click(screen.getByTestId("needs-you-options-roster:swap:1"));
    fireEvent.keyDown(screen.getByTestId("needs-you-snooze-roster:swap:1"), { key: "Escape" });
    expect(screen.queryByTestId("needs-you-snooze-roster:swap:1")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("lists the reader's own reminders due today, with Done", () => {
    const dueAt = new Date(Date.now() - 60_000).toISOString();
    window.localStorage.setItem(
      REMIND_ME_STORAGE_KEY,
      JSON.stringify([{ id: "r1", text: "Ask switchboard for the pager list", dueAt, createdAt: dueAt, doneAt: null }]),
    );
    render(<NeedsYouSheet open onClose={vi.fn()} returnFocusRef={returnFocusRef} />);
    const row = screen.getByTestId("needs-you-item-remind:r1");
    expect(row.getAttribute("href")).toBe("/my-day/alerts");
    expect(row.textContent).toContain("Your reminder");
    fireEvent.click(screen.getByTestId("needs-you-options-remind:r1"));
    expect(screen.queryByTestId("needs-you-snooze-remind:r1")).toBeNull();
    fireEvent.click(screen.getByTestId("needs-you-complete-remind:r1"));
    expect(screen.queryByTestId("needs-you-item-remind:r1")).toBeNull();
    expect(screen.getByTestId("needs-you-empty")).toBeTruthy();
  });

  it("counts a passed compliance date once, under Admin, not again under On Call", () => {
    myDay.items = [
      item({
        id: "my-work:date:bls",
        mode: "my-work",
        title: "Basic life support",
        due: inDays(-3),
        severity: "overdue",
      }),
    ];
    onCall.notifications = [
      {
        id: "bls:compliance-date-passed",
        kind: "compliance-date-passed",
        title: "Basic life support",
        detail: "The date recorded for this was 2026-01-01, which has passed.",
        entry: entry(),
      },
    ];
    render(<NeedsYouSheet open onClose={vi.fn()} returnFocusRef={returnFocusRef} />);
    expect(screen.queryByTestId("on-call-notifications-list")).toBeNull();
    expect(screen.getByTestId("needs-you-segment-all").textContent).toContain("1");
  });

  it("shows a loading state while the sources settle", () => {
    myDay.status = "loading";
    render(<NeedsYouSheet open onClose={vi.fn()} returnFocusRef={returnFocusRef} />);
    expect(screen.getByTestId("needs-you-loading").textContent).toBe("Checking what needs you.");
  });

  it("says nothing was checked when every source failed, and Try again retries", () => {
    const retry = vi.fn();
    myDay.retry = retry;
    myDay.sourceStatus = Object.fromEntries(myDaySourceModes.map((mode) => [mode, "failed"]));
    render(<NeedsYouSheet open onClose={vi.fn()} returnFocusRef={returnFocusRef} />);
    expect(screen.getByTestId("needs-you-error").textContent).toMatch(/not the same as nothing due/);
    expect(screen.queryByTestId("needs-you-empty")).toBeNull();
    fireEvent.click(screen.getByTestId("needs-you-retry"));
    expect(retry).toHaveBeenCalled();
    myDay.retry = () => undefined;
  });

  it("names a source that did not load and never says all caught up", () => {
    myDay.sourceStatus = { roster: "failed" };
    render(<NeedsYouSheet open onClose={vi.fn()} returnFocusRef={returnFocusRef} />);
    expect(screen.getByTestId("needs-you-partial").textContent).toContain("Roster did not load");
    expect(screen.getByTestId("needs-you-sheet").textContent).toContain("Roster not loaded");
  });

  it("says when it is offline, showing what last loaded", () => {
    const online = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    myDay.items = mixed();
    render(<NeedsYouSheet open onClose={vi.fn()} returnFocusRef={returnFocusRef} />);
    expect(screen.getByTestId("needs-you-offline").textContent).toContain("You are offline");
    expect(screen.getByTestId("needs-you-item-roster:swap:1")).toBeTruthy();
    online.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByTestId("needs-you-offline")).toBeNull();
    online.mockRestore();
  });

  it("never shows a patient detail field or a push prompt", () => {
    myDay.items = mixed();
    render(<NeedsYouSheet open onClose={vi.fn()} returnFocusRef={returnFocusRef} />);
    const text = screen.getByTestId("needs-you-sheet").textContent?.toLowerCase() ?? "";
    expect(text).not.toMatch(/umrn|patient name|allow notifications|turn on push/);
  });
});
