import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DocumentSearchResultsPanel } from "@/components/clinical-dashboard/document-search-results";
import type { ClinicalDocument, DocumentLabel, DocumentMatch } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => "/documents/search",
}));

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
  vi.clearAllMocks();
});

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => ({
    status: "signed_out",
    session: null,
    isConfigured: true,
    authorizationHeader: () => null,
    registerAuthRequest: vi.fn(),
    isAuthEpochCurrent: () => true,
    markSessionExpired: vi.fn(),
  }),
}));

function label(documentId: string, text: string, type: DocumentLabel["label_type"]): DocumentLabel {
  return {
    id: `${documentId}-${text}`,
    document_id: documentId,
    label: text,
    label_type: type,
    source: "generated",
    confidence: 0.9,
  };
}

function match(overrides: Partial<DocumentMatch> & { document_id: string; title: string }): DocumentMatch {
  return {
    file_name: `${overrides.document_id}.pdf`,
    labels: [],
    summarySnippet: "Synthetic summary.",
    bestPages: [1],
    bestChunkIds: [`${overrides.document_id}-chunk`],
    imageCount: 0,
    tableCount: 0,
    matchReason: "Matched indexed passage",
    score: 0.9,
    ...overrides,
  };
}

const clozapineDoc = match({
  document_id: "11111111-1111-4111-8111-111111111111",
  title: "Clozapine Monitoring Protocol",
  labels: [label("11111111-1111-4111-8111-111111111111", "clozapine", "medication")],
  tableCount: 2,
});

const lithiumDoc = match({
  document_id: "22222222-2222-4222-8222-222222222222",
  title: "Lithium Monitoring Protocol",
  labels: [label("22222222-2222-4222-8222-222222222222", "lithium", "medication")],
});

function sourceDocument(id: string, title: string, jurisdiction: string): ClinicalDocument {
  return {
    id,
    title,
    description: null,
    file_name: `${id}.pdf`,
    file_type: "application/pdf",
    file_size: 1024,
    storage_path: `documents/${id}.pdf`,
    status: "indexed",
    page_count: 2,
    chunk_count: 1,
    image_count: 0,
    error_message: null,
    metadata: {
      document_status: "current",
      clinical_validation_status: "approved",
      extraction_quality: "good",
      jurisdiction,
    },
    labels: [],
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
  };
}

const baseProps = {
  matches: [clozapineDoc, lithiumDoc],
  recordMatches: [],
  showRecordMatches: false,
  query: "monitoring",
  loading: false,
  documentCount: 2,
  realDataReady: true,
  authUnavailable: false,
  apiUnavailable: false,
  setupWarning: null,
  onScopeDocument: vi.fn(),
  onAnswerFromDocument: vi.fn(),
  onOpenRecentDocuments: vi.fn(),
  onOpenLibrary: vi.fn(),
  onOpenSourcePdf: vi.fn(),
  onTagSearch: vi.fn(),
};

function resultTitles() {
  return screen
    .getAllByTestId("document-result-card")
    .map((card) => within(card).getAllByRole("heading")[0]?.textContent ?? "");
}

async function openPanel(props = baseProps) {
  const user = userEvent.setup();
  const view = render(<DocumentSearchResultsPanel {...props} />);
  await user.click(screen.getByTestId("document-filter-trigger-phone"));
  return { user, view, panel: screen.getByTestId("document-filter-panel") };
}

describe("document filter panel", () => {
  it("is reachable from the ribbon trigger", async () => {
    // The regression this pins: the facet rail used to be mounted only when a
    // facet was already selected, and the only controls that could select one
    // lived inside that same gated subtree. So no sequence of clicks reached it.
    const user = userEvent.setup();
    render(<DocumentSearchResultsPanel {...baseProps} />);

    expect(screen.queryByTestId("document-filter-panel")).toBeNull();

    const trigger = screen.getByTestId("document-filter-trigger-phone");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);

    expect(screen.getByTestId("document-filter-panel")).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("carries result type and smart-tag facets in one panel", async () => {
    const user = userEvent.setup();
    render(<DocumentSearchResultsPanel {...baseProps} />);
    await user.click(screen.getByTestId("document-filter-trigger-phone"));

    const panel = screen.getByTestId("document-filter-panel");
    expect(within(panel).getByRole("radiogroup", { name: "Result type" })).toBeInTheDocument();
    expect(within(panel).getByRole("radio", { name: /All/ })).toHaveAttribute("aria-checked", "true");
    await user.click(within(panel).getByRole("button", { name: /^Medication/ }));
    expect(within(panel).getByRole("button", { name: /Clozapine/ })).toBeInTheDocument();
  });

  it("stages a local facet and commits it without running document retrieval", async () => {
    const user = userEvent.setup();
    const onDocumentFiltersApply = vi.fn();
    const props = { ...baseProps, onDocumentFiltersApply };
    const view = render(<DocumentSearchResultsPanel {...props} />);
    expect(resultTitles()).toHaveLength(2);

    await user.click(screen.getByTestId("document-filter-trigger-phone"));
    await user.click(within(screen.getByTestId("document-filter-panel")).getByRole("button", { name: /^Medication/ }));
    await user.click(within(screen.getByTestId("document-filter-panel")).getByRole("button", { name: /Clozapine/ }));

    expect(resultTitles()).toHaveLength(2);
    await user.click(within(screen.getByTestId("document-filter-panel")).getByTestId("document-filter-panel-done"));
    view.rerender(<DocumentSearchResultsPanel {...props} />);
    expect(resultTitles()).toEqual([expect.stringContaining("Clozapine Monitoring Protocol")]);
    expect(screen.getByTestId("document-filter-trigger-phone")).toHaveTextContent("1");
    expect(onDocumentFiltersApply).not.toHaveBeenCalled();
  });

  it("stages result type from the same panel", async () => {
    const user = userEvent.setup();
    const view = render(<DocumentSearchResultsPanel {...baseProps} />);

    await user.click(screen.getByTestId("document-filter-trigger-phone"));
    await user.click(within(screen.getByTestId("document-filter-panel")).getByRole("radio", { name: /Tables/ }));

    expect(resultTitles()).toHaveLength(2);
    await user.click(within(screen.getByTestId("document-filter-panel")).getByTestId("document-filter-panel-done"));
    view.rerender(<DocumentSearchResultsPanel {...baseProps} />);
    expect(resultTitles()).toEqual([expect.stringContaining("Clozapine Monitoring Protocol")]);
  });

  it("performs one retrieval when staged source scope changes", async () => {
    const user = userEvent.setup();
    const onDocumentFiltersApply = vi.fn();
    const recentDocuments = [
      sourceDocument(clozapineDoc.document_id, clozapineDoc.title, "WA"),
      sourceDocument(lithiumDoc.document_id, lithiumDoc.title, "National"),
    ];
    render(
      <DocumentSearchResultsPanel
        {...baseProps}
        recentDocuments={recentDocuments}
        onDocumentFiltersApply={onDocumentFiltersApply}
      />,
    );

    await user.click(screen.getByTestId("document-filter-trigger-phone"));
    const panel = screen.getByTestId("document-filter-panel");
    await user.click(within(panel).getByRole("radio", { name: /^Local \(1 loaded source\)$/ }));
    expect(onDocumentFiltersApply).not.toHaveBeenCalled();
    await user.click(within(panel).getByTestId("document-filter-panel-done"));

    expect(onDocumentFiltersApply).toHaveBeenCalledTimes(1);
    expect(onDocumentFiltersApply).toHaveBeenCalledWith(expect.objectContaining({ locality: "local" }), []);
  });

  it("hides Clear filters until a document filter is active", async () => {
    const { panel } = await openPanel();

    expect(within(panel).queryByTestId("document-filter-panel-clear")).toBeNull();
  });

  it("clears staged result and smart-tag refinements at once", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/documents/search?resultType=tables&facet=medication%3Aclozapine");
    const view = render(<DocumentSearchResultsPanel {...baseProps} />);
    expect(resultTitles()).toHaveLength(1);

    await user.click(screen.getByTestId("document-filter-trigger-phone"));
    const panel = () => screen.getByTestId("document-filter-panel");
    await user.click(within(panel()).getByTestId("document-filter-panel-clear"));
    await user.click(within(panel()).getByTestId("document-filter-panel-done"));
    view.rerender(<DocumentSearchResultsPanel {...baseProps} />);

    expect(resultTitles()).toHaveLength(2);
    expect(new URLSearchParams(window.location.search).has("resultType")).toBe(false);
    expect(new URLSearchParams(window.location.search).has("facet")).toBe(false);
  });

  it("is a dialog, so it overlays the results rather than pushing them down", async () => {
    // The phone contract: the panel covers the list it describes instead of
    // displacing it, which is why the footer count is the thing that reports
    // what the current combination returns.
    const user = userEvent.setup();
    render(<DocumentSearchResultsPanel {...baseProps} />);
    await user.click(screen.getByTestId("document-filter-trigger-phone"));

    const panel = screen.getByTestId("document-filter-panel");
    const dialog = panel.closest('[role="dialog"]') ?? panel;
    const trigger = screen.getByTestId("document-filter-trigger-phone");
    expect(dialog).toHaveAttribute("role", "dialog");
    // The trigger must name the dialog it opens. Asserting only `aria-haspopup`
    // would pass with a stale or wrong id, which is the whole point of wiring
    // `aria-controls` through Sheet's `id` prop.
    expect(dialog.id).not.toBe("");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", dialog.id);
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<DocumentSearchResultsPanel {...baseProps} />);
    await user.click(screen.getByTestId("document-filter-trigger-phone"));
    expect(screen.getByTestId("document-filter-panel")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("document-filter-panel")).toBeNull();
    const closedTrigger = screen.getByTestId("document-filter-trigger-phone");
    expect(closedTrigger).toHaveAttribute("aria-expanded", "false");
    expect(closedTrigger).not.toHaveAttribute("aria-controls");
  });

  it("releases the scroll lock when a refetch unmounts an open panel", async () => {
    // `showFilterControl` folds in `!loading`, so a refetch on the same query
    // unmounts the open Sheet. That skips Sheet's focus restore — but the
    // trigger is gated on the same flag and unmounts too, so there is no opener
    // left to restore to. What must not leak is the body scroll lock, and it
    // does not: `popSheet` runs in the same effect cleanup as the unmount.
    const user = userEvent.setup();
    const { rerender } = render(<DocumentSearchResultsPanel {...baseProps} />);

    await user.click(screen.getByTestId("document-filter-trigger-phone"));
    expect(screen.getByTestId("document-filter-panel")).toBeInTheDocument();
    // Prove the lock was taken, or the release assertion below passes vacuously
    // the day the sheet stops locking at all.
    expect(document.body.style.overflow).toBe("hidden");

    rerender(<DocumentSearchResultsPanel {...baseProps} loading />);

    expect(screen.queryByTestId("document-filter-panel")).toBeNull();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("closes on Update search", async () => {
    const user = userEvent.setup();
    render(<DocumentSearchResultsPanel {...baseProps} />);

    await user.click(screen.getByTestId("document-filter-trigger-phone"));
    const done = within(screen.getByTestId("document-filter-panel")).getByTestId("document-filter-panel-done");
    expect(done).toHaveTextContent("Update search");

    await user.click(done);
    expect(screen.queryByTestId("document-filter-panel")).toBeNull();
  });

  it("closes when the search query changes", async () => {
    // Open state is query-scoped (same contract as facet keys). A new submit must
    // not leave the panel covering a different result set.
    const user = userEvent.setup();
    const { rerender } = render(<DocumentSearchResultsPanel {...baseProps} />);

    await user.click(screen.getByTestId("document-filter-trigger-phone"));
    expect(screen.getByTestId("document-filter-panel")).toBeInTheDocument();

    rerender(<DocumentSearchResultsPanel {...baseProps} query="lithium" />);
    expect(screen.queryByTestId("document-filter-panel")).toBeNull();
    expect(screen.getByTestId("document-filter-trigger-phone")).toHaveAttribute("aria-expanded", "false");
  });
});

describe("applied-filter shelf", () => {
  async function selectClozapine(
    user: ReturnType<typeof userEvent.setup>,
    view: ReturnType<typeof render>,
    props = baseProps,
  ) {
    await user.click(screen.getByTestId("document-filter-trigger-phone"));
    await user.click(within(screen.getByTestId("document-filter-panel")).getByRole("button", { name: /^Medication/ }));
    await user.click(within(screen.getByTestId("document-filter-panel")).getByRole("button", { name: /Clozapine/ }));
    await user.click(within(screen.getByTestId("document-filter-panel")).getByTestId("document-filter-panel-done"));
    view.rerender(<DocumentSearchResultsPanel {...props} />);
  }

  it("shows an applied facet as a chip and removes it in one tap", async () => {
    const user = userEvent.setup();
    const view = render(<DocumentSearchResultsPanel {...baseProps} />);
    expect(screen.queryByTestId("search-query-ribbon-shelf")).toBeNull();

    await selectClozapine(user, view);

    const shelf = screen.getByTestId("search-query-ribbon-shelf");
    expect(shelf).toHaveTextContent("Filtered by");
    expect(resultTitles()).toHaveLength(1);

    // One tap, and the count follows immediately.
    await user.click(within(shelf).getByRole("button", { name: /Remove Medication: Clozapine filter/ }));
    view.rerender(<DocumentSearchResultsPanel {...baseProps} matches={[...baseProps.matches]} />);
    expect(resultTitles()).toHaveLength(2);
    expect(screen.queryByTestId("search-query-ribbon-shelf")).toBeNull();
  });

  it("carries the source type alongside facets, and Clear tears both down at once", async () => {
    const user = userEvent.setup();
    const view = render(<DocumentSearchResultsPanel {...baseProps} />);

    await user.click(screen.getByTestId("document-filter-trigger-phone"));
    const panel = screen.getByTestId("document-filter-panel");
    await user.click(within(panel).getByRole("button", { name: /^Medication/ }));
    await user.click(within(panel).getByRole("button", { name: /Clozapine/ }));
    await user.click(within(panel).getByRole("radio", { name: /Tables/ }));
    await user.click(within(panel).getByTestId("document-filter-panel-done"));
    view.rerender(<DocumentSearchResultsPanel {...baseProps} />);

    const shelf = screen.getByTestId("search-query-ribbon-shelf");
    expect(within(shelf).getByRole("button", { name: /Remove Medication: Clozapine filter/ })).toBeInTheDocument();
    expect(within(shelf).getByRole("button", { name: /Remove Result type: Tables filter/ })).toBeInTheDocument();

    // Clear appears only past one chip — teardown that used to be one tap each.
    await user.click(within(shelf).getByTestId("search-query-ribbon-shelf-clear"));
    view.rerender(<DocumentSearchResultsPanel {...baseProps} matches={[...baseProps.matches]} />);
    expect(screen.queryByTestId("search-query-ribbon-shelf")).toBeNull();
    expect(resultTitles()).toHaveLength(2);
  });

  it("survives a pending search, because chips must not flicker on every keystroke", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DocumentSearchResultsPanel {...baseProps} />);
    await user.click(screen.getByTestId("document-filter-trigger-phone"));
    await user.click(within(screen.getByTestId("document-filter-panel")).getByRole("button", { name: /^Medication/ }));
    await user.click(within(screen.getByTestId("document-filter-panel")).getByRole("button", { name: /Clozapine/ }));
    await user.click(within(screen.getByTestId("document-filter-panel")).getByTestId("document-filter-panel-done"));
    rerender(<DocumentSearchResultsPanel {...baseProps} />);
    expect(screen.getByTestId("search-query-ribbon-shelf")).toBeInTheDocument();

    rerender(<DocumentSearchResultsPanel {...baseProps} loading />);

    expect(screen.getByTestId("search-query-ribbon-shelf")).toBeInTheDocument();
  });

  it("keeps applied recovery visible when retrieval faults", async () => {
    const user = userEvent.setup();
    const view = render(<DocumentSearchResultsPanel {...baseProps} />);
    await selectClozapine(user, view);

    view.rerender(<DocumentSearchResultsPanel {...baseProps} apiUnavailable realDataReady={false} />);

    expect(screen.getByTestId("search-query-ribbon-shelf")).toBeInTheDocument();
  });
});

describe("document library recovery", () => {
  it("offers Library when the search itself has no matches", async () => {
    const user = userEvent.setup();
    const onOpenLibrary = vi.fn();
    render(<DocumentSearchResultsPanel {...baseProps} matches={[]} onOpenLibrary={onOpenLibrary} />);

    // Queried by text, not by role: the empty state announces through a bare
    // `aria-live` region rather than `role="status"`, because the band renders
    // its own status region unconditionally and a second one makes every
    // singular `getByRole("status")` in the suite ambiguous.
    expect(screen.getByText("No matches for “monitoring”")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Browse all 2 sources" }));
    expect(onOpenLibrary).toHaveBeenCalledTimes(1);
  });

  it("keeps Library reachable when a matched document exposes no filter dimensions", async () => {
    const user = userEvent.setup();
    const onOpenLibrary = vi.fn();
    const plainDoc = match({
      document_id: "44444444-4444-4444-8444-444444444444",
      title: "Plain note",
      file_name: "plain-note.pdf",
      labels: [],
      imageCount: 0,
      tableCount: 0,
    });

    render(
      <DocumentSearchResultsPanel
        {...baseProps}
        matches={[plainDoc]}
        documentCount={17}
        onOpenLibrary={onOpenLibrary}
      />,
    );

    expect(screen.queryByTestId("document-filter-trigger-phone")).toBeNull();
    const browse = screen.getByTestId("document-results-browse-library");
    expect(browse).toHaveTextContent("17");
    await user.click(browse);
    expect(onOpenLibrary).toHaveBeenCalledTimes(1);
  });
});

describe("filter sheet — density, exclusivity and reach", () => {
  // Enough groups to cross the density threshold. Eleven groups in one phone
  // column is the case F9 is about; below four, collapsing buys nothing.
  const denseDoc = match({
    document_id: "33333333-3333-4333-8333-333333333333",
    title: "Community Discharge Planning",
    labels: [
      label("33333333-3333-4333-8333-333333333333", "lithium", "medication"),
      label("33333333-3333-4333-8333-333333333333", "monitoring", "clinical_action"),
      label("33333333-3333-4333-8333-333333333333", "community", "setting"),
      label("33333333-3333-4333-8333-333333333333", "discharge", "care_phase"),
      label("33333333-3333-4333-8333-333333333333", "suicide", "risk"),
      label("33333333-3333-4333-8333-333333333333", "fiona stanley hospital", "site"),
    ],
  });
  const denseProps = { ...baseProps, matches: [denseDoc, clozapineDoc, lithiumDoc], documentCount: 2014 };

  it("puts every facet on the tap floor, not the 28px it shipped with", async () => {
    const { user, panel } = await openPanel();

    // The sheet is the primary phone filtering surface and these are its only
    // interactive elements. `min-h-7` was 28px, packed at `gap-1.5`, so a
    // neighbouring mis-tap was likely.
    await user.click(within(panel).getByRole("button", { name: /^Medication/ }));
    const facet = within(panel).getByRole("button", { name: /Clozapine/ });
    expect(facet.className).toContain("min-h-tap");
    expect(facet.className).not.toContain("min-h-7");
    // ChoiceChip keeps the documented 48px carrier at every breakpoint rather
    // than reintroducing the former 40px desktop exception.
    expect(facet.className).not.toContain("sm:min-h-10");
    expect(facet.className).not.toContain("lg:min-h-8");
  });

  it("says which group replaces and which accumulate", async () => {
    const { user, panel } = await openPanel();

    // Result type is a radiogroup and the facets are aria-pressed toggles, but
    // both rendered as chips of near-identical size, colour and radius, directly
    // adjacent — so the OR-within-group, AND-across-groups model had to be
    // discovered by experiment. The joined control is the shape cue; this is the
    // words.
    expect(within(panel).getByText("one only")).toBeVisible();
    expect(within(panel).getByRole("radio", { name: /All/ })).toHaveAttribute("aria-checked", "true");
    await user.click(within(panel).getByRole("button", { name: /^Medication/ }));
    expect(within(panel).getByRole("button", { name: /Clozapine/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("collapses groups and offers a find-a-filter field once the count earns it", async () => {
    const { user, panel } = await openPanel(denseProps);

    const medication = within(panel).getByRole("button", { name: /^Medication/ });
    expect(medication).toHaveAttribute("aria-expanded", "false");
    // A collapsed group hides its facets — that is the point — so reaching
    // Document type is no longer a scroll past ten sections.
    expect(within(panel).queryByRole("button", { name: /Clozapine/ })).toBeNull();

    await user.click(medication);
    expect(medication).toHaveAttribute("aria-expanded", "true");
    expect(within(panel).getByRole("button", { name: /Clozapine/ })).toBeVisible();

    // The field collapses an eleven-section scroll to one interaction, and
    // expands whatever it matched so the result is usable without a second tap.
    await user.type(within(panel).getByTestId("document-filter-panel-find"), "community");
    expect(within(panel).getByRole("button", { name: /Community/ })).toBeVisible();
    expect(within(panel).queryByRole("button", { name: /Clozapine/ })).toBeNull();
  });

  it("finds an abbreviated site label by its canonical text", async () => {
    const { user, panel } = await openPanel(denseProps);

    await user.type(within(panel).getByTestId("document-filter-panel-find"), "fiona stanley hospital");

    expect(within(panel).getByRole("button", { name: /FSH/ })).toBeVisible();
  });

  it("stops advertising a disclosure while the find field owns what is open", async () => {
    const { user, panel } = await openPanel(denseProps);

    // With a needle typed, the search decides which groups are open, so the
    // heading has nothing left to disclose and must stop claiming it does.
    // Before this guard the button survived: tapping it left `aria-expanded`
    // true and hid nothing, while still recording the group as collapsed — so
    // the collapse landed later, after the field was cleared and the tap
    // forgotten. A control that reports success and does nothing is the defect
    // the sibling comment in this panel already names.
    expect(within(panel).getByRole("button", { name: /^Setting/ })).toHaveAttribute("aria-expanded", "false");

    await user.type(within(panel).getByTestId("document-filter-panel-find"), "community");
    expect(within(panel).queryByRole("button", { name: /^Setting/ })).toBeNull();
    const heading = within(panel).getByText("Setting", { selector: "span" });
    expect(heading).toBeVisible();
    expect(heading.closest("button")).toBeNull();
    // The search still opens what it matched — that is its job.
    expect(within(panel).getByRole("button", { name: /Community/ })).toBeVisible();

    // Clearing returns the group to exactly the state it was in before the
    // search, rather than to a collapse recorded by a tap that appeared to do
    // nothing at the time.
    await user.clear(within(panel).getByTestId("document-filter-panel-find"));
    expect(within(panel).getByRole("button", { name: /^Setting/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("opens a selected group by default but honours an explicit collapse", async () => {
    const { user, panel } = await openPanel(denseProps);

    await user.click(within(panel).getByRole("button", { name: /^Medication/ }));
    await user.click(within(panel).getByRole("button", { name: /Lithium/ }));

    // The selected count keeps a collapsed group honest, while the disclosure
    // remains a real control instead of snapping open again after every click.
    const medication = within(panel).getByRole("button", { name: /^Medication/ });
    expect(medication).toHaveAttribute("aria-expanded", "true");
    expect(within(medication).getByText("1 selected")).toBeVisible();
    await user.click(medication);
    expect(within(panel).getByRole("button", { name: /^Medication/ })).toHaveAttribute("aria-expanded", "false");
    expect(within(panel).queryByRole("button", { name: /Lithium/ })).toBeNull();
  });

  it("forgets the find-a-filter needle when the search query changes", async () => {
    // The panel stays mounted while closed (`Sheet` returns null), so a bare
    // useState for the find field would keep "clozapine" typed in after the
    // reader has already submitted a different search — hiding the new result
    // set's facets until they notice and clear the field.
    const user = userEvent.setup();
    const { rerender } = render(<DocumentSearchResultsPanel {...denseProps} />);

    await user.click(screen.getByTestId("document-filter-trigger-phone"));
    await user.type(
      within(screen.getByTestId("document-filter-panel")).getByTestId("document-filter-panel-find"),
      "clozapine",
    );
    expect(within(screen.getByTestId("document-filter-panel")).getByTestId("document-filter-panel-find")).toHaveValue(
      "clozapine",
    );
    await user.click(within(screen.getByTestId("document-filter-panel")).getByTestId("document-filter-panel-done"));

    rerender(<DocumentSearchResultsPanel {...denseProps} query="lithium" />);
    await user.click(screen.getByTestId("document-filter-trigger-phone"));
    expect(within(screen.getByTestId("document-filter-panel")).getByTestId("document-filter-panel-find")).toHaveValue(
      "",
    );
  });

  it("keeps a selected facet reachable while the find field is narrowing the list", async () => {
    const { user, panel } = await openPanel(denseProps);

    await user.click(within(panel).getByRole("button", { name: /^Medication/ }));
    await user.click(within(panel).getByRole("button", { name: /Lithium/ }));
    await user.type(within(panel).getByTestId("document-filter-panel-find"), "community");

    // "Lithium" does not match "community", but it is still narrowing the list —
    // hiding it here would leave an active constraint with no in-sheet undo.
    expect(within(panel).getByRole("button", { name: /Lithium/ })).toBeVisible();
    expect(within(panel).getByRole("button", { name: /Community/ })).toBeVisible();
  });

  it("keeps dense search for the unified retrieval and result sections", async () => {
    const { panel } = await openPanel();

    expect(within(panel).getByTestId("document-filter-panel-find")).toBeVisible();
    expect(within(panel).getByRole("button", { name: /^Medication/ })).toHaveAttribute("aria-expanded", "false");
    expect(within(panel).getByRole("button", { name: /^Source status/ })).toBeVisible();
  });

  it("moves Library off the rail into the sheet footer", async () => {
    const { user, panel } = await openPanel(denseProps);

    // F12: Library and Filter sat adjacent in the rail answering different
    // questions, and Library occupied the space the pinned Filter needs.
    expect(screen.queryByRole("button", { name: "Open source library" })).toBeNull();

    const browse = within(panel).getByRole("button", { name: /Browse all sources/ });
    expect(browse).toHaveTextContent("Browse all sources");
    // The corpus count, beside it — reach, stated as a size.
    expect(browse).toHaveTextContent("2,014");
    await user.click(browse);
    expect(denseProps.onOpenLibrary).toHaveBeenCalled();
  });

  it("states the proportion once, and warns when the combination returns nothing", async () => {
    const { user, panel } = await openPanel(denseProps);

    expect(
      within(panel).getByRole("progressbar", { name: "Visible retrieved matches" }).parentElement,
    ).toHaveTextContent("3 of 3 retrieved matches visible");
    expect(within(panel).getByTestId("document-filter-panel-done")).toHaveTextContent("Update search");

    // Clozapine and Suicide sit on different fixture documents, so the pair
    // would return nothing. The panel does not let you build that: once
    // Clozapine narrows the set, Suicide re-counts to 0 and becomes a dead end,
    // and dead ends are click-guarded. Selecting one is the only way to reach a
    // zero result through this surface, so the surface prevents it.
    //
    // That is the behaviour worth pinning. An earlier version of this test
    // expected "Show 0 documents" here and failed, because it read the dead-end
    // guard as a bug rather than as the feature stopping it.
    await user.click(within(panel).getByRole("button", { name: /^Medication/ }));
    await user.click(within(panel).getByRole("button", { name: /Clozapine/ }));
    await user.click(within(panel).getByRole("button", { name: /^Risk/ }));

    const suicide = within(panel).getByRole("button", { name: /Suicide/ });
    expect(suicide).toHaveAttribute("aria-disabled", "true");
    // Copy moved to the shared component's generic dead-end reason
    // (`result-filter-control.tsx`) when documents converged onto
    // `ResultFilterFacetChips` — the guard mechanics (disabled, focusable,
    // click-blocked) are unchanged and asserted below.
    expect(suicide).toHaveAccessibleDescription(/No matches with your current filters/);
    await user.click(suicide);

    // Unchanged: the guarded click did not empty the list behind the reader.
    expect(within(panel).getByTestId("document-filter-panel-done")).toHaveTextContent("Update search");
    expect(
      within(panel).getByRole("progressbar", { name: "Visible retrieved matches" }).parentElement,
    ).toHaveTextContent("1 of 3 retrieved matches visible");
  });
});

// #M3XZV0 (documents half). The filter sheet was mounted only while open, so
// closing it unmounted the Sheet, whose unmount guard skips focus restore:
// focus fell to <body> although the trigger was still in the DOM (WCAG 2.4.3).
describe("document filter sheet focus return (#M3XZV0)", () => {
  it("returns focus to the trigger when closed with Escape", async () => {
    const { user } = await openPanel();
    const trigger = screen.getByTestId("document-filter-trigger-phone");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("document-filter-panel")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("returns focus to the trigger when closed with the close button", async () => {
    const { user, panel } = await openPanel();
    const trigger = screen.getByTestId("document-filter-trigger-phone");
    await user.click(within(panel).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByTestId("document-filter-panel")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("returns focus to the trigger that opened it even when the click did not focus it", async () => {
    // Safari does not focus a button on click, so the previously focused element
    // is <body>; the sheet must still know which trigger opened it.
    render(<DocumentSearchResultsPanel {...baseProps} />);
    const wideTrigger = screen.getByTestId("document-filter-trigger-wide");
    fireEvent.click(wideTrigger);
    const panel = screen.getByTestId("document-filter-panel");
    expect(document.activeElement).not.toBe(wideTrigger);
    fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByTestId("document-filter-panel")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(wideTrigger));
  });

  it("renders nothing for the sheet while closed", () => {
    render(<DocumentSearchResultsPanel {...baseProps} />);
    expect(screen.queryByTestId("document-filter-panel")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
