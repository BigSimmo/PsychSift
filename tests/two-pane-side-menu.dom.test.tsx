/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deriveSidebarIdentity } from "@/components/clinical-dashboard/ClinicalSidebar";
import { TwoPaneSideMenu, type TwoPaneSideMenuProps } from "@/components/work-frame/two-pane-side-menu";
import { TwoPaneSideRail } from "@/components/work-frame/two-pane-side-strip";
import { recentQueryStorageKey } from "@/lib/recent-query-storage";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const recent = [
  "Clozapine restart after missed doses",
  "Lithium level timing after a dose change",
  "Delirium screening tools for older adults",
  "QTc limits when combining antipsychotics",
  "Who can sign a Form 1A",
];

const recentKey = `${recentQueryStorageKey}:reader`;

function renderMenu(overrides: Partial<TwoPaneSideMenuProps> = {}) {
  const props: TwoPaneSideMenuProps = {
    open: true,
    onOpenChange: vi.fn(),
    identity: deriveSidebarIdentity("alex.morgan@example.org"),
    startSide: "clinical",
    workAvailable: true,
    currentArea: null,
    activeMode: "answer",
    recentQueries: recent,
    showAccountLibrary: true,
    onNewChat: vi.fn(),
    onPickRecent: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenAccount: vi.fn(),
    onSignOut: vi.fn(),
    ...overrides,
  };
  return { ...render(<TwoPaneSideMenu {...props} />), props };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 0;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("two-pane side menu", () => {
  it("opens on Clinical with the find box, New question, recent questions and shortcuts", () => {
    const { props } = renderMenu();
    const menu = screen.getByTestId("two-pane-side-menu");
    expect(within(menu).getByRole("heading", { level: 2, name: "Clinical" })).toBeTruthy();
    expect(screen.getByTestId("two-pane-menu-clinical").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("textbox", { name: "Find questions, pages and areas" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "Shortcuts" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: recent[4] }));
    expect(props.onPickRecent).toHaveBeenCalledWith(recent[4]);

    fireEvent.click(screen.getByTestId("two-pane-menu-new-question"));
    expect(props.onNewChat).toHaveBeenCalledOnce();
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("finds recent questions, pages and work areas, and asks what was typed", () => {
    const { props } = renderMenu();
    const find = screen.getByTestId("two-pane-menu-find");

    fireEvent.change(find, { target: { value: "lithium" } });
    expect(screen.getByRole("heading", { level: 3, name: "Questions" })).toBeTruthy();
    expect(screen.getByRole("button", { name: recent[1] })).toBeTruthy();
    expect(screen.queryByRole("button", { name: recent[0] })).toBeNull();
    expect(screen.getByText(/Nothing you type here is saved/)).toBeTruthy();

    fireEvent.change(find, { target: { value: "calc" } });
    expect(screen.getByRole("link", { name: "Calculators" })).toBeTruthy();

    fireEvent.change(find, { target: { value: "roster" } });
    expect(screen.getByRole("heading", { level: 3, name: "Work areas" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Roster" })).toBeTruthy();

    fireEvent.click(screen.getByTestId("two-pane-menu-find-ask"));
    expect(props.onPickRecent).toHaveBeenCalledWith("roster");
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("removes one recent question, and clears them all after a check", () => {
    window.sessionStorage.setItem(recentKey, JSON.stringify(recent));
    renderMenu();

    fireEvent.click(screen.getByRole("button", { name: `Remove “${recent[0]}” from recent questions` }));
    expect(JSON.parse(window.sessionStorage.getItem(recentKey) ?? "[]")).toEqual(recent.slice(1));

    fireEvent.click(screen.getByTestId("two-pane-menu-clear-recent"));
    expect(window.sessionStorage.getItem(recentKey)).not.toBeNull();
    expect(screen.getByText("Clear your recent questions from this device?")).toBeTruthy();
    fireEvent.click(screen.getByTestId("two-pane-menu-clear-recent-confirm"));
    expect(window.sessionStorage.getItem(recentKey)).toBeNull();
  });

  it("switches to Work, with the Today card and the areas as tiles, and back", () => {
    renderMenu({ currentArea: "rost" });
    fireEvent.click(screen.getByTestId("two-pane-menu-work"));
    expect(screen.getByRole("heading", { level: 2, name: "Work" })).toBeTruthy();
    expect(screen.getByTestId("two-pane-menu-today").textContent).toMatch(/^Today, \w{3} \d{1,2} \w{3}/);
    expect(screen.getByTestId("two-pane-menu-area-rost").getAttribute("aria-current")).toBe("true");
    expect(screen.getByTestId("two-pane-menu-area-day")).toBeTruthy();
    expect(screen.getByTestId("two-pane-menu-area-reminders")).toBeTruthy();
    fireEvent.click(screen.getByTestId("two-pane-menu-clinical"));
    expect(screen.getByRole("heading", { level: 2, name: "Clinical" })).toBeTruthy();
  });

  it("starts on Work on a work page, and hides Work for readers without the new work mode", () => {
    renderMenu({ startSide: "work" });
    expect(screen.getByRole("heading", { level: 2, name: "Work" })).toBeTruthy();
    cleanup();
    renderMenu({ startSide: "work", workAvailable: false });
    expect(screen.getByRole("heading", { level: 2, name: "Clinical" })).toBeTruthy();
    expect(screen.queryByTestId("two-pane-menu-work")).toBeNull();
    expect(screen.queryByTestId("two-pane-menu-reminders")).toBeNull();

    fireEvent.click(screen.getByTestId("two-pane-menu-you"));
    expect(screen.getByRole("heading", { level: 2, name: "You" })).toBeTruthy();
    fireEvent.click(screen.getByTestId("two-pane-menu-clinical"));
    expect(screen.getByRole("heading", { level: 2, name: "Clinical" })).toBeTruthy();
  });

  it("opens Settings and cycles Appearance from the strip", () => {
    const { props } = renderMenu();
    const appearance = screen.getByTestId("two-pane-menu-appearance");
    const before = appearance.getAttribute("aria-label");
    fireEvent.click(appearance);
    expect(appearance.getAttribute("aria-label")).not.toBe(before);

    fireEvent.click(screen.getByTestId("two-pane-menu-settings"));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.onOpenSettings).toHaveBeenCalledOnce();
  });

  it("closes when the menu is swiped left", () => {
    const { props } = renderMenu();
    const heading = screen.getByRole("heading", { level: 2, name: "Clinical" });
    fireEvent.pointerDown(heading, { clientX: 300, clientY: 100 });
    fireEvent.pointerUp(heading, { clientX: 200, clientY: 110 });
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("asks before signing out from the initials pane", () => {
    const { props } = renderMenu();
    fireEvent.click(screen.getByTestId("two-pane-menu-you"));
    expect(screen.getByRole("heading", { level: 2, name: "You" })).toBeTruthy();
    fireEvent.click(screen.getByTestId("two-pane-menu-sign-out"));
    expect(props.onSignOut).not.toHaveBeenCalled();
    expect(screen.getByText(/This clears everything kept on this device/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("two-pane-menu-sign-out-confirm"));
    expect(props.onSignOut).toHaveBeenCalledOnce();
  });

  it("opens on the pane a tablet rail button asked for", () => {
    const { rerender, props } = renderMenu({ open: false, openPane: "work" });
    rerender(<TwoPaneSideMenu {...props} open openPane="work" />);
    expect(screen.getByRole("heading", { level: 2, name: "Work" })).toBeTruthy();

    rerender(<TwoPaneSideMenu {...props} open={false} openPane="you" />);
    rerender(<TwoPaneSideMenu {...props} open openPane="you" />);
    expect(screen.getByRole("heading", { level: 2, name: "You" })).toBeTruthy();

    rerender(<TwoPaneSideMenu {...props} open={false} openPane="work" workAvailable={false} />);
    rerender(<TwoPaneSideMenu {...props} open openPane="work" workAvailable={false} />);
    expect(screen.getByRole("heading", { level: 2, name: "Clinical" })).toBeTruthy();
  });
});

describe("two-pane tablet rail", () => {
  function renderRail(overrides: Partial<Parameters<typeof TwoPaneSideRail>[0]> = {}) {
    const props = {
      identity: deriveSidebarIdentity("alex.morgan@example.org"),
      side: "work" as const,
      workAvailable: true,
      showAccountLibrary: true,
      onOpenMenu: vi.fn(),
      onOpenSettings: vi.fn(),
      ...overrides,
    };
    return { ...render(<TwoPaneSideRail {...props} />), props };
  }

  it("lights the page's side and opens the menu on Clinical, Work or the reader's own pane", () => {
    const { props } = renderRail();
    const rail = screen.getByRole("navigation", { name: "Menu" });
    const work = within(rail).getByRole("button", { name: "Work menu" });
    expect(work.getAttribute("data-current")).toBe("true");
    expect(work.getAttribute("aria-haspopup")).toBe("dialog");
    expect(work.hasAttribute("aria-pressed")).toBe(false);

    fireEvent.click(within(rail).getByRole("button", { name: "Clinical menu" }));
    expect(props.onOpenMenu).toHaveBeenLastCalledWith("clinical");
    fireEvent.click(work);
    expect(props.onOpenMenu).toHaveBeenLastCalledWith("work");
    fireEvent.click(screen.getByTestId("two-pane-rail-you"));
    expect(props.onOpenMenu).toHaveBeenLastCalledWith("you");
  });

  it("links My Day and the work side's Saved page, and runs Settings and Appearance in place", () => {
    const { props } = renderRail();
    expect(screen.getByTestId("two-pane-rail-my-day").getAttribute("href")).toBe("/my-day");
    expect(screen.getByTestId("two-pane-rail-saved").getAttribute("href")).toBe("/my-day/favourites");

    const appearance = screen.getByTestId("two-pane-rail-appearance");
    const before = appearance.getAttribute("aria-label");
    fireEvent.click(appearance);
    expect(appearance.getAttribute("aria-label")).not.toBe(before);

    fireEvent.click(screen.getByTestId("two-pane-rail-settings"));
    expect(props.onOpenSettings).toHaveBeenCalledOnce();
  });

  it("shows only the clinical side for readers without the new work mode", () => {
    renderRail({ side: "work", workAvailable: false, hideOnDesktop: true });
    const rail = screen.getByTestId("two-pane-rail");
    expect(rail.getAttribute("data-hide-desktop")).toBe("true");
    expect(screen.getByTestId("two-pane-rail-clinical").getAttribute("data-current")).toBe("true");
    expect(screen.queryByTestId("two-pane-rail-work")).toBeNull();
    expect(screen.queryByTestId("two-pane-rail-reminders")).toBeNull();
    expect(screen.queryByTestId("two-pane-rail-my-day")).toBeNull();
    expect(screen.getByTestId("two-pane-rail-saved").getAttribute("href")).toBe("/favourites");
  });
});
