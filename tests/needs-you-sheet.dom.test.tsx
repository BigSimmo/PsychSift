/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NeedsYouSheet } from "@/components/needs-you/needs-you-sheet";
import type { MyDayItem } from "@/lib/my-day/model";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import type { OnCallNotification } from "@/lib/on-call/notifications";

const myDay = vi.hoisted(() => ({
  status: "ready" as "ready" | "loading" | "signed-out",
  items: [] as MyDayItem[],
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

vi.mock("@/components/my-day/use-my-day-items", () => ({
  useMyDayItems: () => myDay,
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

afterEach(() => {
  cleanup();
  myDay.status = "ready";
  myDay.items = [];
  onCall.notifications = [];
});

describe("Needs you sheet", () => {
  const close = vi.fn();
  const returnFocusRef = { current: null };

  it("groups by mode and uses Needs you copy, never alerts or compliant", () => {
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
    expect(screen.getByTestId("needs-you-sheet").textContent).toContain("Needs you");
    expect(screen.getByTestId("needs-you-group-cme")).toBeTruthy();
    expect(screen.getByText("Log this week's hours")).toBeTruthy();
    expect(screen.getByText(/Due soon/)).toBeTruthy();
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

  it("says nothing needs you when the lists are empty", () => {
    render(<NeedsYouSheet open onClose={close} returnFocusRef={returnFocusRef} />);
    expect(screen.getByTestId("needs-you-empty").textContent).toBe("Nothing needs you right now.");
  });
});
