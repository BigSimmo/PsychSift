import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { installMatchMediaStub } from "./setup/jsdom.setup";

vi.mock("@/components/clinical-dashboard/signed-image", () => ({
  SignedImage: ({
    caption,
    alt,
    failurePresentation,
    onSettledFailure,
  }: {
    caption?: string;
    alt?: string;
    failurePresentation?: "message" | "hidden";
    onSettledFailure?: (failure: {
      source: "response";
      status: number;
      retryable: boolean;
      retryAfterMs: null;
    }) => void;
  }) => (
    <>
      <p>{caption ?? alt}</p>
      {failurePresentation === "hidden" && onSettledFailure ? (
        <button
          type="button"
          data-testid="settle-hidden-signed-image"
          onClick={() => onSettledFailure({ source: "response", status: 404, retryable: false, retryAfterMs: null })}
        >
          Settle hidden image failure
        </button>
      ) : null}
    </>
  ),
}));

import { AnswerUtilityActions } from "@/components/clinical-dashboard/evidence-panels";
import { AnswerSourceDrawer } from "@/components/clinical-dashboard/answer-source-drawer";
import { AnswerSourceRail } from "@/components/clinical-dashboard/answer-source-rail";
import {
  type AnswerSourceRow,
  answerSourceRailRowId,
  buildAnswerSourceRows,
  sourceCapsuleDisplay,
  sourceSupportSentence,
} from "@/components/clinical-dashboard/answer-source-rows";
import type { ClientSearchResult } from "@/lib/answer-client-payload";
import type { SourceLink } from "@/lib/answer-render-policy";
import { normalizeSourceMetadata } from "@/lib/source-metadata";
import type { VisualEvidenceCard } from "@/lib/types";

/**
 * The rail and the drawer replaced four separate source surfaces (the "Sources"
 * capsule and its popover/sheet pair, the Evidence sheet, the Clinical notes
 * sheet, and the wide-screen table column), so the behaviours that used to be
 * spread across those are now pinned here.
 *
 * Three of these are contracts rather than preferences:
 *
 * - Compact citations may hide the "Sources" label but never the missing-source
 *   warning, and never the rows themselves — only collapse them behind a chip.
 * - The drawer's support sentence has a null case. Opened from the rail there is
 *   no claim, so it must not assert one.
 * - Tap targets are 48 px. `min-h-11` (44 px) reintroduces a known ui-smoke flake.
 */

function row(overrides: Partial<AnswerSourceRow> & { id: string; title: string }): AnswerSourceRow {
  return {
    documentId: `doc-${overrides.id}`,
    pageNumber: 4,
    metadata: normalizeSourceMetadata(null),
    score: 0.8,
    href: `/documents/${overrides.id}?chunk=${overrides.id}`,
    ...overrides,
  };
}

const SOURCES: AnswerSourceRow[] = [
  row({ id: "s1", title: "Clozapine monitoring protocol", sourceStrength: "strong", snippet: "Check FBC weekly." }),
  row({ id: "s2", title: "Metabolic screening standard", pageNumber: 11, sourceStrength: "limited" }),
  row({
    id: "s3",
    title: "Superseded myocarditis guidance",
    pageNumber: 2,
    sourceStrength: "moderate",
    metadata: normalizeSourceMetadata({ document_status: "outdated" }),
  }),
];

function visualCard(
  overrides: Partial<VisualEvidenceCard> & Pick<VisualEvidenceCard, "id" | "source_chunk_id">,
): VisualEvidenceCard {
  return {
    image_id: overrides.id,
    signed_url_endpoint: `/api/images/${overrides.id}`,
    caption: "Cited figure",
    document_id: "doc-shared",
    title: "Shared protocol",
    file_name: "protocol.pdf",
    page_number: 4,
    chunk_index: 0,
    viewer_href: "/documents/doc-shared",
    ...overrides,
  };
}

function RailAndDrawer({
  sources = SOURCES,
  visualEvidence = [],
  onScopeDocument,
  onReportSource,
}: {
  sources?: AnswerSourceRow[];
  visualEvidence?: VisualEvidenceCard[];
  onScopeDocument?: (documentId: string) => void;
  onReportSource?: (source: AnswerSourceRow) => void;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  return (
    <>
      <AnswerSourceRail sources={sources} query="clozapine monitoring" onOpenSource={setOpenIndex} />
      <AnswerSourceDrawer
        sources={sources}
        openIndex={openIndex}
        onOpenIndexChange={setOpenIndex}
        onClose={() => setOpenIndex(null)}
        visualEvidence={visualEvidence}
        onScopeDocument={onScopeDocument}
        onReportSource={onReportSource}
      />
    </>
  );
}

describe("answer source rail", () => {
  it("keeps an exact fifth citation cited after the low-trust primary-source cap", () => {
    const sources: ClientSearchResult[] = Array.from({ length: 6 }, (_, index) => ({
      id: `chunk-${index + 1}`,
      document_id: `doc-${index + 1}`,
      title: index === 5 ? "Retrieved but uncited" : `Cited source ${index + 1}`,
      file_name: `source-${index + 1}.pdf`,
      page_number: index + 1,
      chunk_index: index,
      section_heading: "Monitoring",
      content: "Synthetic source passage.",
      image_ids: [],
      similarity: 0.9 - index * 0.01,
      source_metadata: normalizeSourceMetadata({ document_status: "current" }),
    }));
    const primarySources: SourceLink[] = sources.slice(0, 4).map((source) => ({
      id: source.id,
      chunk_id: source.id,
      document_id: source.document_id,
      title: source.title,
      file_name: source.file_name,
      page_number: source.page_number,
      href: `/documents/${source.document_id}?page=${source.page_number}&chunk=${source.id}`,
      label: source.title,
      sourceStrength: "strong",
      reason: "Cited by the generated answer.",
      sourceMetadata: source.source_metadata,
      score: source.similarity,
    }));

    const rows = buildAnswerSourceRows(
      null,
      sources,
      primarySources,
      new Set(sources.slice(0, 5).map((source) => source.id)),
    );

    expect(rows.map((source) => source.id)).toEqual(sources.map((source) => source.id));
    expect(rows.map((source) => source.cited)).toEqual([true, true, true, true, true, false]);
  });

  it("shows one card per cited document with its page and status", () => {
    render(<AnswerSourceRail sources={SOURCES} onOpenSource={vi.fn()} />);
    const rows = screen.getAllByTestId("answer-source-rail-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Clozapine monitoring protocol");

    const rail = screen.getByTestId("answer-source-rail");
    expect(within(rail).getByText("p. 11")).toBeInTheDocument();
    // Decision 1: staleness is carried by the card, not by a second mark colour.
    expect(within(rail).getByText("Outdated")).toBeInTheDocument();
  });

  it("carries support in each card's accessible name rather than on its face", () => {
    // The card face is page + status (design contract §4). Support is a clause of
    // words in the drawer, where the reader is looking at the passage it
    // describes — but an `aria-label` REPLACES the card's own text, so dropping
    // support from the label would take it away from screen-reader users
    // entirely rather than relocating it.
    render(<AnswerSourceRail sources={SOURCES} onOpenSource={vi.fn()} />);
    const rows = screen.getAllByTestId("answer-source-rail-row");
    expect(rows[0]).toHaveAccessibleName(/Source 1: Clozapine monitoring protocol, p\. 4, [A-Za-z ]+, Direct/);
    expect(rows[1]).toHaveAccessibleName(/Partial/);
    expect(rows[2]).toHaveAccessibleName(/Outdated/);
  });

  it("numbers cited documents only, so a number always matches an in-prose mark", () => {
    render(
      <AnswerSourceRail
        sources={[
          row({ id: "c1", title: "Cited protocol", cited: true }),
          row({ id: "r1", title: "Retrieved but uncited", cited: false }),
        ]}
        onOpenSource={vi.fn()}
      />,
    );
    const rows = screen.getAllByTestId("answer-source-rail-row");
    expect(rows[0]).toHaveAttribute("data-cited", "true");
    expect(rows[0]).toHaveTextContent("1");
    expect(rows[1]).toHaveAttribute("data-cited", "false");
    // An em-dash, never "2": a number here that no mark can reach is a promise
    // the prose cannot keep.
    expect(rows[1]).not.toHaveTextContent("2");
    expect(rows[1]).toHaveAccessibleName(/Also found: Retrieved but uncited/);
  });

  it("marks the card the drawer is showing", () => {
    render(<AnswerSourceRail sources={SOURCES} onOpenSource={vi.fn()} activeIndex={1} />);
    const rows = screen.getAllByTestId("answer-source-rail-row");
    expect(rows[0]).toHaveAttribute("aria-pressed", "false");
    expect(rows[1]).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps every row reachable and links straight to the document when no drawer is mounted", () => {
    render(<AnswerSourceRail sources={SOURCES} query="clozapine" />);
    const rows = screen.getAllByTestId("answer-source-rail-row");
    expect(rows).toHaveLength(3);
    // A historical thread turn mounts no drawer, so a row must navigate rather
    // than advertise a panel that will never open.
    expect(rows[0].tagName).toBe("A");
    expect(rows[0]).toHaveAttribute("href", "/documents/s1?chunk=s1");
  });

  it("does not reuse the live drawer's return-focus ids on a prior-turn rail", () => {
    render(
      <>
        <AnswerSourceRail sources={SOURCES} query="earlier turn" />
        <RailAndDrawer />
      </>,
    );

    const identified = [...document.querySelectorAll("[id^='answer-source-rail-row-']")];
    expect(identified.map((node) => node.id)).toEqual(SOURCES.map((_, index) => answerSourceRailRowId(index)));
    expect(document.getElementById(answerSourceRailRowId(0))?.tagName).toBe("BUTTON");

    const listIds = [...document.querySelectorAll('[role="list"][aria-label="Cited documents"]')].map(
      (node) => node.id,
    );
    expect(listIds).toHaveLength(2);
    expect(new Set(listIds).size).toBe(2);
  });

  it("collapses to a single chip under compact citations and expands back to the same rows", async () => {
    const user = userEvent.setup();
    render(<AnswerSourceRail sources={SOURCES} onOpenSource={vi.fn()} compact />);

    expect(screen.queryAllByTestId("answer-source-rail-row")).toHaveLength(0);
    const toggle = screen.getByTestId("answer-source-rail-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByTestId("answer-source-rail-row")).toHaveLength(3);
  });

  it("never hides the missing-source warning, compact or not", () => {
    const { rerender } = render(<AnswerSourceRail sources={[]} onOpenSource={vi.fn()} />);
    expect(screen.getByTestId("answer-source-rail-empty")).toHaveTextContent("No direct source found");

    rerender(<AnswerSourceRail sources={[]} onOpenSource={vi.fn()} compact />);
    expect(screen.getByTestId("answer-source-rail-empty")).toHaveTextContent("No direct source found");
    // The shared derivation agrees, which is what the settings toggle reads.
    expect(sourceCapsuleDisplay({ sourceCount: 0, compact: true }).showLabelText).toBe(true);
  });
});

describe("answer source drawer", () => {
  it("opens on the row that was tapped and pages between sources", async () => {
    const user = userEvent.setup();
    render(<RailAndDrawer />);

    await user.click(screen.getAllByTestId("answer-source-rail-row")[0]);
    const drawer = screen.getByTestId("answer-source-drawer");
    expect(within(drawer).getByText("Clozapine monitoring protocol")).toBeInTheDocument();

    const pager = screen.getByTestId("answer-source-drawer-pager");
    // Three sources still fit the numbered pager; it degrades past four.
    expect(pager).toHaveAttribute("data-pager-variant", "numbered");
    await user.click(within(pager).getByRole("button", { name: "Next source" }));
    expect(
      within(screen.getByTestId("answer-source-drawer")).getByText("Metabolic screening standard"),
    ).toBeInTheDocument();
  });

  it("says so when a source carries no captured passage", async () => {
    // A retrieved-but-uncited row has neither a quote card nor a snippet. With
    // the cover and the no-claim sentence gone, the panel would otherwise be a
    // lone "View original PDF" button, which reads as a failure to load.
    const user = userEvent.setup();
    render(<RailAndDrawer sources={[row({ id: "n1", title: "No captured passage" })]} />);

    await user.click(screen.getAllByTestId("answer-source-rail-row")[0]);
    const drawer = screen.getByTestId("answer-source-drawer");
    expect(within(drawer).getByTestId("answer-source-drawer-no-passage")).toHaveTextContent(
      "No passage was captured for this source.",
    );
    expect(within(drawer).getByRole("link", { name: "View original PDF" })).toBeInTheDocument();
  });

  it("degrades the pager to prev / n of m above four sources", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 5 }, (_, index) => row({ id: `m${index}`, title: `Source number ${index + 1}` }));
    render(<RailAndDrawer sources={many} />);

    await user.click(screen.getAllByTestId("answer-source-rail-row")[0]);
    const pager = screen.getByTestId("answer-source-drawer-pager");
    expect(pager).toHaveAttribute("data-pager-variant", "compact");
    expect(pager).toHaveTextContent("1 of 5");
  });

  it("keeps an uncited source unnumbered in the drawer title and numbered pager", async () => {
    // The rail dashing an uncited row is only half the promise: the drawer's
    // title pill and pager print the same numbering, and while they did it
    // unconditionally a clinician who opened an "Also found" card was shown a
    // digit for a source no mark in the prose names. Two independent reviews
    // found this within the hour, which is why the rule now has one home.
    const user = userEvent.setup();
    render(
      <RailAndDrawer
        sources={[
          row({ id: "c1", title: "Cited protocol", cited: true }),
          row({ id: "r1", title: "Retrieved but uncited", cited: false }),
        ]}
      />,
    );

    await user.click(screen.getAllByTestId("answer-source-rail-row")[1]);
    const drawer = screen.getByTestId("answer-source-drawer");
    expect(within(drawer).getByText("— · p. 4")).toBeInTheDocument();

    const pager = screen.getByTestId("answer-source-drawer-pager");
    const uncitedStep = within(pager).getByRole("button", {
      name: "Show also found source: Retrieved but uncited",
    });
    expect(uncitedStep).toHaveTextContent("—");
    expect(uncitedStep).not.toHaveTextContent("2");

    // The cited row keeps its digit: this is a distinction between cited and
    // retrieved, not a blanket removal of the numbering.
    await user.click(screen.getAllByTestId("answer-source-rail-row")[0]);
    expect(within(screen.getByTestId("answer-source-drawer")).getByText(/1\s*·\s*p\./)).toBeInTheDocument();
  });

  it("does not assert a claim when the drawer was opened from the source list", async () => {
    const user = userEvent.setup();
    render(<RailAndDrawer />);

    await user.click(screen.getAllByTestId("answer-source-rail-row")[0]);
    // No claim opened this drawer, so there is no support sentence at all — not
    // a line whose whole content is that there is no claim. The passage the
    // clinician came to read is what the panel opens on.
    expect(screen.queryByTestId("answer-source-drawer-support")).not.toBeInTheDocument();
    expect(screen.getByTestId("answer-source-drawer-passage")).toBeInTheDocument();
  });

  it("warns on a source that is past its review date", async () => {
    const user = userEvent.setup();
    render(<RailAndDrawer />);

    await user.click(screen.getAllByTestId("answer-source-rail-row")[2]);
    expect(screen.getByTestId("answer-source-drawer-status")).toHaveTextContent("past its review date");
  });

  it("shows the cited passage when the source carries one", async () => {
    const user = userEvent.setup();
    render(<RailAndDrawer />);

    await user.click(screen.getAllByTestId("answer-source-rail-row")[0]);
    expect(screen.getByTestId("answer-source-drawer-passage")).toHaveTextContent("Check FBC weekly.");
  });

  it("attaches an image only to the rail row that owns its chunk", async () => {
    const user = userEvent.setup();
    const sources = [
      row({ id: "chunk-a", documentId: "doc-shared", title: "Page 4 passage" }),
      row({ id: "chunk-b", documentId: "doc-shared", title: "Page 11 passage" }),
    ];
    render(
      <RailAndDrawer
        sources={sources}
        visualEvidence={[
          visualCard({
            id: "fig-a",
            source_chunk_id: "chunk-a",
            document_id: "doc-shared",
            caption: "Flowchart for chunk A",
          }),
        ]}
      />,
    );

    await user.click(screen.getAllByTestId("answer-source-rail-row")[1]);
    expect(screen.queryByTestId("answer-source-drawer-images")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Previous source" }));
    expect(screen.getByTestId("answer-source-drawer-images")).toBeInTheDocument();
  });

  it("sends an unmatched image to the first source only", async () => {
    const user = userEvent.setup();
    const sources = [
      row({ id: "chunk-a", documentId: "doc-shared", title: "Page 4 passage" }),
      row({ id: "chunk-b", documentId: "doc-shared", title: "Page 11 passage" }),
    ];
    render(
      <RailAndDrawer
        sources={sources}
        visualEvidence={[
          visualCard({
            id: "fig-orphan",
            source_chunk_id: "orphan-chunk",
            document_id: "doc-shared",
            caption: "Unmatched figure",
          }),
        ]}
      />,
    );

    await user.click(screen.getAllByTestId("answer-source-rail-row")[1]);
    expect(screen.queryByTestId("answer-source-drawer-images")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Previous source" }));
    expect(screen.getByTestId("answer-source-drawer-images")).toBeInTheDocument();
  });
});

describe("evidence gaps stay answer-level", () => {
  // The warnings are a statement about the answer's evidence, never about one
  // cited page, so they must not be rendered inside the rail or a source row.
  // They moved out of the utility row and into the header status chips on
  // 2026-08-31 (the approved specimen draws Copy plus two verdicts and nothing
  // else in the action row); this pins the new home and the fact that the rail
  // still does not own them.
  it("renders the answer's warnings once, from the answer surface, and never inside the source rail", () => {
    const surface = readFileSync(
      resolve(process.cwd(), "src/components/clinical-dashboard/answer-result-surface.tsx"),
      "utf8",
    );
    expect(surface).toContain('data-testid="answer-limitations-trigger"');
    expect(surface).toContain('id="answer-limitations-detail"');
    expect(surface).toContain("renderModel.warnings");

    const rail = readFileSync(
      resolve(process.cwd(), "src/components/clinical-dashboard/answer-source-rail.tsx"),
      "utf8",
    );
    expect(rail).not.toContain("evidence-gaps");
    expect(rail).not.toContain("warnings");
  });

  it("keeps the utility row to copy and the two verdicts", () => {
    render(<AnswerUtilityActions copied={false} onCopy={vi.fn()} onSubmitFeedback={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /^Cop(?:y|ied) with sources: answer and source status$/ }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("answer-feedback-useful")).toBeInTheDocument();
    expect(screen.getByTestId("answer-feedback-trigger")).toBeInTheDocument();
    expect(screen.queryByTestId("answer-limitations-trigger")).not.toBeInTheDocument();
  });
});

describe("support sentence", () => {
  it("speaks about the claim only when a claim pointed at the source", () => {
    // No claim, no sentence: the drawer says nothing about support rather than
    // spending a line to report the absence of a claim.
    expect(sourceSupportSentence(SOURCES[0], null)).toBeNull();
    expect(sourceSupportSentence(null, 0)).toBeNull();
    expect(sourceSupportSentence(SOURCES[0], 0)).toBe("This page states the claim directly.");
    expect(sourceSupportSentence(SOURCES[1], 1)).toContain("supports part of the claim");
    expect(sourceSupportSentence(row({ id: "x", title: "Unrelated" }), 2)).toContain("does not state the claim");
  });

  it("uses the claim's support, not the document's, when a claim opened the drawer", () => {
    // A partial mark can sit on a strong row. Speaking the row's strength
    // would contradict the mark the clinician just tapped.
    expect(sourceSupportSentence(SOURCES[0], 0, "partial")).toContain("supports part of the claim");
    expect(sourceSupportSentence(SOURCES[1], 1, "direct")).toBe("This page states the claim directly.");
  });
});

describe("source drawer overflow menu", () => {
  async function openMenu(user: ReturnType<typeof userEvent.setup>, props = {}) {
    render(<RailAndDrawer {...props} />);
    await user.click(screen.getAllByTestId("answer-source-rail-row")[0]);
    await user.click(screen.getByTestId("answer-source-drawer-menu-trigger"));
    return screen.getByTestId("answer-source-drawer-menu");
  }

  it("keeps the secondary actions behind a menu so the passage stays the panel's subject", async () => {
    const user = userEvent.setup();
    const onScopeDocument = vi.fn();
    const menu = await openMenu(user, { onScopeDocument });

    expect(within(menu).getByRole("button", { name: "Copy passage" })).toBeInTheDocument();
    await user.click(within(menu).getByRole("button", { name: "Search only this document" }));
    expect(onScopeDocument).toHaveBeenCalledWith("doc-s1");
  });

  it("takes two steps to report that a page does not support the claim", async () => {
    const user = userEvent.setup();
    const onReportSource = vi.fn();
    const menu = await openMenu(user, { onReportSource });

    const report = within(menu).getByTestId("answer-source-drawer-report");
    await user.click(report);
    // One stray tap in a menu opened to copy a quote must not file a
    // citation-quality report against a named page.
    expect(onReportSource).not.toHaveBeenCalled();
    expect(report).toHaveTextContent("Confirm: report this page");

    await user.click(report);
    expect(onReportSource).toHaveBeenCalledTimes(1);
    expect(onReportSource.mock.calls[0][0].id).toBe("s1");
  });

  it("does not offer the claim-mismatch report for an uncited source", async () => {
    // "This page doesn't support the claim" presupposes a claim pointing here.
    // An "Also found" row has none, so the report would be a citation-quality
    // complaint about a citation nobody made. The document actions stay.
    const user = userEvent.setup();
    const onReportSource = vi.fn();
    render(
      <RailAndDrawer
        sources={[
          row({ id: "c1", title: "Cited protocol", cited: true }),
          row({ id: "r1", title: "Retrieved but uncited", cited: false }),
        ]}
        onReportSource={onReportSource}
        onScopeDocument={vi.fn()}
      />,
    );

    await user.click(screen.getAllByTestId("answer-source-rail-row")[1]);
    await user.click(screen.getByTestId("answer-source-drawer-menu-trigger"));
    const menu = screen.getByTestId("answer-source-drawer-menu");
    expect(within(menu).queryByTestId("answer-source-drawer-report")).toBeNull();
    expect(within(menu).getByRole("button", { name: "Search only this document" })).toBeInTheDocument();

    // The cited row still offers it, so this is a distinction and not a removal.
    await user.keyboard("{Escape}");
    await user.click(screen.getAllByTestId("answer-source-rail-row")[0]);
    await user.click(screen.getByTestId("answer-source-drawer-menu-trigger"));
    expect(
      within(screen.getByTestId("answer-source-drawer-menu")).getByTestId("answer-source-drawer-report"),
    ).toBeInTheDocument();
  });

  it("returns focus to the trigger after an action that leaves the drawer open", async () => {
    // The focused menu button unmounts with the menu. Without an explicit
    // return, focus falls to <body> while a modal dialog is still on screen,
    // which leaves a keyboard user outside the dialog with nothing to tab from.
    const user = userEvent.setup();
    const onReportSource = vi.fn();
    const menu = await openMenu(user, { onReportSource });

    const report = within(menu).getByTestId("answer-source-drawer-report");
    await user.click(report);
    await user.click(screen.getByTestId("answer-source-drawer-report"));

    expect(onReportSource).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("answer-source-drawer-menu")).not.toBeInTheDocument();
    // Still inside the open drawer, on the control that opened the menu.
    expect(screen.getByTestId("answer-source-drawer")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByTestId("answer-source-drawer-menu-trigger"));
  });

  it("closes the menu on Escape without closing the drawer underneath it", async () => {
    const user = userEvent.setup();
    await openMenu(user, { onScopeDocument: vi.fn() });

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("answer-source-drawer-menu")).not.toBeInTheDocument();
    // Sheet listens for Escape on window and this layer listens on document,
    // which bubbles first — without stopPropagation one Escape closed both.
    expect(screen.getByTestId("answer-source-drawer")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("answer-source-drawer")).not.toBeInTheDocument();
  });

  it("disarms report confirm when the menu is dismissed without filing", async () => {
    const user = userEvent.setup();
    const onReportSource = vi.fn();
    const menu = await openMenu(user, { onReportSource });

    await user.click(within(menu).getByTestId("answer-source-drawer-report"));
    expect(within(menu).getByTestId("answer-source-drawer-report")).toHaveTextContent("Confirm: report this page");

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("answer-source-drawer-menu")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("answer-source-drawer-menu-trigger"));
    const reopened = screen.getByTestId("answer-source-drawer-menu");
    const report = within(reopened).getByTestId("answer-source-drawer-report");
    expect(report).toHaveTextContent("This page doesn't support the claim");

    await user.click(report);
    expect(onReportSource).not.toHaveBeenCalled();
    expect(report).toHaveTextContent("Confirm: report this page");
  });
});

/**
 * Desktop paging controls.
 *
 * The rail hides its scrollbar — correct for a finger and a trackpad, and a dead
 * end for a plain mouse, which has no horizontal gesture at all. Before the
 * chevrons every card past the right fade was drawn and then unreachable unless
 * the reader knew about shift + wheel.
 *
 * jsdom lays nothing out, so `scrollWidth` and `clientWidth` are both 0 and the
 * rail always reports "fits". `overflowBy` fakes the one measurement the hook
 * actually reads, which keeps these cases about the decision (does an end have
 * cards behind it?) rather than about layout.
 */
function overflowBy(element: HTMLElement, { scrollLeft, scrollWidth, clientWidth }: Record<string, number>) {
  // All three are defined rather than assigned: jsdom implements no layout, so its
  // `scrollLeft` setter is a no-op and the value would read back as 0.
  Object.defineProperty(element, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(element, "clientWidth", { configurable: true, value: clientWidth });
  Object.defineProperty(element, "scrollLeft", { configurable: true, value: scrollLeft, writable: true });
  // The listener sets React state, so the dispatch has to be an act() unit or the
  // assertion below runs against the pre-update render.
  act(() => {
    element.dispatchEvent(new Event("scroll"));
  });
}

describe("AnswerSourceRail desktop paging", () => {
  it("shows no control and no fade while every card already fits", () => {
    render(<AnswerSourceRail sources={SOURCES} onOpenSource={vi.fn()} />);

    expect(screen.queryByTestId("answer-source-rail-page-left")).not.toBeInTheDocument();
    expect(screen.queryByTestId("answer-source-rail-page-right")).not.toBeInTheDocument();
    expect(screen.queryByTestId("answer-source-rail-fade-right")).not.toBeInTheDocument();
  });

  it("offers only the end that still has cards behind it", () => {
    render(<AnswerSourceRail sources={SOURCES} onOpenSource={vi.fn()} />);
    const list = screen.getByRole("list", { name: "Cited documents" });

    overflowBy(list, { scrollLeft: 0, scrollWidth: 900, clientWidth: 300 });
    expect(screen.queryByTestId("answer-source-rail-page-left")).not.toBeInTheDocument();
    expect(screen.getByTestId("answer-source-rail-page-right")).toBeInTheDocument();

    overflowBy(list, { scrollLeft: 300, scrollWidth: 900, clientWidth: 300 });
    expect(screen.getByTestId("answer-source-rail-page-left")).toBeInTheDocument();
    expect(screen.getByTestId("answer-source-rail-page-right")).toBeInTheDocument();

    overflowBy(list, { scrollLeft: 600, scrollWidth: 900, clientWidth: 300 });
    expect(screen.getByTestId("answer-source-rail-page-left")).toBeInTheDocument();
    expect(screen.queryByTestId("answer-source-rail-page-right")).not.toBeInTheDocument();
  });

  it("stays out of the tab order but keeps an accessible name", () => {
    render(<AnswerSourceRail sources={SOURCES} onOpenSource={vi.fn()} />);
    overflowBy(screen.getByRole("list", { name: "Cited documents" }), {
      scrollLeft: 0,
      scrollWidth: 900,
      clientWidth: 300,
    });

    // Tabbing already walks the cards, so a tab stop here reaches nothing new —
    // but a control that does something must still say what it does, and
    // `aria-hidden` on an interactive element is how that gets lost.
    const control = screen.getByTestId("answer-source-rail-page-right");
    expect(control).toHaveAttribute("tabindex", "-1");
    expect(control).not.toHaveAttribute("aria-hidden");
    expect(control).toHaveAccessibleName("Show more cited documents");
  });

  it("re-measures when a new answer swaps the card list, with no scroll and no resize", () => {
    // The silent case: the rail keeps its own width, nothing scrolls, and neither
    // the scroll listener nor the ResizeObserver fires — so without the card count
    // in the effect's dependencies the edges would still describe the previous
    // answer's sources.
    const { rerender } = render(<AnswerSourceRail sources={SOURCES} onOpenSource={vi.fn()} />);
    const list = screen.getByRole("list", { name: "Cited documents" });
    overflowBy(list, { scrollLeft: 0, scrollWidth: 900, clientWidth: 300 });
    expect(screen.getByTestId("answer-source-rail-page-right")).toBeInTheDocument();

    // A shorter answer whose two cards fit. Only the measurement changes.
    Object.defineProperty(list, "scrollWidth", { configurable: true, value: 300 });
    rerender(<AnswerSourceRail sources={SOURCES.slice(0, 2)} onOpenSource={vi.fn()} />);

    expect(screen.queryByTestId("answer-source-rail-page-right")).not.toBeInTheDocument();
    expect(screen.queryByTestId("answer-source-rail-fade-right")).not.toBeInTheDocument();
  });

  it("pages by roughly a screen of cards, and drops the animation under reduced motion", async () => {
    const user = userEvent.setup();
    render(<AnswerSourceRail sources={SOURCES} onOpenSource={vi.fn()} />);
    const list = screen.getByRole("list", { name: "Cited documents" });
    const scrollBy = vi.fn();
    Object.defineProperty(list, "scrollBy", { configurable: true, value: scrollBy });
    overflowBy(list, { scrollLeft: 300, scrollWidth: 900, clientWidth: 300 });

    await user.click(screen.getByTestId("answer-source-rail-page-right"));
    expect(scrollBy).toHaveBeenCalledWith({ left: 240, behavior: "smooth" });

    await user.click(screen.getByTestId("answer-source-rail-page-left"));
    expect(scrollBy).toHaveBeenLastCalledWith({ left: -240, behavior: "smooth" });

    installMatchMediaStub(true);
    await user.click(screen.getByTestId("answer-source-rail-page-right"));
    expect(scrollBy).toHaveBeenLastCalledWith({ left: 240, behavior: "auto" });
  });
});

/**
 * Wheel panning.
 *
 * The chevrons make the far cards reachable; the wheel makes reaching them feel
 * ordinary. What these cases actually pin is the restraint: the rail may take the
 * gesture only while it has somewhere to go, because a reader scrolling the answer
 * with the pointer over the sources must never hit an invisible wall.
 */
function wheel(element: HTMLElement, init: WheelEventInit) {
  const event = new WheelEvent("wheel", { cancelable: true, ...init });
  act(() => {
    element.dispatchEvent(event);
  });
  return event;
}

describe("AnswerSourceRail wheel panning", () => {
  it("turns a vertical wheel into sideways movement while the rail can still move", () => {
    render(<AnswerSourceRail sources={SOURCES} onOpenSource={vi.fn()} />);
    const list = screen.getByRole("list", { name: "Cited documents" });
    overflowBy(list, { scrollLeft: 0, scrollWidth: 900, clientWidth: 300 });

    const event = wheel(list, { deltaY: 120 });
    expect(event.defaultPrevented).toBe(true);
    expect(list.scrollLeft).toBe(120);
  });

  it("hands the gesture back at each end, so the page never stalls under the pointer", () => {
    render(<AnswerSourceRail sources={SOURCES} onOpenSource={vi.fn()} />);
    const list = screen.getByRole("list", { name: "Cited documents" });

    overflowBy(list, { scrollLeft: 0, scrollWidth: 900, clientWidth: 300 });
    expect(wheel(list, { deltaY: -120 }).defaultPrevented).toBe(false);

    overflowBy(list, { scrollLeft: 600, scrollWidth: 900, clientWidth: 300 });
    expect(wheel(list, { deltaY: 120 }).defaultPrevented).toBe(false);
  });

  it("leaves a rail whose cards already fit entirely alone", () => {
    render(<AnswerSourceRail sources={SOURCES} onOpenSource={vi.fn()} />);
    const list = screen.getByRole("list", { name: "Cited documents" });
    overflowBy(list, { scrollLeft: 0, scrollWidth: 300, clientWidth: 300 });

    expect(wheel(list, { deltaY: 120 }).defaultPrevented).toBe(false);
  });

  it("does not touch a gesture the device already calls horizontal, or a pinch-zoom", () => {
    render(<AnswerSourceRail sources={SOURCES} onOpenSource={vi.fn()} />);
    const list = screen.getByRole("list", { name: "Cited documents" });
    overflowBy(list, { scrollLeft: 0, scrollWidth: 900, clientWidth: 300 });

    // A trackpad's sideways swipe already scrolls the rail natively; taking it
    // here would double the movement.
    expect(wheel(list, { deltaX: 120, deltaY: 10 }).defaultPrevented).toBe(false);
    // Ctrl-wheel is the browser's zoom.
    expect(wheel(list, { deltaY: 120, ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it("switches heading and aria-label to 'Documents searched' on refusals or zero cited sources", () => {
    const { rerender } = render(
      <AnswerSourceRail
        sources={[row({ id: "r1", title: "Searched protocol 1", cited: false })]}
        onOpenSource={vi.fn()}
      />,
    );
    expect(screen.getByTestId("answer-source-rail-heading")).toHaveTextContent("Documents searched");
    expect(screen.getByTestId("answer-source-rail-heading")).toHaveTextContent("1 searched");
    expect(screen.getByRole("list", { name: "Documents searched" })).toBeInTheDocument();

    rerender(
      <AnswerSourceRail
        sources={[row({ id: "c1", title: "Cited protocol 1", cited: true })]}
        onOpenSource={vi.fn()}
        isRefusal={true}
      />,
    );
    expect(screen.getByTestId("answer-source-rail-heading")).toHaveTextContent("Documents searched");
    expect(screen.getByTestId("answer-source-rail-heading")).toHaveTextContent("1 searched");
    expect(screen.getByRole("list", { name: "Documents searched" })).toBeInTheDocument();
    // A cited row on a refusal loses its number: it was searched, not relied on.
    expect(screen.getByTestId("answer-source-rail-row")).toHaveAttribute("data-cited", "false");
  });

  it("uses the same search-only wording on the compact chip for a refusal", () => {
    render(
      <AnswerSourceRail
        sources={[row({ id: "c1", title: "Cited protocol 1", cited: true })]}
        onOpenSource={vi.fn()}
        compact
        isRefusal
      />,
    );
    expect(screen.getByTestId("answer-source-rail-toggle")).toHaveTextContent("Documents searched");
  });
});
