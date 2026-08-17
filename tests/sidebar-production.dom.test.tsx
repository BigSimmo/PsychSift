/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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

describe("production Clinical Guide sidebar", () => {
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
      "Answer",
      "Documents",
      "Services",
      "Medication",
      "Factsheets",
      "Tools",
    ]);
    expect(navigation.getAllByRole("button").at(-1)).toHaveAccessibleName("More modes");

    await user.click(screen.getByRole("button", { name: "Search Clinical Guide" }));
    await waitFor(() => expect(props.onOpenSearch).toHaveBeenCalledOnce());
  });

  it("pins, unpins, reorders, and persists shortcuts while keeping the editor visually neutral", async () => {
    const user = userEvent.setup();
    renderSidebar();

    const edit = screen.getByRole("button", { name: "Edit" });
    await user.click(edit);
    const editor = screen.getByRole("dialog", { name: "More modes" });

    expect(within(editor).queryByText(/\d+ pinned/i)).not.toBeInTheDocument();
    await user.click(within(editor).getByRole("button", { name: "Unpin Documents" }));
    await user.click(within(editor).getByRole("button", { name: "Pin Forms" }));
    await user.click(within(editor).getByRole("button", { name: "Move Forms up" }));

    expect(JSON.parse(window.localStorage.getItem(SIDEBAR_PINS_STORAGE_KEY) ?? "[]")).toEqual([
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
