/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deriveSidebarIdentity } from "@/components/clinical-dashboard/ClinicalSidebar";
import { TwoPaneSideMenu, type TwoPaneSideMenuProps } from "@/components/work-frame/two-pane-side-menu";

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
  "Starting dose of quetiapine in older adults",
];

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
    onOpenSearch: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenAccount: vi.fn(),
    onSignOut: vi.fn(),
    ...overrides,
  };
  return { ...render(<TwoPaneSideMenu {...props} />), props };
}

beforeEach(() => {
  window.localStorage.clear();
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
  it("opens on Clinical with New question, five recent questions and the look-up shortcuts", () => {
    const { props } = renderMenu();
    const menu = screen.getByTestId("two-pane-side-menu");
    expect(within(menu).getByRole("heading", { level: 2, name: "Clinical" })).toBeTruthy();
    expect(screen.getByTestId("two-pane-menu-clinical").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: recent[4] })).toBeTruthy();
    expect(screen.queryByRole("button", { name: recent[5] })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "All questions" }));
    expect(screen.getByRole("button", { name: recent[5] })).toBeTruthy();

    fireEvent.click(screen.getByTestId("two-pane-menu-new-question"));
    expect(props.onNewChat).toHaveBeenCalledOnce();
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("switches to Work, listing the areas, and back", () => {
    renderMenu({ currentArea: "rost" });
    fireEvent.click(screen.getByTestId("two-pane-menu-work"));
    expect(screen.getByRole("heading", { level: 2, name: "Work" })).toBeTruthy();
    expect(screen.getByTestId("two-pane-menu-area-rost").getAttribute("aria-current")).toBe("true");
    expect(screen.getByTestId("two-pane-menu-area-day")).toBeTruthy();
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
  });

  it("opens Settings from the strip", () => {
    const { props } = renderMenu();
    fireEvent.click(screen.getByTestId("two-pane-menu-settings"));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.onOpenSettings).toHaveBeenCalledOnce();
  });

  it("asks before signing out from the initials pane", () => {
    const { props } = renderMenu();
    fireEvent.click(screen.getByTestId("two-pane-menu-you"));
    expect(screen.getByRole("heading", { level: 2, name: "You" })).toBeTruthy();
    fireEvent.click(screen.getByTestId("two-pane-menu-sign-out"));
    expect(props.onSignOut).not.toHaveBeenCalled();
    expect(screen.getByText(/This clears everything kept on this phone/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("two-pane-menu-sign-out-confirm"));
    expect(props.onSignOut).toHaveBeenCalledOnce();
  });
});
