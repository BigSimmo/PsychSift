import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/forms/test-form",
  useRouter: () => ({ back: vi.fn(), replace: vi.fn() }),
}));

import { FormDetailPage } from "@/components/forms/form-detail-page";
import { priorityFactBody } from "@/components/forms/form-priority-facts-section";
import { getFormRecord } from "@/lib/forms";

vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({
    isSaved: () => false,
    setFavourite: vi.fn(async () => true),
  }),
}));

describe("Form 1A priority facts", () => {
  it("shows the fact wording in full on the card and opens per-section Act detail sheets", async () => {
    const user = userEvent.setup();
    const form = getFormRecord("form-1a");
    if (!form) throw new Error("Expected Form 1A");

    render(<FormDetailPage form={form} />);

    const priorityFacts = screen.getByLabelText("Priority facts");
    expect(within(priorityFacts).getByText("Usually 72 hours from referral")).toBeInTheDocument();
    expect(within(priorityFacts).getByText(/Within assessment window/i)).toBeInTheDocument();
    expect(within(priorityFacts).getByText(/Psychiatrist examination only/i)).toBeInTheDocument();
    expect(within(priorityFacts).queryByText("Source status")).not.toBeInTheDocument();
    expect(within(priorityFacts).getByText("Act sections")).toBeInTheDocument();
    expect(within(priorityFacts).getByText(/Authority under the Act/i)).toBeInTheDocument();

    // The longer wording is on the card itself now: no "Tap for detail", no fact sheet.
    expect(within(priorityFacts).queryByText("Tap for detail")).not.toBeInTheDocument();
    expect(within(priorityFacts).queryByRole("button", { name: /Clock \/ review.*Open detail/i })).toBeNull();
    expect(screen.queryByTestId("form-priority-fact-sheet")).not.toBeInTheDocument();
    const clockBody = priorityFactBody(form, "clock")!.body;
    expect(within(priorityFacts).getByText(clockBody)).toBeInTheDocument();

    await user.click(within(priorityFacts).getByRole("button", { name: /Section 26:/i }));
    const sectionSheet = await screen.findByTestId("form-act-section-sheet");
    expect(sectionSheet).toHaveTextContent(/Referral for examination at authorised hospital or other place/i);
    expect(sectionSheet).toHaveTextContent(/reasonably suspect/i);
  });
});

describe("Operational guidance review state", () => {
  it("says the guidance is drafted, once for the block rather than on every card", () => {
    // Form 3C used to read "Official form source: ... Review the source snippets and
    // approved form before use." It now names the maker, the 72-hour ceiling and where
    // that clock starts -- all drafted from the Act, none of it signed off by a clinician.
    const form = getFormRecord("form-3c");
    if (!form) throw new Error("Expected Form 3C");

    render(
      <FormDetailPage
        form={{ ...form, catalogPayload: { ...(form.catalogPayload as object), contentReviewStatus: "drafted" } }}
      />,
    );
    const priorityFacts = screen.getByLabelText("Priority facts");
    expect(
      within(priorityFacts).getByText(/Drafted from the Act and the approved form, awaiting clinical review/i),
    ).toBeInTheDocument();
    expect(within(priorityFacts).queryByText(/Official form source/i)).not.toBeInTheDocument();
  });

  it("keeps the caveat beside the full text on the card", () => {
    const form = getFormRecord("form-3c");
    if (!form) throw new Error("Expected Form 3C");

    render(
      <FormDetailPage
        form={{ ...form, catalogPayload: { ...(form.catalogPayload as object), contentReviewStatus: "drafted" } }}
      />,
    );
    const priorityFacts = screen.getByLabelText("Priority facts");
    expect(priorityFacts).toHaveTextContent(/72 hours/i);
    expect(priorityFacts).toHaveTextContent(/awaiting clinical review/i);
    expect(
      within(priorityFacts).getByText(
        "Confirm against the current Act and approved form before clinical or legal use.",
      ),
    ).toBeInTheDocument();
  });
});

describe("Priority facts on forms without curated copy", () => {
  it("drops the empty sub-line and only prints longer wording where there is more to show", () => {
    // Form 4C's catalogue row is boilerplate: no indexedClock, and its clock prose is
    // the generic sentence. It is the shape 34 of the 47 archived forms have.
    const form = getFormRecord("transfer-order");
    if (!form) throw new Error("Expected Form 4C");

    render(<FormDetailPage form={form} />);
    const priorityFacts = screen.getByLabelText("Priority facts");

    // "Not listed" read as a fact about the form rather than an absence of one.
    expect(within(priorityFacts).queryByText("Not listed")).not.toBeInTheDocument();

    // The clock fact's title is its whole body, so the body is not printed twice.
    const clockTitle = (form.summaryCards ?? []).find((card) => card.id === "clock")?.title?.trim();
    expect(clockTitle).toBeTruthy();
    expect(within(priorityFacts).getAllByText(clockTitle!)).toHaveLength(1);

    // The authority fact composes maker + authorises + does-not-authorise, which is
    // strictly more than its title — so every form shows that wording in full.
    expect(priorityFacts).toHaveTextContent(/Does not replace linked forms/i);
  });
});

describe("Act sections card with many citations", () => {
  function formWithSections(
    sections: { section: string; title: string; summary?: string; reviewStatus?: "reviewed" | "drafted" }[],
  ) {
    const base = getFormRecord("transfer-order");
    if (!base) throw new Error("Expected Form 4C");
    return {
      ...base,
      summaryCards: [
        ...(base.summaryCards ?? []).filter((card) => card.id !== "source" && card.id !== "act-sections"),
        {
          id: "act-sections",
          label: "Act sections",
          title: "Authority under the Act",
          detail:
            sections.length > 6 ? `${sections.length} sections cited` : sections.map((s) => s.section).join(" · "),
        },
      ],
      catalogPayload: { ...(base.catalogPayload as object), actSections: sections },
    };
  }

  const elevenSections = Array.from({ length: 11 }, (_, index) => ({
    section: String(120 + index),
    title: `Section ${120 + index} heading`,
    summary: `Summary of section ${120 + index}.`,
  }));

  it("caps the chips and opens the full list behind the overflow control", async () => {
    const user = userEvent.setup();
    // Form 5A cites 11 sections; rendering all of them as 48px targets inside one
    // quarter of the 2x2 grid destroys the layout. The block is two rows of three, and
    // where there is an overflow the sixth tile is spent on the "+n" control — so five
    // sections show, not six. A seventh tile would open a ragged third row and set that
    // height for every other priority-facts card in the grid.
    render(<FormDetailPage form={formWithSections(elevenSections)} />);
    const priorityFacts = screen.getByLabelText("Priority facts");

    expect(within(priorityFacts).getByRole("button", { name: /Section 120:/i })).toBeInTheDocument();
    expect(within(priorityFacts).getByRole("button", { name: /Section 124:/i })).toBeInTheDocument();
    expect(within(priorityFacts).queryByRole("button", { name: /Section 125:/i })).not.toBeInTheDocument();

    await user.click(within(priorityFacts).getByRole("button", { name: /Show all 11 Act sections/i }));
    const sheet = await screen.findByTestId("form-act-section-sheet");
    expect(sheet).toHaveTextContent(/Section 130 — Section 130 heading/);

    await user.click(within(sheet).getByRole("button", { name: /Section 130 — Section 130 heading/ }));
    expect(await screen.findByTestId("form-act-section-sheet")).toHaveTextContent(/Summary of section 130\./);
  });

  it("shows every section when they fill the two rows exactly", () => {
    // Six sections fit the block, so there is nothing to collapse and no "+n" tile.
    const sixSections = Array.from({ length: 6 }, (_, index) => ({
      section: String(120 + index),
      title: `Section ${120 + index} heading`,
      summary: `Summary of section ${120 + index}.`,
    }));
    render(<FormDetailPage form={formWithSections(sixSections)} />);
    const priorityFacts = screen.getByLabelText("Priority facts");

    expect(within(priorityFacts).getByRole("button", { name: /Section 125:/i })).toBeInTheDocument();
    expect(within(priorityFacts).queryByRole("button", { name: /Show all/i })).not.toBeInTheDocument();
  });

  it("flags drafted sections on the card face, not only inside the sheet", () => {
    // A reader who never opens a section must still see that the summaries behind this
    // card carry no clinician sign-off.
    render(
      <FormDetailPage
        form={formWithSections([
          {
            section: "66",
            title: "Transfer from general hospital",
            summary: "Summary of 66.",
            reviewStatus: "drafted",
          },
        ])}
      />,
    );
    const priorityFacts = screen.getByLabelText("Priority facts");
    // The Act-sections card's own footer, not the block-level caveat that covers the
    // other three cards: this test is about the section summaries behind this card.
    expect(within(priorityFacts).getByText(/Tap a section .*awaiting clinical review/i)).toBeInTheDocument();
  });

  it("drops the card-face flag once every rendered section is reviewed", () => {
    render(
      <FormDetailPage
        form={formWithSections([
          {
            section: "66",
            title: "Transfer from general hospital",
            summary: "Summary of 66.",
            reviewStatus: "reviewed",
          },
        ])}
      />,
    );
    const priorityFacts = screen.getByLabelText("Priority facts");
    expect(within(priorityFacts).queryByText(/Tap a section .*awaiting clinical review/i)).not.toBeInTheDocument();
    expect(within(priorityFacts).getByText(/Tap a section for authority detail/i)).toBeInTheDocument();
  });

  it("says so when a summary has not been clinically reviewed yet", async () => {
    const user = userEvent.setup();
    render(
      <FormDetailPage
        form={formWithSections([
          {
            section: "66",
            title: "Transfer from general hospital",
            summary: "Summary of 66.",
            reviewStatus: "drafted",
          },
        ])}
      />,
    );
    const priorityFacts = screen.getByLabelText("Priority facts");

    await user.click(within(priorityFacts).getByRole("button", { name: /Section 66:/i }));
    const sheet = await screen.findByTestId("form-act-section-sheet");
    expect(sheet).toHaveTextContent(/Summary of 66\./);
    expect(sheet).toHaveTextContent(/Drafted from the Act text and awaiting clinical review/i);
  });

  it("drops the awaiting-review note once a summary is reviewed", async () => {
    const user = userEvent.setup();
    render(
      <FormDetailPage
        form={formWithSections([
          {
            section: "66",
            title: "Transfer from general hospital",
            summary: "Summary of 66.",
            reviewStatus: "reviewed",
          },
        ])}
      />,
    );
    const priorityFacts = screen.getByLabelText("Priority facts");

    await user.click(within(priorityFacts).getByRole("button", { name: /Section 66:/i }));
    const sheet = await screen.findByTestId("form-act-section-sheet");
    expect(sheet).not.toHaveTextContent(/awaiting clinical review/i);
  });

  it("explains a section whose summary has not been written yet", async () => {
    const user = userEvent.setup();
    render(<FormDetailPage form={formWithSections([{ section: "66", title: "Transfer from general hospital" }])} />);
    const priorityFacts = screen.getByLabelText("Priority facts");

    await user.click(within(priorityFacts).getByRole("button", { name: /Section 66:/i }));
    const sheet = await screen.findByTestId("form-act-section-sheet");
    expect(sheet).toHaveTextContent(/has not been written yet/i);
    expect(within(sheet).getByRole("link", { name: /Mental Health Act 2014 \(WA\), version/i })).toBeInTheDocument();
  });
});
