import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { installMatchMediaStub } from "./setup/jsdom.setup";

import {
  ResultFilterSheet,
  resultFilterFacetGroup,
  resultFilterGroup,
  type ResultFilterOption,
} from "@/components/search/ResultFilterSheet";

afterEach(() => {
  cleanup();
});

describe("filter contract and density rendering", () => {
  it("renders facet groups with <= 5 UNCOUNTED options as compact wrapping chips", () => {
    const onToggle = vi.fn();
    const group = resultFilterFacetGroup({
      id: "small-facet",
      label: "Category",
      selected: new Set(["a"]),
      options: [
        { value: "a", label: "Option A" },
        { value: "b", label: "Option B" },
        { value: "c", label: "Option C" },
      ],
      onToggle,
    });

    render(
      <ResultFilterSheet
        open={true}
        onClose={vi.fn()}
        panelId="small-filter-panel"
        testId="small-filter-panel"
        title="Filter results"
        groups={[group]}
      />,
    );

    const buttonA = screen.getByRole("button", { name: /^Option A/ });
    expect(buttonA).toHaveAttribute("aria-pressed", "true");
    expect(buttonA.className).toContain("inline-flex");
    expect(buttonA.className.split(/\s+/)).not.toContain("w-full");
    expect(buttonA.className).toContain("min-h-tap");
    expect(buttonA).toHaveAttribute("data-choice-chip", "true");
  });

  // A chip carrying a count is wide enough that four of them wrap one per line
  // and leave most of each row empty — documents' Source status (4 options) and
  // Clinical validation (3) were exactly that. Counted groups of 2–5 therefore
  // use the row renderer in two columns instead. See docs/filter-contract.md §5.
  it("renders facet groups with 2–5 COUNTED options as full-width two-column choices", () => {
    const onToggle = vi.fn();
    const group = resultFilterFacetGroup({
      id: "counted-facet",
      label: "Source status",
      selected: new Set(["current"]),
      options: [
        { value: "current", label: "Current", hint: "12 loaded sources", hintLabel: "12" },
        { value: "review_due", label: "Review due", hint: "3 loaded sources", hintLabel: "3" },
        { value: "outdated", label: "Outdated", hint: "1 loaded source", hintLabel: "1" },
        { value: "unknown", label: "Unknown", hint: "0 loaded sources", hintLabel: "0" },
      ],
      onToggle,
    });

    render(
      <ResultFilterSheet
        open={true}
        onClose={vi.fn()}
        panelId="counted-filter-panel"
        testId="counted-filter-panel"
        title="Filter documents"
        groups={[group]}
      />,
    );

    const groupEl = screen.getByRole("group", { name: "Source status" });
    // Two-up only where a column can hold a label; the narrowest phones stay
    // single-column rather than truncating one.
    expect(groupEl.className).toContain("grid-cols-1");
    expect(groupEl.className).toContain("min-[380px]:grid-cols-2");

    const current = screen.getByRole("button", { name: /^Current/ });
    expect(current.className).toContain("w-full");
    expect(current.className).toContain("justify-between");
    // The selection-system floor stays 48px at every breakpoint.
    expect(current.className).toContain("min-h-tap");
    expect(current.className).not.toContain("sm:min-h-10");
    expect(current).toHaveAttribute("data-choice-chip", "true");

    // The announced name keeps the unit; only the visible column is shortened.
    expect(current).toHaveAccessibleName("Current (12 loaded sources)");
    expect(current).toHaveTextContent(/^Current12$/);
  });

  it("renders facet groups with 6–20 options as dense full-width vertical list with right-aligned counts", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const options: ResultFilterOption<string>[] = Array.from({ length: 9 }, (_, i) => ({
      value: `option-${i + 1}`,
      label: `Domain ${i + 1}`,
      hint: `${(i + 1) * 2}`,
    }));

    const group = resultFilterFacetGroup({
      id: "dense-domains",
      label: "Domains",
      selected: new Set(["option-2"]),
      options,
      onToggle,
    });

    render(
      <ResultFilterSheet
        open={true}
        onClose={vi.fn()}
        panelId="dense-filter-panel"
        testId="dense-filter-panel"
        title="Filter mechanisms"
        groups={[group]}
      />,
    );

    const groupEl = screen.getByRole("group", { name: "Domains" });
    expect(groupEl).toBeInTheDocument();
    expect(groupEl.className).toContain("grid");

    const buttons = within(groupEl).getAllByRole("button");
    expect(buttons).toHaveLength(9);

    const firstButton = buttons[0];
    expect(firstButton.className).toContain("w-full");
    expect(firstButton.className).toContain("justify-between");
    expect(firstButton.className).toContain("min-h-tap");
    expect(firstButton).toHaveAttribute("aria-pressed", "false");

    const secondButton = buttons[1];
    expect(secondButton).toHaveAttribute("aria-pressed", "true");

    await user.click(firstButton);
    expect(onToggle).toHaveBeenCalledWith("option-1");
  });

  it("adds find-a-filter and disclosure header when total facet options exceed 20 or facet groups exceed 3", () => {
    const onToggle = vi.fn();
    const groups = Array.from({ length: 4 }, (_, groupIndex) =>
      resultFilterFacetGroup({
        id: `facet-group-${groupIndex + 1}`,
        label: `Group ${groupIndex + 1}`,
        selected: new Set<string>(),
        options: [
          { value: `g${groupIndex}-1`, label: `Item 1`, hint: "1" },
          { value: `g${groupIndex}-2`, label: `Item 2`, hint: "2" },
        ],
        onToggle,
      }),
    );

    render(
      <ResultFilterSheet
        open={true}
        onClose={vi.fn()}
        panelId="super-dense-panel"
        testId="super-dense-panel"
        title="Filter services"
        groups={groups}
      />,
    );

    expect(screen.getByTestId("super-dense-panel-find")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Group 1/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("handles roving radio selection for lens groups", () => {
    const onChange = vi.fn();
    const lensGroup = resultFilterGroup({
      id: "view-lens",
      label: "View",
      value: "all",
      options: [
        { value: "all", label: "All items" },
        { value: "presentations", label: "Presentations" },
        { value: "diagnoses", label: "Diagnoses" },
      ],
      onChange,
    });

    render(
      <ResultFilterSheet
        open={true}
        onClose={vi.fn()}
        panelId="lens-panel"
        testId="lens-panel"
        title="Filter view"
        groups={[lensGroup]}
      />,
    );

    const radioAll = screen.getByRole("radio", { name: "All items" });
    expect(radioAll).toHaveAttribute("aria-checked", "true");
    expect(radioAll).toHaveAttribute("tabindex", "0");

    const radioPres = screen.getByRole("radio", { name: "Presentations" });
    expect(radioPres).toHaveAttribute("aria-checked", "false");
    expect(radioPres).toHaveAttribute("tabindex", "-1");

    fireEvent.click(radioPres);
    expect(onChange).toHaveBeenCalledWith("presentations");
  });
});

describe("presentation: rail versus anchored panel (docs/filter-contract.md §5b)", () => {
  const lens = (onChange = vi.fn()) =>
    resultFilterGroup({
      id: "kind",
      label: "Show",
      value: "all",
      options: [
        { value: "all", label: "All", hint: "8" },
        { value: "presentations", label: "Presentations", hint: "2" },
      ],
      onChange,
    });

  function renderWithAnchor(overrides: { onClose?: () => void } = {}) {
    const anchor = document.createElement("button");
    anchor.textContent = "Filter";
    document.body.append(anchor);
    const anchorRef = { current: anchor };
    const result = render(
      <ResultFilterSheet
        open={true}
        onClose={overrides.onClose ?? vi.fn()}
        anchorRef={anchorRef}
        panelId="anchored-panel"
        testId="anchored-panel"
        title="Filter differentials"
        groups={[lens()]}
      />,
    );
    return { anchor, ...result };
  }

  it("keeps the modal rail when a mode passes no anchor, so the other call sites are unchanged", () => {
    render(
      <ResultFilterSheet
        open={true}
        onClose={vi.fn()}
        panelId="rail-panel"
        testId="rail-panel"
        title="Filter results"
        groups={[lens()]}
      />,
    );

    // `Sheet` is the modal presentation: it traps focus and inerts the page
    // behind it, which is what `aria-modal` announces.
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  });

  it("opens a NON-modal panel when a mode names an anchor, so the results stay reachable", () => {
    renderWithAnchor();

    const panel = screen.getByTestId("anchored-panel");
    expect(panel).toHaveAttribute("role", "dialog");
    // The whole point of leaving the rail behind: the list being filtered is
    // still readable and operable underneath.
    expect(panel).not.toHaveAttribute("aria-modal");
    // The trigger's `aria-controls` points here, so the id has to survive the
    // change of container.
    expect(panel).toHaveAttribute("id", "anchored-panel");
    expect(within(panel).getByRole("radio", { name: "All (8)" })).toBeInTheDocument();
  });

  it("keeps the unplaced filter inert and unfocused, then makes its controls reachable after placement", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    // jsdom does not implement the browser's inert focus exclusion.
    const focus = HTMLElement.prototype.focus;
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement, options) {
      if (!this.closest("[inert]")) focus.call(this, options);
    });
    renderWithAnchor();
    const panel = screen.getByTestId("anchored-panel");
    expect(panel).toHaveAttribute("inert");
    expect(panel).not.toHaveFocus();
    expect(focusSpy).not.toHaveBeenCalled();
    within(panel).getByRole("radio", { name: "All (8)", hidden: true }).focus();
    expect(panel).not.toContainElement(document.activeElement as HTMLElement);

    act(() => {
      for (const callback of frames.splice(0)) callback(0);
    });
    expect(panel).not.toHaveAttribute("inert");
    expect(panel).toHaveFocus();
    await userEvent.setup().tab();
    expect(panel).toContainElement(document.activeElement as HTMLElement);
    expect(panel).not.toHaveAttribute("aria-modal");
  });

  it("falls back to the bottom sheet on a phone even when an anchor is supplied", () => {
    // 400% zoom lands here too: it reduces the viewport to roughly 320 CSS px,
    // so the anchored panel never has to survive that width.
    installMatchMediaStub(true);
    renderWithAnchor();

    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  });

  it("dismisses on Escape and on a pointer outside the panel", () => {
    const onClose = vi.fn();
    renderWithAnchor({ onClose });

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("treats a pointer inside the panel, or on the trigger itself, as not a dismissal", () => {
    const onClose = vi.fn();
    const { anchor } = renderWithAnchor({ onClose });

    fireEvent.pointerDown(screen.getByTestId("anchored-panel"));
    // The anchor is in the dismissable set so the trigger can close the panel
    // by its own toggle rather than being closed underneath itself first.
    fireEvent.pointerDown(anchor);
    expect(onClose).not.toHaveBeenCalled();
  });
});
