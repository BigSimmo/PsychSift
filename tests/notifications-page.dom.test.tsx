/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationsPage } from "@/components/needs-you/notifications-page";
import { MY_DAY_SNOOZED_ITEMS_STORAGE_KEY } from "@/lib/account-scoped-browser-state";
import { myDaySourceModes, type MyDayItem, type MyDaySourceMode, type MyDaySourceStatus } from "@/lib/my-day/model";
import { perthToday } from "@/lib/needs-you/feed";
import type { OnCallNotification } from "@/lib/on-call/notifications";

// Alerts work, owner approval 7 Oct 2026: My Day › Notifications › To do draws the
// bell's Notification centre body as a page, with every state the sheet has. The
// sources are stubbed exactly as the sheet's own tests stub them.

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

const auth = vi.hoisted(() => ({ status: "authenticated" as "authenticated" | "signed-out" }));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => ({ status: auth.status, authEpoch: 0 }),
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

// The rest of the module stays real: the feed reads the work time zone through it.
vi.mock("@/components/clinical-dashboard/use-app-preferences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/clinical-dashboard/use-app-preferences")>()),
  useAppPreferences: () => ({
    preferences: { reminders: { types: {} } },
    setPreference: vi.fn(),
  }),
}));

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
  auth.status = "authenticated";
  myDay.status = "ready";
  myDay.items = [];
  myDay.sourceStatus = {};
  onCall.notifications = [];
  window.localStorage.clear();
});

describe("Notifications page (To do)", () => {
  it("draws the centre on the page, not in a sheet, named Notifications", () => {
    myDay.items = [item({ id: "roster:swap:1", mode: "roster", title: "A colleague asks to swap", due: inDays(0) })];
    render(<NotificationsPage />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("needs-you-sheet")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Notifications" })).toBeTruthy();
    expect(screen.getByTestId("notifications-page-header").textContent).toMatch(/needs/i);
    const row = screen.getByTestId("needs-you-item-roster:swap:1");
    expect(row.getAttribute("href")).toBe("/roster");
    expect(screen.getByRole("radiogroup", { name: "Show" })).toBeTruthy();
    // Following a row is an ordinary link: nothing to close.
    fireEvent.click(row);
  });

  it("shows the loading rows while the sources settle", () => {
    myDay.status = "loading";
    render(<NotificationsPage />);
    expect(screen.getByTestId("needs-you-loading").textContent).toBe("Checking what needs you.");
  });

  it("asks a signed-out reader to sign in", () => {
    auth.status = "signed-out";
    myDay.status = "signed-out";
    render(<NotificationsPage />);
    expect(screen.getByTestId("needs-you-signed-out").textContent).toBe("Sign in to see what needs you.");
  });

  it("says nothing was checked when every source failed, and Try again retries", () => {
    const retry = vi.fn();
    myDay.retry = retry;
    myDay.sourceStatus = Object.fromEntries(myDaySourceModes.map((mode) => [mode, "failed"]));
    render(<NotificationsPage />);
    expect(screen.getByTestId("needs-you-error").textContent).toMatch(/not the same as nothing due/);
    fireEvent.click(screen.getByTestId("needs-you-retry"));
    expect(retry).toHaveBeenCalled();
    myDay.retry = () => undefined;
  });

  it("names a source that did not load and never says all caught up", () => {
    myDay.sourceStatus = { roster: "failed" };
    render(<NotificationsPage />);
    expect(screen.getByTestId("needs-you-partial").textContent).toContain("Roster did not load");
    expect(screen.queryByTestId("needs-you-empty")).toBeNull();
    expect(screen.queryByText("You're all caught up")).toBeNull();
    expect(screen.getByTestId("needs-you-empty-partial")).toBeTruthy();
  });

  it("says when it is offline", () => {
    const online = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    render(<NotificationsPage />);
    expect(screen.getByTestId("needs-you-offline").textContent).toContain("You are offline");
    online.mockRestore();
  });

  it("says all caught up when nothing needs the reader", () => {
    render(<NotificationsPage />);
    expect(screen.getByText("You're all caught up")).toBeTruthy();
  });

  it("offers Show all when a filter leaves nothing", () => {
    myDay.items = [item({ id: "roster:swap:1", mode: "roster", title: "Swap", due: inDays(0), severity: "soon" })];
    render(<NotificationsPage />);
    fireEvent.click(screen.getByTestId("needs-you-segment-update"));
    expect(screen.getByTestId("needs-you-filter-empty")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getByTestId("needs-you-item-roster:swap:1")).toBeTruthy();
  });

  it("snoozes from a row and Undo brings it back", () => {
    myDay.items = [item({ id: "roster:swap:1", mode: "roster", title: "Swap", due: inDays(0), severity: "soon" })];
    render(<NotificationsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Options for Swap" }));
    fireEvent.click(screen.getByTestId("needs-you-snooze-roster:swap:1"));
    expect(screen.queryByTestId("needs-you-item-roster:swap:1")).toBeNull();
    expect(window.localStorage.getItem(MY_DAY_SNOOZED_ITEMS_STORAGE_KEY)).toContain("roster:swap:1");
    fireEvent.click(within(screen.getByTestId("needs-you-undo")).getByRole("button", { name: "Undo" }));
    expect(screen.getByTestId("needs-you-item-roster:swap:1")).toBeTruthy();
  });
});
