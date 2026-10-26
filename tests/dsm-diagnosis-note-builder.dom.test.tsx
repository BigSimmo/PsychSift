import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DSM_UNSAFE_LEGACY_DRAFT_CODES, DsmDiagnosisNoteBuilder } from "@/components/dsm/dsm-diagnosis-note-builder";
import { dsmDiagnoses } from "@/lib/dsm";
import { dsmNoteBuilderRecord } from "@/lib/dsm-note";

afterEach(() => {
  cleanup();
  // The builder saves its draft to sessionStorage, so clear it between tests.
  window.sessionStorage.clear();
});

const panic = dsmNoteBuilderRecord(dsmDiagnoses.find((diagnosis) => diagnosis.slug === "panic-disorder")!);
// Panic disorder supplies no `criteria_display`, as 145 of the 146 records do
// not, so every row here is the record's key-feature summary and the builder
// says so. `bipolarTwo` is the one record that really carries criteria.
const bipolarTwo = dsmNoteBuilderRecord(dsmDiagnoses.find((diagnosis) => diagnosis.slug === "bipolar-ii-disorder")!);

function markCriterion(label: string, choice: string, noun = "Key feature") {
  const group = screen.getByRole("radiogroup", { name: `${noun} ${label}` });
  return within(group).getByRole("radio", { name: choice });
}

describe("DsmDiagnosisNoteBuilder", () => {
  it("offers nothing to copy until a criterion is recorded", () => {
    render(<DsmDiagnosisNoteBuilder record={panic} />);
    expect(screen.getByText("Mark at least one key feature to build the note.")).toBeTruthy();
    expect(screen.queryByTestId("dsm-note-output")).toBeNull();
  });

  it("builds a note from the rows marked and names the rest as not assessed", async () => {
    const user = userEvent.setup();
    render(<DsmDiagnosisNoteBuilder record={panic} />);

    await user.click(markCriterion("A", "Met"));
    await user.click(markCriterion("B", "Met"));

    const note = screen.getByTestId("dsm-note-output").textContent ?? "";
    expect(note).toContain("Panic disorder (F41.0)");
    expect(note).toContain("Key features present (A, B):");
    expect(note).toContain("Not assessed (C, D):");
    // The wall-of-prose template asserted every symptom; the built note must not.
    expect(note).not.toContain("palpitations");
  });

  it("writes threshold characters in a form a record system can display", async () => {
    const user = userEvent.setup();
    render(<DsmDiagnosisNoteBuilder record={panic} />);
    await user.click(markCriterion("A", "Met"));

    const note = screen.getByTestId("dsm-note-output").textContent ?? "";
    expect(note).toContain("at least 4 of 13 symptoms");
    expect(note).not.toContain("≥");
    expect(note).not.toContain(";");
  });

  it("records a row the clinician actively ruled out", async () => {
    const user = userEvent.setup();
    render(<DsmDiagnosisNoteBuilder record={panic} />);
    await user.click(markCriterion("A", "Met"));
    await user.click(markCriterion("C", "Not met"));

    const note = screen.getByTestId("dsm-note-output").textContent ?? "";
    expect(note).toContain("Key features absent (C):");
  });

  it("adds only the differentials that were ticked", async () => {
    const user = userEvent.setup();
    render(<DsmDiagnosisNoteBuilder record={panic} />);
    await user.click(markCriterion("A", "Met"));
    await user.click(screen.getByRole("checkbox", { name: /^GAD/ }));

    const note = screen.getByTestId("dsm-note-output").textContent ?? "";
    expect(note).toContain("Differentials considered and excluded: GAD");
    expect(note).not.toContain("Agoraphobia");
  });

  it("names the rows criteria, and the basis DSM-5-TR, only where the record supplies criteria", async () => {
    const user = userEvent.setup();
    render(<DsmDiagnosisNoteBuilder record={bipolarTwo} />);
    await user.click(markCriterion("A", "Met", "Criterion"));

    const note = screen.getByTestId("dsm-note-output").textContent ?? "";
    expect(note).toContain("Criteria met (A):");
    expect(note).toContain("Recorded against DSM-5-TR criteria.");
    expect(note).not.toContain("key feature summary");
  });

  it("states a key-feature basis in the note built from a record without criteria", async () => {
    const user = userEvent.setup();
    render(<DsmDiagnosisNoteBuilder record={panic} />);
    await user.click(markCriterion("A", "Met"));

    const note = screen.getByTestId("dsm-note-output").textContent ?? "";
    expect(note).toContain("not the full DSM-5-TR criteria");
    expect(note).not.toContain("Criteria met");
  });

  it("offers no specifier tick box for a record that has none", () => {
    render(<DsmDiagnosisNoteBuilder record={panic} />);
    expect(screen.getByText("No single-value specifiers in this record. Type any that apply below.")).toBeTruthy();
  });

  it("clears every recorded answer on start over", async () => {
    const user = userEvent.setup();
    render(<DsmDiagnosisNoteBuilder record={panic} />);
    await user.click(markCriterion("A", "Met"));
    expect(screen.getByTestId("dsm-note-output")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.queryByTestId("dsm-note-output")).toBeNull();
    expect(markCriterion("A", "Met").getAttribute("aria-checked")).toBe("false");
  });
});

describe("DsmDiagnosisNoteBuilder saved drafts", () => {
  const record = (slug: string) => dsmNoteBuilderRecord(dsmDiagnoses.find((diagnosis) => diagnosis.slug === slug)!);

  // Before the 26 Oct 2026 code corrections the catalogue gave each of these pairs one
  // ICD code, and a draft keyed by that code restored one diagnosis's answers onto the other.
  const formerlySharedCodePairs = [
    ["voyeuristic-disorder", "frotteuristic-disorder"],
    ["tardive-dyskinesia", "tardive-dystonia-tardive-akathisia"],
  ] as const;

  it.each(formerlySharedCodePairs)("keeps %s and %s drafts apart", async (firstSlug, secondSlug) => {
    const first = record(firstSlug);
    const second = record(secondSlug);

    const user = userEvent.setup();
    render(<DsmDiagnosisNoteBuilder record={first} />);
    await user.click(markCriterion("A", "Met"));
    await user.click(screen.getByRole("checkbox", { name: first.differentials[0] }));
    expect(screen.getByTestId("dsm-note-output")).toBeTruthy();
    cleanup();

    render(<DsmDiagnosisNoteBuilder record={second} />);
    expect(screen.queryByTestId("dsm-note-output")).toBeNull();
    expect(markCriterion("A", "Met").getAttribute("aria-checked")).toBe("false");
  });

  it("never migrates a legacy draft under a code more than one catalogue record shares", () => {
    const counts = new Map<string, number>();
    for (const diagnosis of dsmDiagnoses) counts.set(diagnosis.icd_code, (counts.get(diagnosis.icd_code) ?? 0) + 1);
    const shared = [...counts].filter(([, count]) => count > 1).map(([code]) => code);
    for (const code of shared) expect(DSM_UNSAFE_LEGACY_DRAFT_CODES.has(code)).toBe(true);
  });

  it("never migrates a legacy draft under a code that was shared or moved between records", () => {
    expect([...DSM_UNSAFE_LEGACY_DRAFT_CODES].sort()).toEqual(
      ["F65.81", "G24.09", "F94.1", "F94.2", "G24.01", "G25.71"].sort(),
    );
  });

  it("moves a draft saved under the old ICD key to the slug key", () => {
    const legacyKey = `psychsift_dsm_draft_${panic.icdCode}`;
    window.sessionStorage.setItem(
      legacyKey,
      JSON.stringify({
        statuses: { A: "met" },
        specifiers: [],
        specifierText: "",
        excluded: [],
        includeCriterionText: true,
      }),
    );

    render(<DsmDiagnosisNoteBuilder record={panic} />);
    expect(screen.getByTestId("dsm-note-output").textContent).toContain("Key features present (A):");
    expect(window.sessionStorage.getItem(legacyKey)).toBeNull();
    expect(window.sessionStorage.getItem(`psychsift_dsm_draft_${panic.slug}`)).toContain('"A":"met"');
  });

  it("never reads an old ICD-keyed draft for a code two records share", () => {
    const frotteuristic = record("frotteuristic-disorder");
    window.sessionStorage.setItem(
      `psychsift_dsm_draft_${frotteuristic.icdCode}`,
      JSON.stringify({
        statuses: { A: "met" },
        specifiers: [],
        specifierText: "",
        excluded: [],
        includeCriterionText: true,
      }),
    );

    render(<DsmDiagnosisNoteBuilder record={frotteuristic} />);
    expect(screen.queryByTestId("dsm-note-output")).toBeNull();
  });

  it("restores only the answers the current record offers", () => {
    const frotteuristic = record("frotteuristic-disorder");
    window.sessionStorage.setItem(
      `psychsift_dsm_draft_${frotteuristic.slug}`,
      JSON.stringify({
        statuses: { A: "met", C: "met" },
        specifiers: ["Not a specifier here"],
        specifierText: "",
        excluded: [
          "Consensual voyeuristic behaviour (mutual agreement; not a disorder)",
          frotteuristic.differentials[0],
        ],
        includeCriterionText: true,
      }),
    );

    render(<DsmDiagnosisNoteBuilder record={frotteuristic} />);
    const note = screen.getByTestId("dsm-note-output").textContent ?? "";
    expect(note).toContain("Key features present (A):");
    expect(note).toContain("Differentials considered and excluded: Normal physical contact in crowds");
    expect(note).not.toContain("Consensual voyeuristic behaviour");
    expect(note).not.toContain("Not a specifier here");
  });

  it("renders the empty builder on the server and restores the draft only after hydration", async () => {
    window.sessionStorage.setItem(
      `psychsift_dsm_draft_${panic.slug}`,
      JSON.stringify({
        statuses: { A: "met" },
        specifiers: [],
        specifierText: "",
        excluded: [],
        includeCriterionText: true,
      }),
    );

    const markup = renderToString(<DsmDiagnosisNoteBuilder record={panic} />);
    expect(markup).toContain("to build the note.");
    expect(markup).not.toContain('data-testid="dsm-note-output"');

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const container = document.createElement("div");
    container.innerHTML = markup;
    document.body.appendChild(container);
    let root: Root | undefined;
    await act(async () => {
      root = hydrateRoot(container, <DsmDiagnosisNoteBuilder record={panic} />, {
        onRecoverableError: (error) => console.error(error),
      });
    });

    expect(consoleError).not.toHaveBeenCalled();
    expect(within(container).getByTestId("dsm-note-output").textContent).toContain("Key features present (A):");
    // The pre-hydration render must not have wiped the draft it never read.
    expect(window.sessionStorage.getItem(`psychsift_dsm_draft_${panic.slug}`)).toContain('"A":"met"');

    act(() => root?.unmount());
    container.remove();
    consoleError.mockRestore();
  });
});
