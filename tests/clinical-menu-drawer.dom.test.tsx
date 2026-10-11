/** @vitest-environment jsdom */

// The phone side menu (owner pick "variant C", 11 Oct 2026): Clinical | Work
// tabs in the brand band, an alerts bell beside the close cross that shows a
// badge only for real waiting items, the restored Clinical menu, and every
// clinical page grouped under it with the current page marked once.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClinicalMobileSidebar, deriveSidebarIdentity } from "@/components/clinical-dashboard/ClinicalSidebar";
import { SIDEBAR_PINS_STORAGE_KEY } from "@/components/clinical-dashboard/use-sidebar-pins";
import { setWorkSideCounts } from "@/components/work-frame/work-frame-store";
import type { AppModeId } from "@/lib/app-modes";

const authSession = vi.hoisted(() => ({ status: "unconfigured" as string }));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => authSession,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// The real reader reads the notification feed; these tests publish counts directly.
vi.mock("@/components/work-frame/lazy-work-side-nav", () => ({
  LazyWorkSideCounts: () => null,
}));

const recent = ["Clozapine restart after missed doses", "Lithium level timing", "Who can sign a Form 1A"];

function renderMenu(
  overrides: Partial<{
    activeMode: AppModeId;
    startSide: "clinical" | "work";
    currentArea: "day" | "call" | null;
    open: boolean;
  }> = {},
) {
  const props = {
    open: true,
    recentQueries: recent,
    identity: deriveSidebarIdentity("alex.morgan@example.org"),
    activeMode: "answer" as AppModeId,
    showAccountLibrary: true,
    onOpenChange: vi.fn(),
    onNewChat: vi.fn(),
    onPickRecent: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenAccount: vi.fn(),
    onPrefetchApplications: vi.fn(),
    onOpenSearch: vi.fn(),
    ...overrides,
  };
  return { ...render(<ClinicalMobileSidebar {...props} />), props };
}

function currentRows() {
  return Array.from(screen.getByTestId("clinical-mobile-menu").querySelectorAll('[aria-current="page"]'));
}

beforeEach(() => {
  window.localStorage.clear();
  authSession.status = "unconfigured";
  setWorkSideCounts(null);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 0;
  });
});

afterEach(() => {
  cleanup();
  act(() => setWorkSideCounts(null));
  vi.restoreAllMocks();
});

describe("phone side menu tabs", () => {
  it("opens on Clinical and switches to Work and back by tap", () => {
    renderMenu();
    const tabs = within(screen.getByRole("tablist", { name: "Menu sections" }));
    const clinical = tabs.getByRole("tab", { name: "Clinical" });
    const work = tabs.getByRole("tab", { name: "Work" });
    expect(clinical).toHaveAttribute("aria-selected", "true");
    expect(work).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", clinical.id);
    expect(screen.getByRole("button", { name: "New chat" })).toBeTruthy();

    fireEvent.click(work);
    expect(work).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", work.id);
    expect(screen.queryByRole("button", { name: "New chat" })).toBeNull();
    const areas = within(screen.getByTestId("clinical-menu-work")).getAllByRole("link");
    expect(areas.map((link) => link.textContent)).toEqual([
      "My Day",
      "On Call",
      "Open shifts",
      "Roster",
      "Teaching",
      "CPD",
      "Admin",
    ]);
    // Appearance, Settings and the account card stay at the foot of both tabs.
    expect(screen.getByRole("button", { name: /Appearance/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
    expect(screen.getByTestId("sidebar-account-settings")).toBeTruthy();

    fireEvent.click(clinical);
    expect(screen.getByRole("button", { name: "New chat" })).toBeTruthy();
  });

  it("moves between the tabs with the arrow keys, Home and End, with one tab stop", () => {
    renderMenu();
    const clinical = screen.getByRole("tab", { name: "Clinical" });
    const work = screen.getByRole("tab", { name: "Work" });
    expect(clinical).toHaveAttribute("tabindex", "0");
    expect(work).toHaveAttribute("tabindex", "-1");

    clinical.focus();
    fireEvent.keyDown(clinical, { key: "ArrowRight" });
    expect(work).toHaveAttribute("aria-selected", "true");
    expect(work).toHaveFocus();
    expect(work).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(work, { key: "Home" });
    expect(clinical).toHaveAttribute("aria-selected", "true");
    expect(clinical).toHaveFocus();

    fireEvent.keyDown(clinical, { key: "End" });
    expect(work).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(work, { key: "ArrowLeft" });
    expect(clinical).toHaveAttribute("aria-selected", "true");
  });

  it("opens on Work in a work area, with that area as the one current row", () => {
    renderMenu({ activeMode: "on-call", startSide: "work", currentArea: "call" });
    expect(screen.getByRole("tab", { name: "Work" })).toHaveAttribute("aria-selected", "true");
    const current = screen.getByTestId("clinical-menu-work").querySelectorAll('[aria-current="true"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("On Call");
  });

  it("reopens on the page's own side after a reader switched tabs", () => {
    const { rerender, props } = renderMenu();
    fireEvent.click(screen.getByRole("tab", { name: "Work" }));
    rerender(<ClinicalMobileSidebar {...props} open={false} />);
    rerender(<ClinicalMobileSidebar {...props} open />);
    expect(screen.getByRole("tab", { name: "Clinical" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("phone side menu alerts bell", () => {
  it("links to the Notifications page with no badge and no overdue dot while nothing is waiting", () => {
    renderMenu();
    const bell = screen.getByTestId("clinical-menu-bell");
    expect(bell).toHaveAttribute("href", "/my-day/notifications");
    expect(bell).toHaveAccessibleName("Alerts");
    expect(screen.queryByTestId("clinical-menu-bell-badge")).toBeNull();
    expect(screen.queryByTestId("clinical-menu-work-overdue-dot")).toBeNull();

    // An empty feed is the same as nothing known: still no badge.
    act(() => setWorkSideCounts({ areas: {}, total: 0, overdue: 0, reminders: 0 }));
    expect(screen.queryByTestId("clinical-menu-bell-badge")).toBeNull();
    expect(screen.getByTestId("clinical-menu-bell")).toHaveAccessibleName("Alerts");
  });

  it("shows the feed's real count on the bell, says it aloud, and dots the Work tab only when overdue", () => {
    renderMenu();
    act(() => setWorkSideCounts({ areas: { day: { total: 3, overdue: 0 } }, total: 3, overdue: 0, reminders: 0 }));
    expect(screen.getByTestId("clinical-menu-bell-badge")).toHaveTextContent("3");
    expect(screen.getByTestId("clinical-menu-bell")).toHaveAccessibleName("Alerts, 3 waiting");
    expect(screen.queryByTestId("clinical-menu-work-overdue-dot")).toBeNull();
    expect(screen.getByRole("tab", { name: "Work" })).toBeTruthy();

    act(() => setWorkSideCounts({ areas: { day: { total: 8, overdue: 1 } }, total: 12, overdue: 1, reminders: 0 }));
    expect(screen.getByTestId("clinical-menu-bell-badge")).toHaveTextContent("9+");
    expect(screen.getByTestId("clinical-menu-bell")).toHaveAccessibleName("Alerts, 12 waiting, 1 overdue");
    expect(screen.getByTestId("clinical-menu-work-overdue-dot")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Work, 1 overdue" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /^Work/ }));
    const myDay = within(screen.getByTestId("clinical-menu-work")).getByRole("link", { name: /^My Day/ });
    expect(myDay).toHaveTextContent("8");
    expect(myDay).toHaveAccessibleName("My Day, 8 waiting, 1 overdue");
  });

  it("closes the menu when the bell is followed", () => {
    const { props } = renderMenu();
    const bell = screen.getByTestId("clinical-menu-bell");
    bell.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(bell);
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("draws no bell for a signed-out reader on a hosted build", () => {
    authSession.status = "signed_out";
    renderMenu();
    expect(screen.queryByTestId("clinical-menu-bell")).toBeNull();
    expect(screen.getByRole("tab", { name: "Work" })).toBeTruthy();
  });
});

describe("phone side menu Clinical tab", () => {
  it("keeps New chat, Search, Recent chats and Shortcuts with Edit above the grouped pages", () => {
    const { props } = renderMenu();
    const panel = within(screen.getByRole("tabpanel"));
    expect(panel.getByRole("button", { name: "New chat" })).toBeTruthy();
    expect(panel.getByRole("button", { name: "Search PsychSift" })).toBeTruthy();
    for (const query of recent) expect(panel.getByRole("button", { name: query })).toBeTruthy();
    expect(panel.getByText("Shortcuts")).toBeTruthy();
    expect(panel.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(panel.getByRole("navigation", { name: "Pinned shortcuts" })).toBeTruthy();
    // The grouped list replaces the More modes sheet.
    expect(panel.queryByRole("button", { name: /More modes/ })).toBeNull();
    for (const heading of ["Search", "Psychiatry", "Medicines", "Library"]) {
      expect(panel.getByRole("navigation", { name: heading })).toBeTruthy();
    }

    fireEvent.click(panel.getByRole("button", { name: recent[1] }));
    expect(props.onPickRecent).toHaveBeenCalledWith(recent[1]);
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(props.onNewChat).toHaveBeenCalledOnce();
  });

  it("names a group's own dashboard Overview, so no heading repeats as a row", () => {
    renderMenu();
    const psychiatry = within(screen.getByRole("navigation", { name: "Psychiatry" }));
    const medicines = within(screen.getByRole("navigation", { name: "Medicines" }));
    const first = psychiatry.getAllByRole("link")[0];
    expect(first).toHaveTextContent("Overview");
    expect(first).toHaveAttribute("href", "/psychiatry");
    expect(first).toHaveAccessibleName("Psychiatry overview");
    expect(psychiatry.queryByRole("link", { name: "Psychiatry" })).toBeNull();
    expect(medicines.getAllByRole("link")[0]).toHaveAccessibleName("Medicines overview");
    expect(medicines.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Overview",
      "Medication",
      "Factsheets",
    ]);
  });

  it("marks a pinned current page once, in Shortcuts, and never tints a recent chat", () => {
    renderMenu({ activeMode: "answer" });
    const current = currentRows();
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Answer");
    expect(
      within(screen.getByRole("navigation", { name: "Pinned shortcuts" })).getByRole("link", { name: "Answer" }),
    ).toHaveAttribute("aria-current", "page");
    // The Search group still lists Answer, unmarked.
    expect(
      within(screen.getByRole("navigation", { name: "Search" })).getByRole("link", { name: "Answer" }),
    ).not.toHaveAttribute("aria-current");
    const newestChat = screen.getByRole("button", { name: recent[0] });
    expect(newestChat.className.split(/\s+/)).not.toContain("bg-[color:var(--clinical-accent-soft)]");
  });

  it("marks an unpinned current page once, in its group", () => {
    renderMenu({ activeMode: "dsm" });
    const current = currentRows();
    expect(current).toHaveLength(1);
    expect(
      within(screen.getByRole("navigation", { name: "Psychiatry" })).getByRole("link", { name: /DSM/ }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("follows the reader's own pins", () => {
    window.localStorage.setItem(SIDEBAR_PINS_STORAGE_KEY, JSON.stringify(["dsm", "forms"]));
    renderMenu({ activeMode: "dsm" });
    const pinned = within(screen.getByRole("navigation", { name: "Pinned shortcuts" }));
    expect(pinned.getAllByRole("link").map((link) => link.textContent)).toEqual(["DSM-5 Diagnosis", "Forms"]);
    const current = currentRows();
    expect(current).toHaveLength(1);
    expect(pinned.getByRole("link", { name: "DSM-5 Diagnosis" })).toHaveAttribute("aria-current", "page");
  });
});
