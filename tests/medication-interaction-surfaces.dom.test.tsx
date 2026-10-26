import { readFileSync } from "node:fs";
import path from "node:path";

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { medicationTabForSectionType } from "@/components/clinical-dashboard/medication-nav-header";
import {
  MedicationConsiderations,
  MedicationInteractionCallout,
  PatientVerdictSignal,
  verdictIcon,
  medicationVerdictRingClass,
  verdictSummaryBadge,
} from "@/components/clinical-dashboard/medication-considerations";
import { PatientProfileProvider } from "@/components/clinical-dashboard/patient-profile-context";
import { toneSuccess } from "@/components/primitive-recipes/recipes";
import { getMedicationRecord } from "@/lib/medication-snapshot";
import { PATIENT_PROFILE_STORAGE_KEY } from "@/lib/patient-profile-storage";
import type { MedicationRecord } from "@/lib/medications";

function seedProfile(profile: Record<string, unknown>) {
  window.sessionStorage.setItem(PATIENT_PROFILE_STORAGE_KEY, JSON.stringify(profile));
}

function renderFor(slug: string) {
  const record = getMedicationRecord(slug) as MedicationRecord;
  return render(
    <PatientProfileProvider>
      <MedicationConsiderations record={record} />
    </PatientProfileProvider>,
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  window.sessionStorage.clear();
});

describe("interactions block on the medication detail page", () => {
  it("prompts for a medication list when none is entered", () => {
    renderFor("sertraline");
    expect(screen.getByText(/Add the patient’s current medications/i)).toBeInTheDocument();
  });

  it("surfaces a matched interaction with its verbatim catalogue text", () => {
    seedProfile({ medications: ["tramadol-ir"] });
    renderFor("sertraline");

    expect(screen.getByText(/With Tramadol IR/i)).toBeInTheDocument();
    expect(screen.getByText(/Serotonin Syndrome/i)).toBeInTheDocument();
  });

  it("says 'no interaction found' — scoped to what was entered, not a global all-clear", () => {
    // Acamprosate: every interaction row resolved, and none names paracetamol.
    seedProfile({ medications: ["paracetamol"] });
    renderFor("acamprosate");

    const notice = screen.getByText(/No interaction found between this medication/i);
    expect(notice).toBeInTheDocument();
    expect(notice.textContent).toMatch(/medication entered/i);
  });

  it("states unresolved rows plainly instead of folding them into the all-clear", () => {
    // Bupropion carries a CYP2D6-substrate row with no enumerable counterparty.
    seedProfile({ medications: ["paracetamol"] });
    renderFor("bupropion-sr");

    expect(screen.getByText(/could not be matched automatically/i)).toBeInTheDocument();
    expect(screen.getByText(/is not shown as clear/i)).toBeInTheDocument();
  });

  it("says so plainly when the catalogue has no interaction data at all", () => {
    // `dataAvailable: false` reports a synthetic unresolvedRowCount of 1 against
    // a totalRowCount of 0, so the ordinary "N of M rows" copy would read
    // "1 of this medication's 0 interaction rows". Different reason, different words.
    seedProfile({ medications: ["paracetamol"] });
    const record = { ...(getMedicationRecord("acamprosate") as MedicationRecord), slug: "not-in-the-index" };
    render(
      <PatientProfileProvider>
        <MedicationConsiderations record={record} />
      </PatientProfileProvider>,
    );

    expect(screen.getByText(/carries no interaction data for this medication/i)).toBeInTheDocument();
    expect(screen.queryByText(/of this medication.s 0 interaction/i)).not.toBeInTheDocument();
    expect(screen.getByText(/not shown as clear/i)).toBeInTheDocument();
  });

  it("never claims an all-clear for a medication carrying unresolved rows", () => {
    seedProfile({ medications: ["paracetamol"] });
    const { container } = renderFor("bupropion-sr");

    // The success notice must not be the story here; the review notice is.
    expect(container.textContent).toMatch(/could not be matched automatically/i);
  });

  it("names an entered medication whose own rows could not all be matched", () => {
    // Diltiazem's rows are all resolved; clarithromycin's CYP3A4/P-gp row is not.
    seedProfile({ medications: ["clarithromycin"] });
    renderFor("diltiazem");

    expect(screen.getByText(/No interaction found between this medication/i)).toBeInTheDocument();
    expect(screen.getByText(/Some interaction rows for Clarithromycin could not be matched/i)).toBeInTheDocument();
  });
});

describe("considerations block — an unread gate is never an all-clear", () => {
  // One contraindication row gated on eGFR and one dose-adjust row gated on
  // hepatic status, so each tier has exactly one unread input to report.
  function gatedRecord(): MedicationRecord {
    return {
      ...(getMedicationRecord("acamprosate") as MedicationRecord),
      slug: "gate-fixture-med",
      sections: [
        {
          title: "Contraindications",
          type: "contra",
          rows: [
            {
              key: "Renal",
              val: "row text",
              patient: { factors: ["renal"], action: "contraindication", match: { egfr: { lt: 30 } } },
            },
            {
              key: "Hepatic",
              val: "row text",
              patient: { factors: ["hepatic"], action: "dose-adjust", match: { hepatic: ["severe"] } },
            },
          ],
        },
      ],
    };
  }

  function renderGated() {
    return render(
      <PatientProfileProvider>
        <MedicationConsiderations record={gatedRecord()} />
      </PatientProfileProvider>,
    );
  }

  it("degrades the empty state out of the success tone when a gate could not be read", () => {
    seedProfile({ ageYears: 40 });
    const { container } = renderGated();

    const notice = screen
      .getByText(/No considerations matched the details entered/i)
      .closest('[role="status"], [role="alert"]');
    expect(notice).not.toBeNull();
    // The green all-clear is the specific thing that must not render above an
    // "enter eGFR" sentence.
    for (const token of toneSuccess.split(" ")) {
      expect(notice?.className ?? "").not.toContain(token);
    }
    expect(container.textContent).not.toMatch(/No matching considerations for the entered patient profile/i);
    expect(container.textContent).toMatch(/Some checks could not be run/i);
  });

  it("names the blocking and advisory gaps in separate sentences", () => {
    seedProfile({ ageYears: 40 });
    const { container } = renderGated();

    expect(container.textContent).toMatch(
      /Not assessed\. Contraindication checks for this medication use eGFR, which this profile does not include\. Enter it, or check the source, before treating this panel as complete\./,
    );
    expect(container.textContent).toMatch(
      /Not assessed\. 1 dosing and monitoring entry uses hepatic status, which this profile does not include\. Enter it to complete that check\./,
    );
  });

  it("keeps the success tone once every gate has an answer", () => {
    // hepatic "none" is a recorded answer, not a blank — the criterion was read.
    seedProfile({ ageYears: 40, egfr: 90, crcl: 90, hepatic: "none" });
    const { container } = renderGated();

    const notice = screen
      .getByText(/No matching considerations for the entered patient profile/i)
      .closest('[role="status"], [role="alert"]');
    expect(notice?.className ?? "").toContain(toneSuccess.split(" ")[0]);
    expect(container.textContent).not.toMatch(/Not assessed\./);
  });

  it("agrees the verb with the entry count and the pronoun with the input count", () => {
    // Two advisory entries, two unread inputs. The list gets a serial "and" so it
    // cannot run into the relative clause that follows it.
    const record = {
      ...(getMedicationRecord("acamprosate") as MedicationRecord),
      slug: "plural-advisory-fixture",
      sections: [
        {
          title: "Special populations",
          type: "spec",
          rows: [
            {
              key: "Renal",
              val: "row text",
              patient: { factors: ["renal"], action: "dose-adjust", match: { egfr: { lt: 30 } } },
            },
            {
              key: "QTc",
              val: "row text",
              patient: { factors: ["qtc"], action: "monitor", match: { qtc: { gte: 500 } } },
            },
          ],
        },
      ],
    } as MedicationRecord;

    seedProfile({ ageYears: 40 });
    const { container } = render(
      <PatientProfileProvider>
        <MedicationConsiderations record={record} />
      </PatientProfileProvider>,
    );

    expect(container.textContent).toMatch(
      /Not assessed\. 2 dosing and monitoring entries use QTc and eGFR, which this profile does not include\. Enter them to complete those checks\./,
    );
    expect(container.textContent).not.toMatch(/to see whether/i);
  });

  it("formats multi-input contraindications with serial and and plural pronoun", () => {
    const record = {
      ...(getMedicationRecord("acamprosate") as MedicationRecord),
      slug: "plural-contraindication-fixture",
      sections: [
        {
          title: "Contraindications",
          type: "contra",
          rows: [
            {
              key: "Renal",
              val: "row text",
              patient: { factors: ["renal"], action: "contraindication", match: { egfr: { lt: 30 } } },
            },
            {
              key: "Hepatic",
              val: "row text",
              patient: { factors: ["hepatic"], action: "contraindication", match: { hepatic: ["severe"] } },
            },
          ],
        },
      ],
    } as MedicationRecord;

    seedProfile({ ageYears: 40 });
    const { container } = render(
      <PatientProfileProvider>
        <MedicationConsiderations record={record} />
      </PatientProfileProvider>,
    );

    expect(container.textContent).toMatch(
      /Not assessed\. Contraindication checks for this medication use eGFR and hepatic status, which this profile does not include\. Enter them, or check the source, before treating this panel as complete\./,
    );
  });

  it("never invites deferring an alert that already fired: no 'to see whether' over a live advisory row", () => {
    // The shape the corpus really has — lithium-carbonate-ir-sr's "Renal
    // Impairment" dose-adjust row is factors renal + allergy-nsaid gated on eGFR.
    // An NSAID allergy fires it while eGFR stays blank, so the row renders above
    // as a live clinical alert. Telling the clinician to enter eGFR "to see
    // whether it applies" would read as permission to defer acting on it.
    const record = {
      ...(getMedicationRecord("acamprosate") as MedicationRecord),
      slug: "fired-advisory-fixture",
      sections: [
        {
          title: "Special populations",
          type: "spec",
          rows: [
            {
              key: "Renal Impairment",
              val: "Reduce dose and monitor levels.",
              patient: {
                factors: ["renal", "allergy-nsaid"],
                action: "dose-adjust",
                match: { egfr: { lt: 30 } },
              },
            },
          ],
        },
      ],
    } as MedicationRecord;

    seedProfile({ allergies: ["nsaid"] });
    const { container } = render(
      <PatientProfileProvider>
        <MedicationConsiderations record={record} />
      </PatientProfileProvider>,
    );

    // The row fired and is on screen as a consideration.
    expect(screen.getByTestId("patient-consideration-spec:Renal Impairment")).toBeInTheDocument();
    expect(container.textContent).toMatch(/NSAID allergy/i);
    // …and the advisory sentence below it never puts applicability back in
    // question over a row that has already fired.
    expect(container.textContent).not.toMatch(/to see whether/i);
    // It still reports the unread gate, as an incomplete check rather than an
    // open question.
    expect(container.textContent).toMatch(
      /Not assessed\. 1 dosing and monitoring entry uses eGFR, which this profile does not include\. Enter it to complete that check\./,
    );
  });

  it("still reports a row's other unread gate after that row has fired", () => {
    // eGFR 20 fires the contraindication; hepatic status is still unread, and the
    // advisory sentence must say so rather than being swallowed by the alert.
    seedProfile({ ageYears: 40, egfr: 20, crcl: 20 });
    const { container } = renderGated();

    expect(container.textContent).toMatch(
      /Not assessed\. 1 dosing and monitoring entry uses hepatic status, which this profile does not include\./,
    );
  });
});

describe("result-row verdict presentation", () => {
  const clean = {
    tone: "success" as const,
    incomplete: false,
    interactionCount: 0,
    considerationCount: 0,
    unresolvedRowCount: 0,
  };

  it("labels a clean verdict as a finding, not a guarantee", () => {
    expect(verdictSummaryBadge(clean)).toMatchObject({
      id: "patient-verdict",
      label: "No interaction found",
      tone: "success",
    });
  });

  it.each([
    ["danger", "Danger", "For this patient"],
    ["warning", "Caution", "For this patient"],
    ["neutral", "Manual review", "Patient check incomplete"],
    ["success", "No alert found", "From entered details"],
  ] as const)("states the %s patient verdict in words without relying on colour", (tone, label, context) => {
    render(
      <PatientVerdictSignal
        verdict={{
          ...clean,
          tone,
          incomplete: tone === "neutral",
          considerationCount: tone === "danger" || tone === "warning" ? 1 : 0,
        }}
      />,
    );

    const signal = screen.getByRole("group", { name: new RegExp(`^${label}\\. ${context}\\.`) });
    expect(signal).toHaveAttribute("data-tone", tone);
    expect(signal).toHaveTextContent(label);
    expect(signal).toHaveTextContent(context);
  });

  it("labels an incomplete verdict for manual review rather than clear", () => {
    const badge = verdictSummaryBadge({ ...clean, tone: "neutral", incomplete: true, unresolvedRowCount: 2 });
    expect(badge?.label).toBe("Needs manual review");
    expect(badge?.tone).toBe("neutral");
  });

  it("counts interactions and physiology alerts separately in one label", () => {
    const badge = verdictSummaryBadge({
      ...clean,
      tone: "danger",
      interactionCount: 2,
      considerationCount: 1,
    });
    expect(badge?.label).toBe("2 interactions · 1 alert");
    expect(badge?.tone).toBe("danger");
  });

  it("keeps the desktop edge on ring-*, never mixing in a border on one surface", () => {
    for (const tone of ["danger", "warning", "success", "clinical", "info"] as const) {
      const ring = medicationVerdictRingClass(tone);
      expect(ring).toMatch(/ring-/);
      expect(ring).not.toMatch(/(^|\s)border-/);
    }
  });

  it("sets the phone card edge from unlayered CSS, which is what beats [data-selected]", () => {
    const css = readFileSync(path.resolve(process.cwd(), "src/app/globals.css"), "utf8");
    const selectedAt = css.indexOf('.medication-mobile-result[data-selected="true"]');
    const verdictAt = css.indexOf('.medication-mobile-result[data-verdict="danger"]');
    expect(selectedAt).toBeGreaterThan(-1);
    expect(verdictAt).toBeGreaterThan(-1);
    // Equal specificity, so source order decides. The verdict must come last or
    // the top hit renders its interaction warning with a neutral edge.
    expect(verdictAt).toBeGreaterThan(selectedAt);
  });

  it("leaves the neutral desktop row to the list divider rather than ringing it", () => {
    expect(medicationVerdictRingClass("neutral")).toBeNull();
  });
});

describe("verdict icons", () => {
  it("gives every tone its own glyph, including the two the shared badge default leaves bare", () => {
    const icons = (["danger", "warning", "success", "neutral", "clinical", "info"] as const).map((tone) =>
      verdictIcon(tone),
    );
    expect(icons.every(Boolean)).toBe(true);
    // success and neutral are the ones that matter: "checked, nothing found" and
    // "could not check" must be distinguishable without reading the border colour.
    expect(verdictIcon("success")).not.toBe(verdictIcon("neutral"));
    expect(verdictIcon("success")).not.toBe(verdictIcon("danger"));
    expect(verdictIcon("neutral")).not.toBe(verdictIcon("warning"));
  });

  it("attaches an icon to the verdict badge in every branch", () => {
    const base = {
      tone: "success" as const,
      incomplete: false,
      interactionCount: 0,
      considerationCount: 0,
      unresolvedRowCount: 0,
    };
    expect(verdictSummaryBadge(base)?.icon).toBe(verdictIcon("success"));
    expect(verdictSummaryBadge({ ...base, tone: "neutral", incomplete: true })?.icon).toBe(verdictIcon("neutral"));
    expect(verdictSummaryBadge({ ...base, tone: "danger", interactionCount: 1 })?.icon).toBe(verdictIcon("danger"));
  });
});

describe("MedicationInteractionCallout", () => {
  function renderCallout(slug: string, onPatient = () => {}, onSection = () => {}) {
    const record = getMedicationRecord(slug) as MedicationRecord;
    return render(
      <PatientProfileProvider>
        <MedicationInteractionCallout
          record={record}
          onOpenPatientDetails={onPatient}
          onOpenInteractionsSection={onSection}
        />
      </PatientProfileProvider>,
    );
  }

  /** The disclosure trigger — the only thing visible before a tap. */
  function trigger() {
    return screen.getByRole("button", { name: /interactions? with this patient/i });
  }

  function expand() {
    fireEvent.click(trigger());
  }

  it("renders nothing when no interaction matched — it is not an empty-state surface", () => {
    seedProfile({ medications: ["paracetamol"] });
    renderCallout("acamprosate");
    expect(screen.queryByTestId("medication-interaction-callout")).not.toBeInTheDocument();
  });

  it("starts collapsed, so the record's own content is not pushed down", () => {
    seedProfile({ medications: ["tramadol-ir", "ibuprofen"] });
    renderCallout("sertraline");

    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    // Present in the DOM (Disclosure hides rather than unmounts) but collapsed.
    const panel = screen.getByRole("region");
    expect(panel).toHaveAttribute("data-open", "false");
    expect(panel).toHaveClass("hidden");
  });

  it("keeps severity, count and the interacting drugs legible while collapsed", () => {
    seedProfile({ medications: ["tramadol-ir", "ibuprofen"] });
    renderCallout("sertraline");

    // Count + severity on the trigger; the drug names in the visible summary.
    expect(trigger()).toHaveAccessibleName(/2 interactions with this patient/i);
    expect(screen.getByText("CRITICAL", { selector: "button span" })).toBeVisible();
    expect(screen.getByText(/Tramadol IR · Ibuprofen/)).toBeVisible();
  });

  it("reveals the panel on tap", () => {
    seedProfile({ medications: ["tramadol-ir"] });
    renderCallout("sertraline");

    expand();

    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Massive risk of Serotonin Syndrome/i)).toBeVisible();
  });

  it("names each interacting drug and links to its own record", () => {
    seedProfile({ medications: ["tramadol-ir", "ibuprofen"] });
    renderCallout("sertraline");
    expand();

    expect(screen.getByTestId("medication-interaction-callout")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Tramadol IR/ });
    expect(link).toHaveAttribute("href", "/medications/tramadol-ir");
    expect(screen.getByRole("link", { name: /Ibuprofen/ })).toHaveAttribute("href", "/medications/ibuprofen");
  });

  it("shows the verbatim catalogue wording, not a summary of it", () => {
    seedProfile({ medications: ["tramadol-ir"] });
    renderCallout("sertraline");
    expand();
    expect(screen.getByText(/Massive risk of Serotonin Syndrome/i)).toBeVisible();
  });

  it("lists the most severe first and counts the rest rather than hiding them", () => {
    // Four interacting drugs; the callout shows three and reports the remainder.
    seedProfile({ medications: ["tramadol-ir", "ibuprofen", "naproxen", "diclofenac"] });
    renderCallout("sertraline");
    expand();

    const shown = screen.getAllByTestId(/^medication-callout-(?!open-)/);
    expect(shown).toHaveLength(3);
    expect(screen.getByText(/\+1 more/)).toBeVisible();
  });

  it("opens the Key Interactions section and the patient sheet from the callout", () => {
    const onPatient = vi.fn();
    const onSection = vi.fn();
    seedProfile({ medications: ["tramadol-ir"] });
    renderCallout("sertraline", onPatient, onSection);
    expand();

    fireEvent.click(screen.getByTestId("medication-callout-open-section"));
    expect(onSection).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByTestId("medication-callout-open-patient"));
    expect(onPatient).toHaveBeenCalledOnce();
  });
});

describe("interaction section targeting", () => {
  it("resolves the tab that actually holds Key Interactions", () => {
    // Hardcoding "more" would leave the callout's jump pointing at the old tab
    // the day a section moves.
    expect(medicationTabForSectionType("inter")).toBe("more");
    expect(medicationTabForSectionType("dose")).toBe("dosing");
    expect(medicationTabForSectionType("not-a-section")).toBeNull();
  });
});
