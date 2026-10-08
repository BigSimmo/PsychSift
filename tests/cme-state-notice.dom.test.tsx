import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({ AccountSetupDialog: () => null }));

import { CmeStateNotice } from "@/components/cme/cme-state-notice";

describe("CPD states", () => {
  it("says offline plainly, as the shared work-mode state with a quiet Try again and no figures", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { container } = render(<CmeStateNotice state="offline" year={2026} onRetry={onRetry} />);
    const offline = screen.getByTestId("cme-offline");
    expect(offline).toHaveTextContent(
      "Your CPD record isn’t kept on this phone. It opens again as soon as you’re back online.",
    );
    expect(offline).toHaveAttribute("role", "status");
    expect(offline).toHaveAttribute("data-work-state", "offline");
    const retry = within(offline).getByRole("button", { name: "Try again" });
    // The kit's 48 px button, white with a line rather than the area colour.
    expect(retry).toHaveClass("work-button");
    expect(retry).toHaveAttribute("data-variant", "secondary");
    expect(retry).toHaveAttribute("data-testid", "cme-state-retry");
    await user.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
    // Grey outlines stand where the figures would be: never a number, so never a zero.
    expect(screen.getByTestId("cme-state-placeholder")).toHaveAttribute("aria-hidden", "true");
    expect(container.textContent).not.toMatch(/\d/);
  });

  it.each(["error", "unavailable"] as const)(
    "shows %s as records that did not load: amber badge, no numbers, nothing changed",
    async (state) => {
      const user = userEvent.setup();
      const onRetry = vi.fn();
      const { container } = render(<CmeStateNotice state={state} year={2026} onRetry={onRetry} />);
      const note = screen.getByTestId("cme-error");
      expect(note).toHaveTextContent("Your CPD records did not load");
      expect(note).toHaveTextContent("Nothing was changed or lost. Check your connection, then try again.");
      expect(note).toHaveAttribute("role", "alert");
      expect(note.querySelector(".work-empty__badge")).toHaveAttribute("data-tone", "amber");
      expect(screen.getByTestId("cme-state-placeholder")).toBeInTheDocument();
      expect(container).toHaveTextContent(
        "No hours or counts are shown until your records load, so nothing here can look like a zero.",
      );
      expect(container.textContent).not.toMatch(/\d/);
      await user.click(screen.getByRole("button", { name: "Try again" }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    },
  );

  it("tells a signed-out doctor the record is theirs alone", () => {
    render(<CmeStateNotice state="signed-out" year={2026} />);
    expect(screen.getByTestId("cme-signed-out")).toHaveTextContent(
      "It is linked to your account only, and it is not shared with your health service.",
    );
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByTestId("cme-state-placeholder")).toBeNull();
  });

  it("shows a year with no confirmed target as one line and where to start, with no dark button", () => {
    const { container } = render(<CmeStateNotice state="unconfigured" year={2026} />);
    expect(screen.getByTestId("cme-unconfigured")).toHaveTextContent(
      "You have not confirmed a yearly target for 2026.",
    );
    expect(screen.getByRole("link", { name: "Set up your year" })).toHaveAttribute("href", "/cme/setup?year=2026");
    expect(container.innerHTML).not.toContain("bg-[color:var(--command)]");
    expect(container.innerHTML).not.toContain("--warning");
  });

  it("keeps the page's own heading above the state", () => {
    render(<CmeStateNotice state="offline" year={2026} heading="Log" onRetry={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Log" })).toBeInTheDocument();
  });
});
