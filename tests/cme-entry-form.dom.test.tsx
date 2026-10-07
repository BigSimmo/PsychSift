import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CmeEntryForm } from "@/components/cme/cme-entry-form";
import { perthCalendarDate } from "@/lib/cme/cpd-year";

describe("New entry", () => {
  const knownEntry = {
    id: "smart-default-source",
    date: "2026-01-04",
    title: "Journal club",
    allocations: [{ category: "reviewing" as const, hours: 1.5 }],
    reflection: "Earlier occasion",
    costCents: null,
    transcribed: false,
    routineId: null,
    documentId: null,
    buckets: [],
  };

  it("suggests the latest hours and category for an exact normalized title, while keeping today's date", async () => {
    const user = userEvent.setup();
    render(<CmeEntryForm onSubmit={vi.fn()} existingEntries={[knownEntry]} />);
    await user.type(screen.getByLabelText(/what was it/i), "  JOURNAL club  ");
    await user.tab();
    expect(screen.getByRole("button", { name: "1.5" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Reviewing" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("cme-entry-date-today")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Reflection")).toHaveValue("");
  });

  it("does not suggest choices for a different title", async () => {
    const user = userEvent.setup();
    render(<CmeEntryForm onSubmit={vi.fn()} existingEntries={[knownEntry]} />);
    await user.type(screen.getByLabelText(/what was it/i), "Journal club follow-up");
    await user.tab();
    expect(screen.getByRole("button", { name: "1.5" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Reviewing" })).toHaveAttribute("aria-pressed", "false");
  });

  it("does not replace hours or category the doctor chose before typing the title", async () => {
    const user = userEvent.setup();
    render(<CmeEntryForm onSubmit={vi.fn()} existingEntries={[knownEntry]} />);
    await user.click(screen.getByRole("button", { name: "2" }));
    await user.click(screen.getByRole("button", { name: "Educational" }));
    await user.type(screen.getByLabelText(/what was it/i), "Journal club");
    await user.tab();
    expect(screen.getByRole("button", { name: "2" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Educational" })).toHaveAttribute("aria-pressed", "true");
  });

  it("asks before logging the same trimmed title on the same Perth day", async () => {
    const day = perthCalendarDate(new Date());
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const original = {
      id: "demo-existing",
      date: day,
      title: "  Demo journal club  ",
      allocations: [{ category: "educational" as const, hours: 1 }],
      reflection: "",
      costCents: null,
      transcribed: false,
      routineId: null,
      documentId: null,
      buckets: [],
    };
    render(
      <CmeEntryForm
        onSubmit={onSubmit}
        existingEntries={[original]}
        initialEntry={{ ...original, title: "demo JOURNAL club", sourceUrl: null, formalPeerReviewHours: 0 }}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Save entry" }));
    expect(screen.getByText("You logged this today already. Log it again?")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(within(screen.getByTestId("confirm-dialog")).getAllByRole("button", { name: "Cancel" })[1]);
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Save entry" }));
    await user.click(screen.getByRole("button", { name: "Log again" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
  it("will not save until the allocations add up to the stated hours", async () => {
    const onSubmit = vi.fn();
    render(<CmeEntryForm onSubmit={onSubmit} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/what was it/i), "Peer review group — September");
    await user.click(screen.getByRole("button", { name: "1.5" }));
    await user.click(screen.getByRole("button", { name: "Split hours" }));
    await user.type(screen.getByLabelText(/reviewing performance/i), "1");
    expect(screen.getByTestId("cme-allocation-total")).toHaveTextContent("1.0 of 1.5 allocated");
    expect(screen.getByRole("button", { name: /save entry/i })).toHaveAttribute("aria-disabled", "true");
    await user.type(screen.getByLabelText(/measuring outcomes/i), "0.5");
    expect(screen.getByTestId("cme-allocation-total")).toHaveTextContent("1.5 of 1.5 allocated");
    expect(screen.getByRole("button", { name: /save entry/i })).not.toHaveAttribute("aria-disabled");
  });

  // Regression, 2026-09-24: Save sat disabled with nothing saying why.
  it("says what is stopping a save, and stops saying it once the entry can save", async () => {
    render(<CmeEntryForm onSubmit={vi.fn()} />);
    const user = userEvent.setup();
    expect(screen.getByTestId("cme-entry-save-blocked")).toHaveTextContent(/add what the activity was/i);
    await user.type(screen.getByLabelText(/what was it/i), "Peer review group");
    await user.click(screen.getByRole("button", { name: "1.5" }));
    expect(screen.getByTestId("cme-entry-save-blocked")).toHaveTextContent(/which category/i);
    await user.click(screen.getByRole("button", { name: "Split hours" }));
    expect(screen.getByTestId("cme-entry-save-blocked")).toHaveTextContent(/split/i);
    await user.type(screen.getByLabelText(/reviewing performance/i), "1.5");
    expect(screen.queryByTestId("cme-entry-save-blocked")).toBeNull();
    expect(screen.getByRole("button", { name: /save entry/i })).not.toHaveAttribute("aria-disabled");
  });

  it("labels the reflection without asking a question", () => {
    render(<CmeEntryForm onSubmit={vi.fn()} />);
    const reflection = screen.getByLabelText(/reflection/i);
    expect(reflection).toBeInTheDocument();
    // The owner declined a guided prompt on 2026-09-20. The box is his.
    expect(screen.queryByText(/what will you do differently/i)).toBeNull();
  });

  it("scrolls a focused field clear of the pinned Save bar, but not the pinned Save itself (WCAG 2.4.11)", () => {
    const { container } = render(<CmeEntryForm onSubmit={vi.fn()} />);
    expect(screen.getByTestId("cme-entry-save-bar")).toBeInTheDocument();
    const form = container.querySelector("form")!;
    expect(form.className).toContain("[&_:is(input,textarea,select,button):not([type=submit])]:scroll-mb-32");
    expect(screen.getByRole("button", { name: /save entry/i })).toHaveAttribute("type", "submit");
  });

  it("takes an optional cost and marks it optional", () => {
    render(<CmeEntryForm onSubmit={vi.fn()} />);
    expect(screen.getByLabelText(/what it cost/i)).toBeInTheDocument();
    expect(screen.getByTestId("cme-cost-optional")).toHaveTextContent(/optional/i);
  });

  it("rejects exponent notation in the cost field instead of parsing it as a number", async () => {
    const user = userEvent.setup();
    render(<CmeEntryForm onSubmit={vi.fn()} />);
    await user.type(screen.getByLabelText(/what it cost/i), "1e10");
    expect(screen.getByText("Numbers only, like 45 or 45.50.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save entry/i })).toHaveAttribute("aria-disabled", "true");
  });

  it("rejects exponent notation in an allocation field instead of counting it as hours", async () => {
    const user = userEvent.setup();
    render(<CmeEntryForm onSubmit={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "1" }));
    await user.click(screen.getByRole("button", { name: "Split hours" }));
    await user.type(screen.getByLabelText(/reviewing performance/i), "1e10");
    expect(screen.getByTestId("cme-allocation-total")).toHaveTextContent("0.0 of 1.0 allocated");
  });

  it("rejects malformed formal peer-review credit instead of silently saving zero", async () => {
    const user = userEvent.setup();
    render(<CmeEntryForm onSubmit={vi.fn()} />);
    await user.type(screen.getByLabelText(/formal peer-review credit/i), "-1");
    expect(screen.getByText(/positive plain number/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save entry/i })).toHaveAttribute("aria-disabled", "true");
  });

  it("submits domain and peer-review credit inside the allocated reviewing hours", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<CmeEntryForm onSubmit={onSubmit} availableDomains={["Professionalism"]} />);
    await user.type(screen.getByLabelText(/what was it/i), "Peer review meeting");
    await user.click(screen.getByRole("button", { name: "1" }));
    await user.click(screen.getByRole("button", { name: "Reviewing" }));
    await user.click(screen.getByText("More details"));
    await user.type(screen.getByLabelText(/formal peer-review credit/i), "1");
    await user.click(screen.getByRole("checkbox", { name: "Professionalism" }));
    await user.click(screen.getByRole("button", { name: /save entry/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        formalPeerReviewHours: 1,
        buckets: ["Professionalism"],
      }),
    );
  });
});

describe("one-tap category", () => {
  it("puts every stated hour in the chosen category without asking for a split", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<CmeEntryForm onSubmit={onSubmit} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/what was it/i), "Grand round");
    await user.click(screen.getByRole("button", { name: "2" }));
    expect(screen.queryByTestId("cme-allocation-total")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Educational" }));
    expect(screen.getByRole("button", { name: "Educational" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: /save entry/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Grand round", allocations: [{ category: "educational", hours: 2 }] }),
    );
  });

  it("opens an existing single-category entry on that category, and a split entry on the split", () => {
    const base = {
      date: "2026-03-01",
      title: "Journal club",
      reflection: "",
      costCents: null,
      routineId: null,
      documentId: null,
      sourceUrl: null,
      buckets: [],
      formalPeerReviewHours: 0,
    };
    const { unmount } = render(
      <CmeEntryForm
        onSubmit={vi.fn()}
        initialEntry={{ ...base, allocations: [{ category: "reviewing", hours: 1 }] }}
      />,
    );
    expect(screen.getByRole("button", { name: "Reviewing" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("cme-allocation-total")).toBeNull();
    unmount();
    render(
      <CmeEntryForm
        onSubmit={vi.fn()}
        initialEntry={{
          ...base,
          allocations: [
            { category: "reviewing", hours: 1 },
            { category: "measuring", hours: 0.5 },
          ],
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "Split hours" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("cme-allocation-total")).toHaveTextContent("1.5 of 1.5 allocated");
  });
});

describe("unsaved draft", () => {
  it("keeps an unsaved new entry for this tab and restores it, with a way to start again", async () => {
    window.sessionStorage.clear();
    const user = userEvent.setup();
    const { unmount } = render(<CmeEntryForm onSubmit={vi.fn()} draftStorageKey="cme-test-draft" />);
    await user.type(screen.getByLabelText(/what was it/i), "Half-typed course");
    await user.click(screen.getByRole("button", { name: "Outcomes" }));
    unmount();

    render(<CmeEntryForm onSubmit={vi.fn()} draftStorageKey="cme-test-draft" />);
    expect(await screen.findByTestId("cme-entry-draft-restored")).toBeInTheDocument();
    expect(screen.getByLabelText(/what was it/i)).toHaveValue("Half-typed course");
    expect(screen.getByRole("button", { name: "Outcomes" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Start again" }));
    expect(screen.getByLabelText(/what was it/i)).toHaveValue("");
    expect(window.sessionStorage.getItem("cme-test-draft")).toBeNull();
  });

  it("never lets a stored draft replace a prefilled title", async () => {
    window.sessionStorage.setItem(
      "cme-test-draft",
      JSON.stringify({ title: "Old draft", date: "2026-01-02", mode: null, allocations: [] }),
    );
    render(
      <CmeEntryForm
        onSubmit={vi.fn()}
        draftStorageKey="cme-test-draft"
        initialEntry={{
          date: "2026-03-01",
          title: "Monthly journal club",
          allocations: [{ category: "educational", hours: 1 }],
          reflection: "",
          costCents: null,
          routineId: null,
          documentId: null,
          sourceUrl: null,
          buckets: [],
          formalPeerReviewHours: 0,
        }}
      />,
    );
    expect(screen.getByLabelText(/what was it/i)).toHaveValue("Monthly journal club");
    expect(screen.queryByTestId("cme-entry-draft-restored")).toBeNull();
    window.sessionStorage.clear();
  });
});

describe("allocation hours display", () => {
  // Regression, 2026-09-24: the total showed one decimal while balance is
  // checked to two, so a quarter hour always looked wrong ("0.7 of 0.8").
  it("shows quarter hours at the precision the balance check uses", async () => {
    const { formatAllocationHours } = await import("@/components/cme/cme-allocation-field");
    expect(formatAllocationHours(0.75)).toBe("0.75");
    expect(formatAllocationHours(0.7)).toBe("0.7");
    expect(formatAllocationHours(1)).toBe("1.0");
    expect(formatAllocationHours(0.05)).toBe("0.05");
    expect(formatAllocationHours(1.5)).toBe("1.5");
    expect(formatAllocationHours(1.1)).toBe("1.1");
    expect(formatAllocationHours(0.1 + 0.2)).toBe("0.3");
  });
});

describe("hours chips and an honest Save", () => {
  function hoursGroup() {
    return screen.getByRole("group", { name: "Hours" });
  }

  it("offers 0.5, 1, 1.5, 2, 3 and Other, with nothing chosen for a new entry", () => {
    render(<CmeEntryForm onSubmit={vi.fn()} />);
    const chips = within(hoursGroup()).getAllByRole("button");
    expect(chips.map((chip) => chip.textContent)).toEqual(["0.5", "1", "1.5", "2", "3", "Other"]);
    for (const chip of chips) expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByLabelText("Hours for this activity")).toBeNull();
    const categories = within(screen.getByTestId("cme-entry-category")).getAllByRole("button");
    for (const chip of categories) expect(chip).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps Save grey until there is a title and hours, and never saves while grey", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<CmeEntryForm onSubmit={onSubmit} />);
    const save = screen.getByRole("button", { name: "Save entry" });
    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(save).not.toBeDisabled();
    await user.type(screen.getByLabelText(/what was it/i), "Demo journal club");
    await user.click(screen.getByRole("button", { name: "Educational" }));
    expect(save).toHaveAttribute("aria-disabled", "true");
    await user.click(save);
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(within(hoursGroup()).getByRole("button", { name: "1" }));
    expect(save).not.toHaveAttribute("aria-disabled");
    await user.click(save);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Demo journal club", allocations: [{ category: "educational", hours: 1 }] }),
    );
    // After a save the next entry starts blank again: no hours chosen.
    for (const chip of within(hoursGroup()).getAllByRole("button")) {
      expect(chip).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("opens the hours box from Other, which takes 1,5 and 90 min", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<CmeEntryForm onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText(/what was it/i), "Demo reading");
    await user.click(screen.getByTestId("cme-entry-hours-other"));
    const box = screen.getByLabelText("Hours for this activity");
    expect(box).toHaveFocus();
    await user.type(box, "1,5");
    expect(screen.getByTestId("cme-entry-hours-other")).toHaveAttribute("aria-pressed", "true");
    expect(within(hoursGroup()).getByRole("button", { name: "1.5" })).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: "Educational" }));
    await user.click(screen.getByRole("button", { name: "Save entry" }));
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ allocations: [{ category: "educational", hours: 1.5 }] }),
    );

    await user.type(screen.getByLabelText(/what was it/i), "Demo webinar");
    await user.click(screen.getByTestId("cme-entry-hours-other"));
    await user.type(screen.getByLabelText("Hours for this activity"), "90 min");
    await user.click(screen.getByRole("button", { name: "Educational" }));
    await user.click(screen.getByRole("button", { name: "Save entry" }));
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ allocations: [{ category: "educational", hours: 1.5 }] }),
    );
  });

  it("still fills hours from a prefill: a chip when it matches, the box when it does not", () => {
    const base = {
      date: "2026-03-01",
      title: "Demo peer review",
      reflection: "",
      costCents: null,
      routineId: null,
      documentId: null,
      sourceUrl: null,
      buckets: [],
      formalPeerReviewHours: 0,
    };
    const { unmount } = render(
      <CmeEntryForm onSubmit={vi.fn()} initialEntry={{ ...base, allocations: [] }} initialStatedHours={1.5} />,
    );
    expect(within(hoursGroup()).getByRole("button", { name: "1.5" })).toHaveAttribute("aria-pressed", "true");
    unmount();
    render(
      <CmeEntryForm
        onSubmit={vi.fn()}
        initialEntry={{ ...base, allocations: [{ category: "reviewing", hours: 4 }] }}
      />,
    );
    expect(screen.getByTestId("cme-entry-hours-other")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Hours for this activity")).toHaveValue("4");
    expect(screen.getByRole("button", { name: "Save entry" })).not.toHaveAttribute("aria-disabled");
  });

  it("reads the privacy line exactly", () => {
    render(<CmeEntryForm onSubmit={vi.fn()} />);
    expect(screen.getByTestId("cme-entry-privacy")).toHaveTextContent(
      /^Keep it free of patient names, initials, dates of birth, record numbers and other identifiers\.$/,
    );
  });

  it("keeps the order: title, date, hours, counts toward, reflection, privacy, More details, Save", () => {
    render(<CmeEntryForm onSubmit={vi.fn()} />);
    const order = [
      screen.getByLabelText(/what was it/i),
      screen.getByRole("group", { name: "Date" }),
      hoursGroup(),
      screen.getByTestId("cme-entry-category"),
      screen.getByLabelText("Reflection"),
      screen.getByTestId("cme-entry-privacy"),
      screen.getByTestId("cme-entry-more-details"),
      screen.getByRole("button", { name: "Save entry" }),
    ];
    for (let index = 1; index < order.length; index += 1) {
      expect(order[index - 1].compareDocumentPosition(order[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});
