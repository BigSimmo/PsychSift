import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FactsheetDetailPage } from "@/components/factsheets/factsheet-detail-page";
import { findFactsheet } from "@/components/factsheets/factsheets-data";

vi.mock("next/navigation", () => ({
  usePathname: () => "/factsheets/sertraline",
  useRouter: () => ({ back: vi.fn(), replace: vi.fn() }),
}));

function renderFactsheet(slug: string) {
  const factsheet = findFactsheet(slug);
  if (!factsheet) throw new Error(`Expected the ${slug} factsheet fixture`);
  return { factsheet, ...render(<FactsheetDetailPage factsheet={factsheet} />) };
}

describe("factsheet detail header", () => {
  it("keeps the record title as the on-screen page's only h1", () => {
    // The header title is a `<span>`; the hero owns the heading. Two `<h1>`s
    // with the same text is the failure this guards. Scoped to the shell: the
    // print sheet is portaled to <body> and carries its own `<h1>`, which the
    // next test pins as deliberate rather than accidental.
    const { factsheet } = renderFactsheet("sertraline");
    const page = screen.getByTestId("factsheet-detail-page");
    const headings = within(page).getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(factsheet.title);
  });

  it("accounts for every h1 in the document: the hero and the print sheet, never both visible", () => {
    // The document carries exactly two `<h1>`s and they are mutually exclusive
    // by construction, so neither state ever exposes two to the accessibility
    // tree (`#295`):
    //   - on screen, `.factsheet-print-sheet { display: none }` removes the
    //     print sheet's subtree entirely;
    //   - in print, `html.factsheets-printing body > *:not(.factsheet-print-portal)`
    //     is `display: none !important`, removing the shell that owns the hero.
    // The print sheet is a separate printed document with its own outline (its
    // section headings are `<h2>`), so demoting its `<h1>` would leave the
    // exported PDF with no top-level heading. jsdom applies no stylesheet, so
    // the guard is this census rather than a visibility assertion: the previous
    // testid-scoped check alone would not have caught a third `<h1>` appearing
    // anywhere outside the page shell.
    const { factsheet } = renderFactsheet("sertraline");
    const page = screen.getByTestId("factsheet-detail-page");
    const printPortal = document.querySelector(".factsheet-print-portal");
    expect(printPortal).not.toBeNull();

    const allHeadings = screen.getAllByRole("heading", { level: 1 });
    expect(allHeadings).toHaveLength(2);
    for (const heading of allHeadings) expect(heading).toHaveTextContent(factsheet.title);

    expect(allHeadings.filter((heading) => page.contains(heading))).toHaveLength(1);
    expect(allHeadings.filter((heading) => printPortal!.contains(heading))).toHaveLength(1);
    // The printed document starts at h1 and descends; nothing in it may outrank
    // its title.
    expect(within(printPortal as HTMLElement).getAllByRole("heading", { level: 2 }).length).toBeGreaterThan(0);
  });

  it("associates printable fact values with row headers", () => {
    renderFactsheet("sertraline");
    const printPortal = document.querySelector(".factsheet-print-portal");
    expect(printPortal).not.toBeNull();

    // Assert per row, not over the set of headers that happen to exist: a fact row
    // rendered with no row header at all would leave its value unassociated in a
    // screen reader, and a headers-only assertion passes straight over it.
    const rows = within(printPortal as HTMLElement).getAllByRole("row");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const rowHeaders = within(row).getAllByRole("rowheader");
      expect(rowHeaders).toHaveLength(1);
      expect(rowHeaders[0]).toHaveAttribute("scope", "row");
    }
  });

  it("names the way back in the top bar, without spending a row on its label", () => {
    // Back is drawn in the top bar's round left slot (header standard, 13 Oct 2026).
    const slot = document.createElement("div");
    slot.id = "universal-header-leading";
    document.body.append(slot);
    renderFactsheet("sertraline");
    const back = screen.getByRole("link", { name: "Back to all factsheets" });
    expect(back).toHaveAttribute("href", "/factsheets/search");
    expect(within(back).queryByText("All factsheets")).toBeNull();
    expect(back.closest("#universal-header-leading")).not.toBeNull();
    slot.remove();
  });

  it("switches the body copy between reading levels", async () => {
    // Reading level drives `FactsheetBody` and the print sheet, not just the
    // control, so the page keeps ownership of the state.
    const user = userEvent.setup();
    const { factsheet } = renderFactsheet("sertraline");
    if (factsheet.kind !== "medRich") throw new Error("Expected sertraline to be the medRich fixture");

    const group = screen.getByRole("radiogroup", { name: "Reading level" });
    expect(screen.getAllByText(factsheet.whatEasy).length).toBeGreaterThan(0);

    await user.click(within(group).getByRole("radio", { name: "Standard" }));

    expect(screen.getAllByText(factsheet.whatStandard).length).toBeGreaterThan(0);
    expect(screen.queryByText(factsheet.whatEasy)).toBeNull();
  });

  it("puts the reading level in the actions sheet as well as the row", async () => {
    // The phone home for the view mode. Both copies exist in the DOM and CSS
    // picks one per breakpoint, so the assertion is that the sheet copy is
    // present and drives the same state — not that only one is rendered.
    const user = userEvent.setup();
    renderFactsheet("sertraline");

    // Only the inline copy exists before the sheet is opened.
    expect(screen.getAllByRole("radiogroup", { name: "Reading level" })).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Open factsheet actions" }));
    const sheetMode = screen.getByTestId("factsheet-sheet-mode");
    expect(sheetMode).toBeInTheDocument();

    await user.click(within(sheetMode).getByRole("radio", { name: "Standard" }));
    const factsheet = findFactsheet("sertraline");
    if (factsheet?.kind !== "medRich") throw new Error("Expected sertraline to be the medRich fixture");
    expect(screen.getAllByText(factsheet.whatStandard).length).toBeGreaterThan(0);
  });

  it("pairs the download and the ellipsis into one control group", () => {
    // The fix for two competing bordered shapes at the end of the row: one
    // group, both members inside it.
    renderFactsheet("sertraline");
    const group = screen.getByTestId("factsheet-action-group");
    expect(within(group).getByRole("button", { name: "Download PDF" })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "Open factsheet actions" })).toBeInTheDocument();
  });

  it("reserves no reading-level control on a factsheet that has one level", () => {
    // Seven of the eight sheets are not `medRich`; none of them should carry
    // the band or an empty gap where it would be.
    const { factsheet } = renderFactsheet("depression");
    expect(factsheet.kind).not.toBe("medRich");
    expect(screen.queryByRole("radiogroup", { name: "Reading level" })).toBeNull();
  });

  it("offers the download without opening anything", () => {
    // The promoted action is the reason the header is worth pinning; it must
    // not be behind the ellipsis.
    renderFactsheet("sertraline");
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeInTheDocument();
  });
});
