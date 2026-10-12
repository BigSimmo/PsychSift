import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FilterHighlightNote, FilterNotMatchingHeading } from "@/components/clinical-dashboard/filter-highlight";

describe("FilterHighlightNote", () => {
  it("keeps an empty polite live region mounted while no filter is on, so turning one on is heard", () => {
    const onClear = vi.fn();
    const view = render(<FilterHighlightNote active={false} highlighted={0} total={10} onClear={onClear} />);

    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toBeEmptyDOMElement();
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();

    view.rerender(<FilterHighlightNote active highlighted={4} total={10} onClear={onClear} />);
    // Same node, new content: the announcement path a screen reader follows.
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent("4 of 10 highlighted, all rows stay");
  });

  it("offers a 48px Clear that clears only through its callback", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(<FilterHighlightNote active highlighted={2} total={5} onClear={onClear} testId="note" />);

    const clear = within(screen.getByTestId("note")).getByRole("button", { name: "Clear" });
    // The shared Button face: 48px tall (min-h-tap) and, here, 48px wide too.
    expect(clear.className).toContain("min-h-tap");
    expect(clear.className).toContain("min-w-tap");
    await user.click(clear);
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe("FilterNotMatchingHeading", () => {
  it("names the group and its count, muted by token rather than opacity", () => {
    render(<FilterNotMatchingHeading label="Not emergent" count={119} level={2} />);

    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveTextContent("Not emergent · 119");
    expect(heading.className).toContain("text-[color:var(--text-muted)]");
    expect(heading.className).not.toMatch(/opacity/);
  });
});
