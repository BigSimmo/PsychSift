import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DifferentialStreamPage } from "@/components/differentials/differential-stream-page";
import { buildDifferentialStreamModel } from "@/lib/differential-stream";
import { differentialDiagnosesCards, differentialPresentationsCards } from "@/lib/differentials";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/differentials/presentations",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("DifferentialStreamPage", () => {
  it("renders the presentations catalogue as a compact symptom-led pathway workspace", async () => {
    const user = userEvent.setup();
    render(<DifferentialStreamPage stream="presentations" />);

    expect(screen.getByRole("heading", { level: 1, name: "Presentations" })).toBeInTheDocument();
    expect(
      screen.getByText("Start with what is happening now, then open a pathway to compare likely causes."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("search-query-ribbon")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "All" })).toBeInTheDocument();
    await user.click(screen.getByTestId("differentials-stream-filter-trigger"));
    expect(screen.getByRole("radiogroup", { name: "Clinical urgency" })).toBeInTheDocument();
    expect(screen.getByText("High-priority presentation pathways")).toBeInTheDocument();
    expect(screen.queryByText("Differentials: Presentations")).not.toBeInTheDocument();

    const firstCard = differentialPresentationsCards[0];
    expect(firstCard).toBeTruthy();
    expect(screen.getByRole("button", { name: firstCard!.title })).toBeInTheDocument();
    // The title is the row's open link now; its name ends ", open pathway".
    expect(screen.getAllByRole("link", { name: /open pathway$/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/differential candidates?/).length).toBeGreaterThan(0);
  });

  it("carries the submitted query into a presentation pathway", () => {
    const firstCard = differentialPresentationsCards[0];
    expect(firstCard).toBeTruthy();

    render(<DifferentialStreamPage stream="presentations" query="acute confusion" />);

    const slug = firstCard!.href.split("/").at(-1) ?? "";
    expect(slug).toBeTruthy();
    const card = screen.getByTestId(`differential-stream-card-${slug}`);
    expect(within(card).getByRole("link", { name: /open pathway$/ })).toHaveAttribute(
      "href",
      `${firstCard!.href}?q=acute+confusion`,
    );
  });

  it("clears the urgency highlight when a safety-shelf target sits outside it", async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView);
    const model = buildDifferentialStreamModel("presentations", "");
    const safetyItem = model.safetyShelfIds
      .map((id) => model.items.find((item) => item.id === id))
      .find((item) => item?.status === "emergent");
    expect(safetyItem).toBeTruthy();

    const view = render(<DifferentialStreamPage stream="presentations" />);

    await user.click(screen.getByTestId("differentials-stream-filter-trigger"));
    const priorityGroup = screen.getByRole("radiogroup", { name: "Clinical urgency" });
    await user.click(within(priorityGroup).getByRole("radio", { name: /^Urgent/ }));
    expect(new URL(window.location.href).searchParams.get("priority")).toBe("urgent");
    view.rerender(<DifferentialStreamPage stream="presentations" />);
    // Filters highlight, never hide: the emergent target stays listed, under "Not urgent".
    expect(screen.getByTestId(`differential-stream-card-${safetyItem!.slug}`)).toHaveAttribute(
      "data-outside-filter",
      "true",
    );

    scrollIntoView.mockClear();
    await user.click(
      within(screen.getByTestId("differentials-stream-safety-shelf")).getByRole("button", {
        name: safetyItem!.title,
      }),
    );

    expect(new URL(window.location.href).searchParams.has("priority")).toBe(false);
    view.rerender(<DifferentialStreamPage stream="presentations" />);
    await waitFor(() =>
      expect(screen.getByTestId(`differential-stream-card-${safetyItem!.slug}`)).not.toHaveAttribute(
        "data-outside-filter",
      ),
    );
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "center" }));
  });

  it("filters presentations by priority and shared-candidate pathways", async () => {
    const user = userEvent.setup();
    const view = render(<DifferentialStreamPage stream="presentations" query="agitation" />);

    const initialCards = screen.getAllByTestId(/^differential-stream-card-/).length;
    await user.click(screen.getByTestId("differentials-stream-filter-trigger"));
    const priorityGroup = screen.getByRole("radiogroup", { name: "Clinical urgency" });
    await user.click(within(priorityGroup).getByRole("radio", { name: /^Emergent/ }));
    expect(new URL(window.location.href).searchParams.get("priority")).toBe("emergent");
    view.rerender(<DifferentialStreamPage stream="presentations" query="agitation" />);
    // Every row stays; the emergent ones come first and the rest sit under "Not emergent".
    const allCards = screen.getAllByTestId(/^differential-stream-card-/);
    expect(allCards).toHaveLength(initialCards);
    const emergentCards = allCards.filter((card) => card.dataset.outsideFilter !== "true");
    expect(emergentCards.length).toBeLessThan(initialCards);
    expect(emergentCards.every((card) => card.dataset.status === "emergent")).toBe(true);
    const outsideCards = allCards.filter((card) => card.dataset.outsideFilter === "true");
    expect(outsideCards.every((card) => card.dataset.status !== "emergent")).toBe(true);
    expect(allCards.indexOf(outsideCards[0]!)).toBeGreaterThan(allCards.indexOf(emergentCards.at(-1)!));
    expect(screen.getByRole("button", { name: "Remove Priority: Emergent filter" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove Priority: Emergent filter" }));
    expect(new URL(window.location.href).searchParams.has("priority")).toBe(false);
    view.rerender(<DifferentialStreamPage stream="presentations" query="agitation" />);
    const pathwayGroup = screen.getByRole("radiogroup", { name: "Related pathways" });
    await user.click(within(pathwayGroup).getByRole("radio", { name: /^Related pathways/ }));
    expect(new URL(window.location.href).searchParams.get("related")).toBe("1");
    view.rerender(<DifferentialStreamPage stream="presentations" query="agitation" />);
    expect(screen.getAllByTestId(/^differential-stream-card-/).length).toBeLessThan(initialCards);
    expect(screen.getByRole("button", { name: /Remove Related pathways: .+ filter/ })).toBeInTheDocument();
  });

  it("keeps non-matching diagnoses present under Not emergent with a spoken note", () => {
    window.history.replaceState(null, "", "/differentials/diagnoses?priority=emergent");
    const model = buildDifferentialStreamModel("diagnoses", "");
    const total = model.items.length;
    const emergent = model.items.filter((item) => item.status === "emergent").length;
    expect(emergent).toBeGreaterThan(0);
    expect(emergent).toBeLessThan(total);

    render(<DifferentialStreamPage stream="diagnoses" />);

    // Nothing is hidden: every diagnosis is still a row, and each still opens.
    const cards = screen.getAllByTestId(/^differential-stream-card-/);
    expect(cards).toHaveLength(total);
    const outside = cards.filter((card) => card.dataset.outsideFilter === "true");
    expect(outside).toHaveLength(total - emergent);
    for (const card of outside.slice(0, 5)) {
      expect(within(card).getByRole("link", { name: /, open$/ })).toBeInTheDocument();
    }

    const note = screen.getByTestId("differentials-stream-highlight-note");
    expect(note).toHaveTextContent(`${emergent} of ${total} highlighted, all rows stay`);
    // A polite live region, so the note is heard.
    expect(within(note).getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(within(note).getByRole("button", { name: "Clear" })).toBeInTheDocument();
    expect(screen.getByTestId("differentials-stream-outside-heading")).toHaveTextContent(
      `Not emergent · ${total - emergent}`,
    );
    // Matching rows first, then the rest: no emergent row below the heading.
    expect(cards.indexOf(outside[0]!)).toBe(emergent);
    // Faded by colour token, never by opacity.
    for (const card of outside.slice(0, 5)) {
      expect(card.className).not.toMatch(/opacity/);
      expect(within(card).getByRole("heading", { level: 3 }).className).toContain("text-[color:var(--text-muted)]");
    }
  });

  it("replaces match navigation with a removable focused-family filter", async () => {
    const user = userEvent.setup();
    const view = render(<DifferentialStreamPage stream="diagnoses" query="pain" />);

    expect(screen.getByRole("heading", { level: 1, name: "Diagnoses" })).toBeInTheDocument();
    expect(screen.getByText("Compare likely causes and exclusion clues.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "pain" })).toBeInTheDocument();
    expect(screen.queryByTestId("differentials-stream-match-controls")).not.toBeInTheDocument();
    expect(screen.queryByTestId("differentials-stream-match-rail")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Prev match" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next match" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Related cluster lit for/)).not.toBeInTheDocument();

    const initialCards = screen.getAllByTestId(/^differential-stream-card-/).length;
    await user.click(screen.getByTestId("differentials-stream-filter-trigger"));
    await user.click(screen.getByRole("radio", { name: /^Focused family/ }));
    expect(new URL(window.location.href).searchParams.get("related")).toBe("1");
    view.rerender(<DifferentialStreamPage stream="diagnoses" query="pain" />);

    const removeFamily = screen.getByRole("button", { name: /Remove Family: .+ filter/ });
    expect(removeFamily).toBeInTheDocument();
    expect(screen.getAllByTestId(/^differential-stream-card-/).length).toBeLessThan(initialCards);

    await user.click(removeFamily);
    expect(new URL(window.location.href).searchParams.has("related")).toBe(false);
    view.rerender(<DifferentialStreamPage stream="diagnoses" query="pain" />);
    expect(screen.getAllByTestId(/^differential-stream-card-/)).toHaveLength(initialCards);
  });

  it("keeps diagnosis browse grouping in the top controls", async () => {
    const user = userEvent.setup();
    render(<DifferentialStreamPage stream="diagnoses" />);

    const byUrgency = screen.getByRole("button", { name: "By urgency" });
    const byPresentation = screen.getByRole("button", { name: "By presentation" });
    expect(byUrgency).toHaveAttribute("aria-pressed", "true");
    expect(byPresentation).toHaveAttribute("aria-pressed", "false");

    await user.click(byPresentation);
    expect(byUrgency).toHaveAttribute("aria-pressed", "false");
    expect(byPresentation).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("differentials-stream-filter-trigger")).toHaveAccessibleName(/No filters active/);
  });

  it("lists each diagnosis's related diagnoses once, as chips, keeping every label", () => {
    const model = buildDifferentialStreamModel("diagnoses", "");
    const item = model.items.find((candidate) => candidate.examples.length > 0 && candidate.related.length > 0);
    expect(item).toBeTruthy();
    render(<DifferentialStreamPage stream="diagnoses" />);

    const card = screen.getByTestId(`differential-stream-card-${item!.slug}`);
    const chips = within(within(card).getByTestId("differential-stream-related"))
      .getAllByRole("listitem")
      .map((chip) => chip.textContent);
    // No label is printed twice on the card…
    expect(new Set(chips).size).toBe(chips.length);
    // …and nothing the old document-icon list showed is lost.
    for (const label of [...item!.examples, ...item!.related.slice(0, 4).map((node) => node.label)]) {
      expect(chips).toContain(label);
      expect(within(card).getAllByText(label)).toHaveLength(1);
    }
    // The title opens the record; the separate Open button is gone.
    expect(within(card).getByRole("link", { name: `${item!.title}, open` })).toHaveAttribute("href", item!.href);
  });

  it("drops the Must-check shelf from Diagnoses while Emergent stays the first group", () => {
    render(<DifferentialStreamPage stream="diagnoses" />);

    expect(screen.queryByTestId("differentials-stream-safety-shelf")).not.toBeInTheDocument();
    expect(screen.queryByText("Must-check / emergent shelf")).not.toBeInTheDocument();
    const groups = screen.getAllByTestId(/^differential-stream-chapter-/);
    const first = groups[0]!;
    const firstCards = within(first).getAllByTestId(/^differential-stream-card-/);
    expect(firstCards.length).toBeGreaterThan(0);
    expect(firstCards.every((card) => card.dataset.status === "emergent")).toBe(true);
  });

  it("puts scenario chips in one sideways-scrolling row of focusable buttons", async () => {
    const user = userEvent.setup();
    render(<DifferentialStreamPage stream="diagnoses" />);

    const row = screen.getByTestId("differentials-stream-presets");
    expect(row.className).toContain("overflow-x-auto");
    expect(row.className).not.toMatch(/(^|\s)flex-wrap(\s|$)/);
    const chips = within(row).getAllByRole("button");
    expect(chips.length).toBeGreaterThan(1);
    for (const chip of chips) {
      expect(chip.className).toContain("whitespace-nowrap");
      expect(chip.className).toContain("focus-visible:outline");
    }
    chips[0]!.focus();
    await user.tab();
    expect(chips[1]).toHaveFocus();
  });

  it("shows the Compare tray only once a diagnosis is ticked", async () => {
    const user = userEvent.setup();
    render(<DifferentialStreamPage stream="diagnoses" />);

    expect(screen.queryByTestId("differentials-compare-tray")).not.toBeInTheDocument();
    expect(screen.queryByText("Tick diagnoses to compare")).not.toBeInTheDocument();
    expect(screen.queryByText(/Tick two or more diagnoses/)).not.toBeInTheDocument();

    const boxes = screen.getAllByRole("checkbox");
    await user.click(boxes[0]!);
    expect(await screen.findByTestId("differentials-compare-tray")).toHaveTextContent("1 selected");
    await user.click(boxes[1]!);
    const compare = screen.getByTestId("differentials-compare-tray-compare");
    expect(compare.getAttribute("href")).toMatch(/^\/differentials\/compare\?ids=/);

    await user.click(screen.getByTestId("differentials-compare-tray-clear"));
    expect(screen.queryByTestId("differentials-compare-tray")).not.toBeInTheDocument();
  });

  it("scrolls only for an explicit focus parameter", async () => {
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView);
    const initialRender = render(<DifferentialStreamPage stream="diagnoses" query="pain" />);
    expect(scrollIntoView).not.toHaveBeenCalled();
    initialRender.unmount();
    scrollIntoView.mockClear();

    const focusedMatch = buildDifferentialStreamModel("diagnoses", "pain").items.find((item) => item.isMatch);
    const focused = differentialDiagnosesCards.find((item) => item.href.endsWith(`/${focusedMatch?.slug ?? ""}`));
    expect(focused).toBeTruthy();
    const focusedSlug = focused!.href.split("/").at(-1);
    expect(focusedSlug).toBeTruthy();
    render(<DifferentialStreamPage stream="diagnoses" query="pain" focus={focusedSlug} />);

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "center" }));
  });
});
