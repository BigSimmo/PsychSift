import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Search } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { AsyncButton, EmptyState, ToggleSwitch } from "@/components/ui-primitives";

describe("EmptyState", () => {
  it("keeps recovery actions inside an announced state surface", () => {
    render(
      <EmptyState
        icon={Search}
        title="No matching sources"
        body="Try a more specific question."
        live="polite"
        testId="recovery-state"
        actions={<button type="button">Rephrase question</button>}
      />,
    );

    const state = screen.getByTestId("recovery-state");
    expect(state).toHaveAttribute("role", "status");
    expect(screen.getByRole("button", { name: "Rephrase question" })).toBeVisible();
  });

  it("uses an assertive announcement for a dynamic failure", () => {
    render(<EmptyState title="Answer unavailable" body="Please try again." live="assertive" />);

    expect(screen.getByRole("alert")).toHaveTextContent("Answer unavailable");
  });

  // `headingLevel` is opt-in on purpose: a state nested inside a card that
  // already owns its region's heading would otherwise inject an outline level
  // the page never declared. Both branches are pinned because the default is
  // what every existing call site relies on.
  it("renders the title as a paragraph unless a heading level is asked for", () => {
    render(<EmptyState title="No matching documents" body="Try another term." />);

    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByText("No matching documents").tagName).toBe("P");
    expect(screen.getByText("No matching documents").closest("[role]")).toBeNull();
  });

  it("promotes the title to the requested heading level without losing the announcement", () => {
    render(<EmptyState title="No matching documents" body="Try another term." headingLevel={3} testId="docs-empty" />);

    const heading = screen.getByRole("heading", { level: 3, name: "No matching documents" });
    expect(heading.tagName).toBe("H3");
    expect(screen.getByTestId("docs-empty")).not.toHaveAttribute("role");
  });

  it("honours a level other than the default consumer's", () => {
    render(<EmptyState title="No diagnosis matches" headingLevel={2} />);

    expect(screen.getByRole("heading", { level: 2, name: "No diagnosis matches" })).toBeVisible();
  });
});

describe("AsyncButton", () => {
  it("announces pending work and blocks duplicate activation", () => {
    render(
      <AsyncButton busy busyLabel="Saving changes">
        Save
      </AsyncButton>,
    );

    const button = screen.getByRole("button", { name: "Saving changes" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("keeps its normal label and enabled state when idle", () => {
    render(
      <AsyncButton busy={false} busyLabel="Saving changes">
        Save
      </AsyncButton>,
    );

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-busy");
  });

  it("defaults to type=button after the props spread", () => {
    render(
      <AsyncButton busy={false} busyLabel="Saving">
        Save
      </AsyncButton>,
    );
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  it("preserves an explicit type=submit for form actions", () => {
    render(
      <AsyncButton type="submit" busy={false} busyLabel="Saving">
        Save
      </AsyncButton>,
    );
    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
  });
});

describe("ToggleSwitch", () => {
  it("requires a name when operable", async () => {
    const onToggle = vi.fn();
    render(<ToggleSwitch enabled={false} onToggle={onToggle} aria-label="Pregnancy" />);
    const toggle = screen.getByRole("switch", { name: "Pregnancy" });
    expect(toggle.className).toMatch(/min-h-tap/);
    expect(toggle.className).toMatch(/min-w-tap/);
    expect(toggle).toHaveClass("rounded-lg");
    expect(toggle).not.toHaveClass("rounded-full");
    expect(toggle.firstElementChild).toHaveClass("box-content", "border", "shadow-[var(--shadow-inset)]");
    await userEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("renders a non-interactive indicator without onToggle", () => {
    render(<ToggleSwitch enabled aria-label="Available" />);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Available: on" })).toBeInTheDocument();
  });

  it("moves the knob on transform, never left/right", () => {
    const { rerender } = render(<ToggleSwitch enabled={false} onToggle={() => undefined} aria-label="Notify" />);
    const offKnob = screen.getByRole("switch", { name: "Notify" }).querySelector("[aria-hidden]");
    expect(offKnob?.className).toMatch(/translate-x-0/);
    expect(offKnob?.className).not.toMatch(/\bright-1\b/);
    expect(offKnob?.className).toMatch(/\bleft-0\.5\b/);

    rerender(<ToggleSwitch enabled onToggle={() => undefined} aria-label="Notify" />);
    const onKnob = screen.getByRole("switch", { name: "Notify" }).querySelector("[aria-hidden]");
    expect(onKnob?.className).toMatch(/translate-x-5/);
    expect(onKnob?.className).not.toMatch(/\bright-1\b/);
  });
});
