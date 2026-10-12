import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const announce = vi.hoisted(() => vi.fn());
vi.mock("@/components/ui/live-announcer", () => ({ announce }));

import { FilterHighlightNote, FilterNotMatchingHeading } from "@/components/clinical-dashboard/filter-highlight";

describe("FilterHighlightNote", () => {
  it("shows nothing while no filter is on, and speaks each change through the shared announcer", () => {
    announce.mockClear();
    const onClear = vi.fn();
    const view = render(
      <FilterHighlightNote active={false} highlighted={0} total={10} onClear={onClear} testId="note" />,
    );

    expect(screen.queryByTestId("note")).toBeNull();
    expect(announce).not.toHaveBeenCalled();

    view.rerender(<FilterHighlightNote active highlighted={4} total={10} onClear={onClear} testId="note" />);
    expect(screen.getByTestId("note")).toHaveTextContent("4 of 10 highlighted, all rows stay");
    // The note is plain text: no live region of its own, so it is spoken once.
    expect(screen.queryByRole("status")).toBeNull();
    expect(announce).toHaveBeenLastCalledWith("4 of 10 highlighted, all rows stay");

    view.rerender(<FilterHighlightNote active highlighted={2} total={10} onClear={onClear} testId="note" />);
    expect(announce).toHaveBeenLastCalledWith("2 of 10 highlighted, all rows stay");
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
