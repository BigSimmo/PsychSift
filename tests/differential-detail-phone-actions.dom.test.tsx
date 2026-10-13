import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: () => {} }),
  usePathname: () => "/differentials/diagnoses/serotonin-toxicity",
}));

import { AccountDataProvider } from "@/components/account-data-provider";
import { DifferentialDetailPage } from "@/components/differentials/differential-detail-page";
import { curatedDifferentials, curatedEntryFor } from "@/lib/differential-curated";
import { differentialGroupScopeNote, type DifferentialDetailContext } from "@/lib/differential-detail";
import { getDifferentialRecord } from "@/lib/differentials";
import { AuthProvider } from "@/lib/supabase/client";

const SEROTONIN = "serotonin-toxicity";

function buildContext(slug: string, knownRelatedSlugs: string[]): DifferentialDetailContext {
  return {
    knownRelatedSlugs,
    relatedMapDetails: {},
    termLinks: {},
    overlapLinks: {},
    comparePresentation: null,
    curated: curatedEntryFor(slug),
    source: {
      version: "v10",
      exportedAt: "2026-07-11T00:00:00.000Z",
      reviewStatus: "Pending review",
      sourceTitle: "Differentials",
      sourceStatus: "review_due",
      validationStatus: "unverified",
    },
  };
}

function renderRecord(slug: string, knownRelatedSlugs: string[]) {
  const record = getDifferentialRecord(slug);
  if (!record) throw new Error(`missing catalogue record: ${slug}`);
  render(
    <AuthProvider>
      <AccountDataProvider>
        <DifferentialDetailPage record={record} detailContext={buildContext(slug, knownRelatedSlugs)} />
      </AccountDataProvider>
    </AuthProvider>,
  );
  return record;
}

/**
 * The clinician-authored "Do now" steps had exactly one surface, the Overview
 * rail, and that rail is desktop-only. On the phone this product is used on
 * while on call, the reviewed steps for serotonin toxicity, NMS, alcohol
 * withdrawal, catatonia, clozapine toxicity and postpartum psychosis never
 * appeared at all — the reader got the generated list the overlay was written
 * to replace.
 */
describe("the authored Do now steps on a phone", () => {
  it("heads authored steps 'Do now' and generated group points 'Points for this presentation'", () => {
    renderRecord(SEROTONIN, []);
    expect(within(screen.getByTestId("differential-do-now-phone")).getByRole("heading")).toHaveTextContent(/^Do now$/);
  });

  it("does not label generated group-level points as actions", () => {
    renderRecord("drug-induced-parkinsonism", []);
    expect(within(screen.getByTestId("differential-do-now-phone")).getByRole("heading")).toHaveTextContent(
      /^Points for this presentation$/,
    );
  });

  it("states the group scope once, and marks each group-level row 'Whole group'", () => {
    const record = getDifferentialRecord("drug-induced-parkinsonism")!;
    renderRecord("drug-induced-parkinsonism", []);
    const notes = screen.queryAllByTestId("differential-group-scope-note");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveTextContent(differentialGroupScopeNote(record));
    expect(screen.getAllByText("Whole group").length).toBeGreaterThan(0);
  });

  it("renders every authored step, escalation included", () => {
    renderRecord(SEROTONIN, []);

    const card = screen.getByTestId("differential-do-now-phone");
    const authored = curatedDifferentials[SEROTONIN]!.doNow!;
    expect(authored.length).toBe(5);
    for (const step of authored) {
      expect(within(card).getByText(step)).toBeInTheDocument();
    }
    expect(card).toHaveTextContent(/Escalate to intensive care/i);
  });

  it("says the steps are reviewed rather than generated", () => {
    renderRecord(SEROTONIN, []);

    expect(screen.getByTestId("differential-do-now-phone")).toHaveTextContent(/locally authored/i);
  });

  it("never shows alongside the desktop rail", () => {
    // jsdom has no viewport, so both nodes exist in the tree. The contract that
    // keeps them from ever painting together is the breakpoint pair, so assert
    // that directly.
    renderRecord(SEROTONIN, []);

    expect(screen.getByTestId("differential-do-now-phone").className).toContain("lg:hidden");
    expect(screen.getByTestId("differential-overview-rail").className).toContain("lg:block");
    expect(screen.getByTestId("differential-overview-rail").className).toContain("hidden");
  });

  it("warns that generated steps describe the group, exactly as the desktop rail does", () => {
    // Codex P1 on PR #2838. For the 191 records with no authored overlay,
    // resolveDoNowSteps falls back to the export's immediate actions, which are
    // written about the presentation group and stamped onto every diagnosis in
    // it. The rail has always labelled that; the new phone card did not, so it
    // presented group-level actions as specific to this diagnosis — the exact
    // mismatch the scope work exists to remove.
    renderRecord("drug-induced-parkinsonism", []);

    const card = screen.getByTestId("differential-do-now-phone");
    expect(card).toHaveTextContent(/not specific to/i);
    expect(card).not.toHaveTextContent(/locally authored/i);
  });

  it("carries no group warning when the steps are the authored overlay", () => {
    renderRecord(SEROTONIN, []);

    const card = screen.getByTestId("differential-do-now-phone");
    expect(card).not.toHaveTextContent(/not specific to/i);
    expect(card).toHaveTextContent(/locally authored/i);
  });

  it("uses the same wording as the rail, so the two cannot drift", () => {
    const record = getDifferentialRecord("drug-induced-parkinsonism")!;
    const expected = differentialGroupScopeNote(record);
    renderRecord("drug-induced-parkinsonism", []);

    expect(screen.getByTestId("differential-do-now-phone")).toHaveTextContent(expected);
    expect(screen.getByTestId("differential-overview-rail")).toHaveTextContent(expected);
  });

  it("is absent when a record has nothing to put in it", () => {
    // Copilot on PR #2838: the original version of this test never rendered the
    // card at all, so a regression that painted an empty one would have passed.
    // Neither source of steps: no curated overlay and no generated immediate
    // actions. Both have to be absent, which is why the context is nulled too —
    // akathisia carries an overlay that would keep the card populated on its own.
    const bare = {
      ...getDifferentialRecord("akathisia")!,
      slug: "no-steps-anywhere",
      immediateActions: [],
      sections: [],
    };
    render(
      <AuthProvider>
        <AccountDataProvider>
          <DifferentialDetailPage record={bare} detailContext={{ ...buildContext("akathisia", []), curated: null }} />
        </AccountDataProvider>
      </AuthProvider>,
    );

    expect(screen.queryByTestId("differential-do-now-phone")).toBeNull();
  });
});

/**
 * "Compare (4)" on a primary button reads as "open the comparison". It opened a
 * tab that then carried its own button to actually open one, and the count
 * included related diagnoses that have no page and so cannot be compared.
 */
describe("the Compare control", () => {
  it("navigates straight to the compare queue, prefilled", () => {
    renderRecord(SEROTONIN, ["neuroleptic-malignant-syndrome", "anticholinergic-delirium"]);

    for (const control of screen.getAllByRole("link", { name: /^Compare/ })) {
      expect(control).toHaveAttribute(
        "href",
        "/differentials/compare?ids=serotonin-toxicity,neuroleptic-malignant-syndrome,anticholinergic-delirium",
      );
    }
  });

  it("never prefills more than the picker can hold", () => {
    // Codex P2 on PR #2838. DifferentialComparePickerControl caps at MAX_COUNT
    // (8) and pads to it, so a ninth id is silently dropped the moment the
    // reader opens "Edit selection" — and the next edit commits that loss. A
    // record with eight routable relations plus itself hits exactly that.
    const related = [
      "neuroleptic-malignant-syndrome",
      "anticholinergic-delirium",
      "akathisia",
      "acute-dystonia",
      "delirium",
      "catatonia-in-mood-disorder",
      "alcohol-withdrawal",
      "postpartum-psychosis",
    ];
    expect(related.length).toBe(8);
    renderRecord(SEROTONIN, related);

    const href = screen.getAllByRole("link", { name: /^Compare/ })[0]!.getAttribute("href")!;
    const ids = new URL(href, "https://example.test").searchParams.get("ids")!.split(",");

    expect(ids.length).toBeLessThanOrEqual(8);
    // The focus diagnosis is the one id that must never be the one dropped.
    expect(ids[0]).toBe(SEROTONIN);
    for (const control of screen.getAllByRole("link", { name: /^Compare \(/ })) {
      expect(control).toHaveAccessibleName(`Compare (${ids.length})`);
    }
  });

  it("counts only what it can actually compare", () => {
    // Two routable related diagnoses plus this one. The record's own `related`
    // list is longer, and counting that promised rows the queue would drop.
    const record = renderRecord(SEROTONIN, ["neuroleptic-malignant-syndrome", "anticholinergic-delirium"]);
    expect(record.related.length).toBeGreaterThan(2);

    const labelled = screen.getAllByRole("link", { name: /^Compare \(/ });
    expect(labelled.length).toBeGreaterThan(0);
    for (const control of labelled) {
      expect(control).toHaveAccessibleName("Compare (3)");
    }
  });
});
