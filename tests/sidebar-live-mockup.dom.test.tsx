import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { SidebarLiveMockupPage } from "@/components/sidebar-live-mockup";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.classList.remove("dark", "theme-transitioning");
});

describe("live sidebar mockup", () => {
  it("puts three recent chats before editable shortcuts and keeps More modes last", async () => {
    const user = userEvent.setup();
    render(<SidebarLiveMockupPage />);

    const sections = screen.getByTestId("sidebar-sections");
    expect(
      within(sections)
        .getAllByRole("heading", { level: 2 })
        .map((heading) => heading.textContent?.trim()),
    ).toEqual(["Shortcuts"]);
    expect(within(sections).queryByRole("heading", { name: "Recent chats" })).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("recent-chats")).getAllByRole("button", { name: /More options for/ }),
    ).toHaveLength(3);

    const pinned = screen.getByTestId("pinned-modes");
    expect(
      within(pinned)
        .getAllByRole("button")
        .map((button) => button.textContent?.trim()),
    ).toEqual(["Answer", "Documents", "Services", "Medication", "Factsheets", "Tools", "More modes"]);

    const editShortcuts = within(sections).getByRole("button", { name: "Edit shortcuts" });
    await user.click(editShortcuts);
    const launcher = screen.getByRole("dialog", { name: "More modes" });
    expect(within(launcher).queryByText("6 pinned")).not.toBeInTheDocument();
    await user.click(within(launcher).getByRole("button", { name: "Pin Guidelines" }));
    expect(within(launcher).queryByText("7 pinned")).not.toBeInTheDocument();
    await user.click(within(launcher).getByRole("button", { name: "Move Guidelines up" }));
    await user.click(within(launcher).getByRole("button", { name: "Close more modes" }));

    expect(within(pinned).getByRole("button", { name: "Guidelines" })).toBeInTheDocument();
    expect(within(pinned).getAllByRole("button").at(-1)).toHaveAccessibleName("More modes");
    await waitFor(() => expect(editShortcuts).toHaveFocus());
  });

  it("uses the live theme owner and opens universal search with Ctrl K", async () => {
    const user = userEvent.setup();
    render(<SidebarLiveMockupPage />);

    await user.click(screen.getAllByRole("button", { name: /Appearance/ })[0]!);
    const appearanceMenu = screen.getByRole("menu", { name: "Appearance" });
    await user.click(within(appearanceMenu).getByRole("menuitemradio", { name: /Dark/ }));
    expect(document.documentElement).toHaveClass("dark");

    await user.keyboard("{Control>}k{/Control}");
    const searchDialog = screen.getByRole("dialog", { name: "Search Clinical Guide" });
    await waitFor(() =>
      expect(within(searchDialog).getByRole("searchbox", { name: "Search everything" })).toHaveFocus(),
    );
    await user.type(within(searchDialog).getByRole("searchbox", { name: "Search everything" }), "guidelines");
    await user.click(within(searchDialog).getByRole("button", { name: /Guidelines/ }));

    expect(screen.getByRole("heading", { level: 1, name: "Guidelines" })).toBeInTheDocument();
  });

  it("makes popup menus keyboard-complete and returns focus to their triggers", async () => {
    const user = userEvent.setup();
    render(<SidebarLiveMockupPage />);

    const chatTrigger = screen.getByRole("button", { name: "More options for Medication interaction check" });
    await user.click(chatTrigger);
    const chatMenu = screen.getByRole("menu", { name: "Options for Medication interaction check" });
    await waitFor(() => expect(within(chatMenu).getByRole("menuitem", { name: "Pin chat" })).toHaveFocus());
    await user.keyboard("{ArrowDown}");
    expect(within(chatMenu).getByRole("menuitem", { name: "Rename" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(within(chatMenu).getByRole("menuitem", { name: "Delete" })).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(chatTrigger).toHaveFocus());

    const appearanceTrigger = screen.getByRole("button", { name: /Appearance/ });
    appearanceTrigger.focus();
    await user.keyboard("{ArrowDown}");
    const appearanceMenu = screen.getByRole("menu", { name: "Appearance" });
    await waitFor(() => expect(within(appearanceMenu).getByRole("menuitemradio", { name: /Light/ })).toHaveFocus());
    await user.keyboard("{ArrowUp}");
    expect(within(appearanceMenu).getByRole("menuitemradio", { name: /Auto/ })).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(appearanceTrigger).toHaveFocus());
  });
});
