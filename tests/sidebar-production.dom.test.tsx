/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClinicalSidebarContent, deriveSidebarIdentity } from "@/components/clinical-dashboard/ClinicalSidebar";
import { SIDEBAR_PINS_STORAGE_KEY } from "@/components/clinical-dashboard/use-sidebar-pins";
import { THEME_COOKIE_NAME, THEME_STORAGE_KEY } from "@/lib/theme";

function clearThemeCookie() {
  document.cookie = `${THEME_COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
}

function renderSidebar(overrides: Partial<Parameters<typeof ClinicalSidebarContent>[0]> = {}) {
  const props = {
    recentQueries: [
      "Medication interaction check",
      "Referral options for ADHD",
      "Bipolar maintenance guidance",
      "Sleep assessment options",
    ],
    identity: deriveSidebarIdentity(null),
    activeMode: "answer" as const,
    onNewChat: vi.fn(),
    onPickRecent: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenAccount: vi.fn(),
    onOpenSearch: vi.fn(),
    ...overrides,
  };
  return { ...render(<ClinicalSidebarContent {...props} />), props };
}

beforeEach(() => {
  window.localStorage.clear();
  clearThemeCookie();
  document.documentElement.classList.remove("dark", "theme-transitioning");
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  clearThemeCookie();
  document.documentElement.classList.remove("dark", "theme-transitioning");
});

describe("production PsychSift sidebar", () => {
  it("prefetches Applications only when its Tools shortcut receives pointer or focus intent", () => {
    const onPrefetchApplications = vi.fn();
    renderSidebar({ onPrefetchApplications });

    const toolsLink = screen.getByRole("link", { name: "Tools" });
    expect(onPrefetchApplications).not.toHaveBeenCalled();

    fireEvent.pointerEnter(screen.getByRole("link", { name: "Answer" }));
    expect(onPrefetchApplications).not.toHaveBeenCalled();

    fireEvent.pointerEnter(toolsLink);
    expect(onPrefetchApplications).toHaveBeenCalledTimes(1);

    fireEvent.focus(toolsLink);
    expect(onPrefetchApplications).toHaveBeenCalledTimes(2);
  });

  it("shows three unheaded recents before editable shortcuts and opens the shared search owner", async () => {
    const user = userEvent.setup();
    const { props } = renderSidebar();

    expect(screen.queryByRole("heading", { name: "Recent chats" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Medication interaction check" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Referral options for ADHD" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Bipolar maintenance guidance" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Sleep assessment options" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "View all chats" }));
    expect(screen.getByRole("button", { name: "Sleep assessment options" })).toBeVisible();

    const navigation = within(screen.getByRole("navigation", { name: "Pinned shortcuts" }));
    expect(navigation.getAllByRole("link").map((link) => link.textContent?.trim())).toEqual([
      "My Day",
      "Answer",
      "Documents",
      "Services",
      "Medication",
      "Factsheets",
      "Tools",
    ]);
    expect(navigation.getByRole("link", { name: "Medication" })).toHaveAttribute("href", "/?mode=prescribing");
    expect(navigation.getAllByRole("button").at(-1)).toHaveAccessibleName("More modes");

    await user.click(screen.getByRole("button", { name: "Search PsychSift" }));
    await waitFor(() => expect(props.onOpenSearch).toHaveBeenCalledOnce());
  });

  it("pins, unpins, reorders, and persists shortcuts while keeping the editor visually neutral", async () => {
    const user = userEvent.setup();
    renderSidebar();

    const edit = screen.getByRole("button", { name: "Edit" });
    await user.click(edit);
    const editor = screen.getByRole("dialog", { name: "More modes" });

    expect(within(editor).queryByText(/\d+ pinned/i)).not.toBeInTheDocument();
    expect(within(editor).getByRole("button", { name: "Pin Sources" })).toBeVisible();
    await user.click(within(editor).getByRole("button", { name: "Unpin Documents" }));
    await user.click(within(editor).getByRole("button", { name: "Pin Forms" }));
    await user.click(within(editor).getByRole("button", { name: "Move Forms up" }));

    expect(JSON.parse(window.localStorage.getItem(SIDEBAR_PINS_STORAGE_KEY) ?? "[]")).toEqual([
      "my-day",
      "answer",
      "services",
      "prescribing",
      "factsheets",
      "forms",
      "tools",
    ]);

    await user.click(within(editor).getByRole("button", { name: "Close more modes" }));
    await waitFor(() => expect(edit).toHaveFocus());
    const navigation = within(screen.getByRole("navigation", { name: "Pinned shortcuts" }));
    expect(navigation.queryByRole("link", { name: "Documents" })).not.toBeInTheDocument();
    expect(navigation.getAllByRole("link").map((link) => link.textContent?.trim())).toEqual([
      "My Day",
      "Answer",
      "Services",
      "Medication",
      "Factsheets",
      "Forms",
      "Tools",
    ]);
    expect(navigation.getAllByRole("button").at(-1)).toHaveAccessibleName("More modes");
  });

  it("switches Light, Dark, and Auto through the established theme owner with keyboard focus return", async () => {
    const user = userEvent.setup();
    renderSidebar();

    const appearance = screen.getByRole("button", { name: /Appearance\s*Auto/ });
    appearance.focus();
    await user.keyboard("{ArrowDown}");
    const menu = screen.getByRole("menu", { name: "Appearance" });
    await waitFor(() => expect(within(menu).getByRole("menuitemradio", { name: /Light/ })).toHaveFocus());
    await user.keyboard("{ArrowDown}");
    expect(within(menu).getByRole("menuitemradio", { name: /Dark/ })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement).toHaveClass("dark");
    await waitFor(() => expect(appearance).toHaveFocus());
  });
});

describe("sidebar shortcuts select modes in place", () => {
  /**
   * jsdom cannot navigate, so a click that correctly falls through to the link
   * logs "Not implemented: navigation". Swallow it after the sidebar's own
   * handler has run — the listener sits on `document`, so the link's
   * `defaultPrevented` reading inside that handler is unaffected.
   */
  function suppressJsdomNavigation() {
    const listener = (event: Event) => event.preventDefault();
    document.addEventListener("click", listener);
    return () => document.removeEventListener("click", listener);
  }

  it("hands a plain click on a shared-home shortcut to onSelectMode instead of the router", () => {
    const onSelectMode = vi.fn();
    renderSidebar({ onSelectMode });

    const documentsLink = screen.getByRole("link", { name: "Documents" });
    expect(documentsLink).toHaveAttribute("href", "/?mode=documents");
    const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    documentsLink.dispatchEvent(clickEvent);

    expect(onSelectMode).toHaveBeenCalledTimes(1);
    expect(onSelectMode).toHaveBeenCalledWith("documents");
    expect(clickEvent.defaultPrevented).toBe(true);
  });

  it("keeps native link semantics for modified clicks", () => {
    const onSelectMode = vi.fn();
    renderSidebar({ onSelectMode });
    const restore = suppressJsdomNavigation();

    const documentsLink = screen.getByRole("link", { name: "Documents" });
    fireEvent.click(documentsLink, { ctrlKey: true });
    fireEvent.click(documentsLink, { metaKey: true });
    fireEvent.click(documentsLink, { shiftKey: true });
    fireEvent.click(documentsLink, { button: 1 });

    expect(onSelectMode).not.toHaveBeenCalled();
    restore();
  });

  it("leaves standalone destinations as ordinary links", () => {
    const onSelectMode = vi.fn();
    renderSidebar({ onSelectMode, showAccountLibrary: true });
    const restore = suppressJsdomNavigation();

    fireEvent.click(screen.getByRole("link", { name: "Tools" }));
    fireEvent.click(screen.getByRole("link", { name: "Favourites" }));

    expect(onSelectMode).not.toHaveBeenCalled();
    restore();
  });

  it("selects More modes entries in place too, and still closes the editor", async () => {
    const onSelectMode = vi.fn();
    const onNavigate = vi.fn();
    renderSidebar({ onSelectMode, onNavigate });

    await userEvent.click(screen.getByRole("button", { name: /More modes/ }));
    const editor = await screen.findByRole("dialog");
    const dsmLink = within(editor).getByRole("link", { name: /DSM/ });
    expect(dsmLink).toHaveAttribute("href", "/?mode=dsm");
    fireEvent.click(dsmLink);

    expect(onSelectMode).toHaveBeenCalledWith("dsm");
    expect(onNavigate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("stays a plain link when no in-place switch is offered", () => {
    renderSidebar();
    const restore = suppressJsdomNavigation();
    const documentsLink = screen.getByRole("link", { name: "Documents" });
    const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    // next/link handles the click itself outside an app router; the sidebar
    // must not have claimed it first.
    documentsLink.dispatchEvent(clickEvent);
    expect(documentsLink).toHaveAttribute("href", "/?mode=documents");
    restore();
  });
});
