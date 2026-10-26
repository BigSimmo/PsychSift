import { describe, expect, it } from "vitest";

import { getMedicationRecord } from "@/lib/medication-snapshot";
import {
  composeMedicationVerdict,
  evaluateMedicationInteractions,
  interactionNoteBody,
  interactionRowCount,
  isUnreachableCounterparty,
  severityLabel,
  medicationDisplayName,
  SEVERITY_TONE,
} from "@/lib/medication-interactions";

describe("evaluateMedicationInteractions", () => {
  it("matches a drug named outright in the counterparty sentence", () => {
    const result = evaluateMedicationInteractions("sertraline", ["tramadol-ir"]);
    expect(result.interactions).toHaveLength(1);
    expect(result.interactions[0]?.counterpartySlug).toBe("tramadol-ir");
    expect(result.interactions[0]?.severity).toBe("critical");
    expect(result.highestTone).toBe("danger");
  });

  it("matches through a resolved class term", () => {
    const result = evaluateMedicationInteractions("sertraline", ["phenelzine"]);
    expect(result.interactions[0]?.counterpartySlug).toBe("phenelzine");
    expect(result.interactions[0]?.matchedTerms).toContain("maois");
  });

  it("renders verbatim catalogue text for a forward interaction", () => {
    const record = getMedicationRecord("sertraline");
    const result = evaluateMedicationInteractions("sertraline", ["ibuprofen"], record);
    expect(result.interactions[0]?.note).toContain("NSAIDs");
  });

  it("evaluates a clinically material reverse-only edge", () => {
    const result = evaluateMedicationInteractions("buprenorphine-naloxone", ["naltrexone"]);
    expect(result.interactions.some((item) => item.counterpartySlug === "naltrexone")).toBe(true);
    expect(result.highestTone).toBe("danger");
  });

  it("does not reintroduce loperamide's excluded opioid term through a reverse row", () => {
    const result = evaluateMedicationInteractions("morphine-ir-iv", ["loperamide"]);
    expect(result.interactions.some((item) => item.counterpartySlug === "loperamide")).toBe(false);
  });

  it("warns on lithium plus an NSAID or a thiazide", () => {
    // Both are textbook lithium-toxicity interactions and both were silent: the
    // catalogue record is "Lithium carbonate (IR/SR)", so no name-derived
    // surface matched the bare "Lithium" every row writes. End-to-end through
    // the evaluator, not just the index, because the index can carry a
    // counterparty the evaluator never surfaces.
    for (const drug of ["ibuprofen", "hydrochlorothiazide", "indapamide", "frusemide"]) {
      const result = evaluateMedicationInteractions(drug, ["lithium-carbonate-ir-sr"]);
      expect(
        result.interactions.some((item) => item.counterpartySlug === "lithium-carbonate-ir-sr"),
        `${drug} + lithium should warn`,
      ).toBe(true);
      expect(result.highestTone).toBe("danger");
    }
  });

  it("never shows green when an entered medication is outside the resolved interaction graph", () => {
    // The mirror of the missing-data guard, and the half that was missing. A
    // patient on a drug the corpus never mentions produced zero interactions,
    // zero unresolved rows, and a confident green — silence presented as an
    // all-clear. Zolpidem is one of 20 such drugs.
    const result = evaluateMedicationInteractions("sertraline", ["zolpidem"]);
    expect(result.interactions).toHaveLength(0);
    expect(result.unreachableCounterparties).toEqual(["zolpidem"]);

    const verdict = composeMedicationVerdict({
      considerationTone: null,
      considerationCount: 0,
      unassessedCount: 0,
      interactionTone: result.highestTone,
      interactionCount: result.interactions.length,
      unresolvedRowCount: 0,
      unreachableCounterpartyCount: result.unreachableCounterparties.length,
      unreviewedHighRiskCount: result.unreviewedHighRiskMedications.length,
    });
    expect(verdict.tone).not.toBe("success");
    expect(verdict.incomplete).toBe(true);
  });

  it("never shows green when an entered medication carries unresolved rows of its own", () => {
    // Diltiazem's own rows are all resolved and none names clarithromycin, but
    // clarithromycin's CYP3A4/P-gp row is unresolved, so it may reach diltiazem
    // without naming it. Counting only the viewed drug's rows composed to green.
    const result = evaluateMedicationInteractions("diltiazem", ["clarithromycin"]);
    expect(result.interactions).toHaveLength(0);
    expect(result.unresolvedRowCount).toBe(0);
    expect(result.unreachableCounterparties).toEqual([]);
    expect(result.reverseUnresolvedCounterparties).toEqual(["clarithromycin"]);

    const verdict = composeMedicationVerdict({
      considerationTone: null,
      considerationCount: 0,
      unassessedCount: 0,
      interactionTone: result.highestTone,
      interactionCount: result.interactions.length,
      unresolvedRowCount: result.unresolvedRowCount,
      unreachableCounterpartyCount: result.unreachableCounterparties.length,
      reverseUnresolvedCounterpartyCount: result.reverseUnresolvedCounterparties.length,
      unreviewedHighRiskCount: result.unreviewedHighRiskMedications.length,
    });
    expect(verdict.tone).toBe("neutral");
    expect(verdict.incomplete).toBe(true);
  });

  it("does not double-report an unreachable medication as carrying unresolved rows", () => {
    const result = evaluateMedicationInteractions("sertraline", ["zolpidem"]);
    expect(result.unreachableCounterparties).toEqual(["zolpidem"]);
    expect(result.reverseUnresolvedCounterparties).toEqual([]);
  });

  it("does not call a reachable medication unreachable", () => {
    // The guard has to stay narrow, or it degrades every verdict to grey and
    // stops meaning anything. Ibuprofen is named by many rows.
    const result = evaluateMedicationInteractions("sertraline", ["ibuprofen"]);
    expect(result.unreachableCounterparties).toEqual([]);
    expect(isUnreachableCounterparty("ibuprofen")).toBe(false);
    expect(isUnreachableCounterparty("zolpidem")).toBe(true);
  });

  it("counts a source-only medication as a reachable interaction endpoint", () => {
    // Celecoxib is not named by another medication's row, but its own source row
    // names fluconazole. The evaluator scans both directions, so the reachability
    // graph must include the source endpoint as well as its counterparty.
    expect(isUnreachableCounterparty("celecoxib")).toBe(false);
    const result = evaluateMedicationInteractions("fluconazole", ["celecoxib"]);
    expect(result.interactions.some((item) => item.counterpartySlug === "celecoxib")).toBe(true);
    expect(result.unreachableCounterparties).toEqual([]);
  });

  it("gives a reverse-only match its wording, not just a name and a severity", () => {
    // Buprenorphine/naloxone's own rows never name naltrexone; naltrexone's row
    // names it. The caller holds only the viewed drug's record, so this text can
    // come from nowhere but the index — and it used to be passed as "", leaving a
    // CRITICAL alert with nothing underneath explaining it.
    const result = evaluateMedicationInteractions("buprenorphine-naloxone", ["naltrexone"]);
    const reverse = result.interactions.find((item) => item.counterpartySlug === "naltrexone");
    expect(reverse?.severity).toBe("critical");
    expect(reverse?.note).toMatch(/Opioid analgesia is antagonised/i);
  });

  it("prefers the live record's wording over the indexed copy when both exist", () => {
    const record = getMedicationRecord("sertraline");
    const withRecord = evaluateMedicationInteractions("sertraline", ["ibuprofen"], record);
    const withoutRecord = evaluateMedicationInteractions("sertraline", ["ibuprofen"]);
    // Same text either way while the artefact is fresh — `check:medication-interactions`
    // is what keeps that true — but the record is the authority when supplied.
    expect(withRecord.interactions[0]?.note).toBe(withoutRecord.interactions[0]?.note);
    expect(withoutRecord.interactions[0]?.note).toContain("NSAIDs");
  });

  it("keeps missing interaction data incomplete instead of green", () => {
    const result = evaluateMedicationInteractions("not-a-real-drug", ["sertraline"]);
    expect(result.dataAvailable).toBe(false);
    expect(result.unresolvedRowCount).toBeGreaterThan(0);
    const verdict = composeMedicationVerdict({
      considerationTone: null,
      considerationCount: 0,
      unassessedCount: 0,
      interactionTone: result.highestTone,
      interactionCount: result.interactions.length,
      unresolvedRowCount: result.unresolvedRowCount,
      unreviewedHighRiskCount: result.unreviewedHighRiskMedications.length,
    });
    expect(verdict.tone).toBe("neutral");
    expect(verdict.incomplete).toBe(true);
  });

  it("never reports a medication as interacting with itself", () => {
    const result = evaluateMedicationInteractions("ibuprofen", ["ibuprofen"]);
    expect(result.interactions.every((item) => item.counterpartySlug !== "ibuprofen")).toBe(true);
  });

  it("carries unresolved rows for incomplete parser coverage", () => {
    const result = evaluateMedicationInteractions("bupropion-sr", []);
    expect(result.unresolvedRowCount).toBeGreaterThan(0);
  });

  it("names counterparties from the index, falling back to the slug", () => {
    expect(medicationDisplayName("tramadol-ir")).toBe("Tramadol IR");
    expect(medicationDisplayName("not-a-real-drug")).toBe("not-a-real-drug");
    expect(interactionRowCount("not-a-real-drug")).toBe(0);
  });

  it("maps unknown severity conservatively", () => {
    expect(SEVERITY_TONE.critical).toBe("danger");
    expect(SEVERITY_TONE.unknown).toBe("neutral");
  });

  describe("Triple Whammy (ACEi + Diuretic + NSAID) requires the full combination", () => {
    // PR #2448 review: the generated index used to union each class's matches
    // into a flat counterparty list, so any ONE of ibuprofen, frusemide, or
    // even another ACEi fired the CRITICAL three-drug alert alone.
    it("does not fire on an NSAID alone", () => {
      const result = evaluateMedicationInteractions("ramipril", ["ibuprofen"]);
      expect(result.interactions.some((item) => item.kind === "Triple Whammy")).toBe(false);
    });

    it("does not fire on a diuretic alone", () => {
      const result = evaluateMedicationInteractions("ramipril", ["frusemide"]);
      expect(result.interactions.some((item) => item.kind === "Triple Whammy")).toBe(false);
    });

    it("does not fire on another ACEi alone", () => {
      const result = evaluateMedicationInteractions("ramipril", ["perindopril"]);
      expect(result.interactions.some((item) => item.kind === "Triple Whammy")).toBe(false);
    });

    it("fires once both a diuretic and an NSAID are present", () => {
      const result = evaluateMedicationInteractions("ramipril", ["frusemide", "ibuprofen"]);
      const hits = result.interactions.filter((item) => item.kind === "Triple Whammy");
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.every((item) => item.severity === "critical")).toBe(true);
      expect(result.highestTone).toBe("danger");
    });
  });

  describe("simvastatin's gemfibrozil row does not overmatch the statin/fibrate classes", () => {
    // PR #2448 review: "statin" and "(Fibrate)" in this HIGH/Contraindicated row
    // describe gemfibrozil's own mechanism, not a general class warning — they
    // used to resolve to every other statin and to fenofibrate, so a patient on
    // an unrelated statin alone triggered a gemfibrozil-specific alert. The
    // shared "blocks statin" phrase is unique to the two gemfibrozil rows
    // (simvastatin's and atorvastatin's), distinct from fenofibrate's own
    // legitimate, correctly-firing general statin-toxicity warning, which must
    // keep working.
    const isGemfibrozilRowNote = (note: string) => note.includes("Gemfibrozil (Fibrate) blocks statin");

    it("does not fire against atorvastatin, which is not gemfibrozil", () => {
      const result = evaluateMedicationInteractions("simvastatin", ["atorvastatin"]);
      expect(result.interactions.some((item) => isGemfibrozilRowNote(item.note))).toBe(false);
    });

    it("does not fire against fenofibrate, the catalogue's only other fibrate", () => {
      const result = evaluateMedicationInteractions("simvastatin", ["fenofibrate"]);
      expect(result.interactions.some((item) => isGemfibrozilRowNote(item.note))).toBe(false);
    });

    it("still fires fenofibrate's own legitimate statin-combination warning", () => {
      const result = evaluateMedicationInteractions("simvastatin", ["fenofibrate"]);
      expect(result.interactions.some((item) => item.counterpartySlug === "fenofibrate")).toBe(true);
    });
  });
});

describe("a documented low-severity interaction is never an all-clear", () => {
  // `success` is the tone the verdict band prints as "No alert found". A row the
  // catalogue documents is a finding, not an absence of one, so no severity that
  // produced a row may share it. Missing analysis (`unknown`) stays `neutral`.
  it("keeps every documented severity off the all-clear tone", () => {
    for (const severity of ["low", "none", "safe", "beneficial"] as const) {
      expect(SEVERITY_TONE[severity], severity).not.toBe("success");
      expect(SEVERITY_TONE[severity], severity).toBe("info");
    }
    expect(SEVERITY_TONE.critical).toBe("danger");
    expect(SEVERITY_TONE.unknown).toBe("neutral");
  });

  it("composes a LOW-only result away from green even when the analysis is complete", () => {
    // Mesalazine's own row: "LOW — Decreases absorption of Digoxin." Nothing about
    // this analysis is incomplete, so the incompleteness guards do not apply and
    // the tone mapping is the only thing keeping the headline honest.
    const record = getMedicationRecord("mesalazine");
    const result = evaluateMedicationInteractions("mesalazine", ["digoxin"], record);
    expect(result.interactions).toHaveLength(1);
    expect(result.interactions[0]?.severity).toBe("low");
    expect(result.interactions[0]?.tone).not.toBe("success");
    expect(result.unresolvedRowCount).toBe(0);
    expect(result.unreachableCounterparties).toEqual([]);

    const verdict = composeMedicationVerdict({
      considerationTone: null,
      considerationCount: 0,
      unassessedCount: 0,
      interactionTone: result.highestTone,
      interactionCount: result.interactions.length,
      unresolvedRowCount: result.unresolvedRowCount,
      unreachableCounterpartyCount: result.unreachableCounterparties.length,
      unreviewedHighRiskCount: result.unreviewedHighRiskMedications.length,
    });
    expect(verdict.incomplete).toBe(false);
    expect(verdict.interactionCount).toBe(1);
    expect(verdict.tone).not.toBe("success");
  });

  it("does the same for cefepime's additive-neurotoxicity row with tramadol", () => {
    const result = evaluateMedicationInteractions("cefepime", ["tramadol-ir"], getMedicationRecord("cefepime"));
    expect(result.interactions[0]?.severity).toBe("low");
    expect(result.highestTone).not.toBe("success");
  });

  it("still ranks an alerting row above a documented low one", () => {
    // The correction must not disturb the safety order it sits underneath:
    // mesalazine's CAUTION nephrotoxicity row with ibuprofen still leads, and the
    // LOW digoxin row sits below it rather than colouring the verdict.
    const result = evaluateMedicationInteractions("mesalazine", ["digoxin", "ibuprofen"]);
    expect(result.highestTone).toBe("warning");
    expect(result.interactions[0]?.severity).toBe("caution");
    expect(result.interactions.some((item) => item.severity === "low")).toBe(true);
  });
});

describe("composeMedicationVerdict", () => {
  const base = {
    considerationTone: null,
    considerationCount: 0,
    unassessedCount: 0,
    interactionTone: null,
    interactionCount: 0,
    unresolvedRowCount: 0,
    unreviewedHighRiskCount: 0,
  };

  it("is green only when both engines ran clean", () => {
    expect(composeMedicationVerdict(base)).toMatchObject({
      tone: "success",
      incomplete: false,
    });
  });

  it("degrades green to grey when interaction data is incomplete", () => {
    expect(composeMedicationVerdict({ ...base, unresolvedRowCount: 1 })).toMatchObject({
      tone: "neutral",
      incomplete: true,
    });
  });

  it("prefers manual review over a documented low-severity finding when data is incomplete", () => {
    // `info` is the documented-but-not-alerting tone. It must not outrank "we
    // could not finish the check": before this, a LOW row composed to `success`
    // and the incompleteness guard rewrote it to `neutral`, so the manual-review
    // headline survived. Moving LOW off green must not lose that.
    expect(
      composeMedicationVerdict({
        ...base,
        interactionTone: "info",
        interactionCount: 1,
        unresolvedRowCount: 1,
      }),
    ).toMatchObject({ tone: "neutral", incomplete: true });
  });

  it("keeps danger even when data is incomplete", () => {
    expect(
      composeMedicationVerdict({
        ...base,
        interactionTone: "danger",
        interactionCount: 1,
        unresolvedRowCount: 1,
      }),
    ).toMatchObject({ tone: "danger", incomplete: true });
  });
});

describe("interactionNoteBody", () => {
  it("drops the redundant severity prefix the badge already states", () => {
    expect(interactionNoteBody("CRITICAL — MAOIs, Tramadol. Massive risk of Serotonin Syndrome.")).toBe(
      "MAOIs, Tramadol. Massive risk of Serotonin Syndrome.",
    );
  });

  it("handles the hyphen and en-dash the catalogue also uses", () => {
    expect(interactionNoteBody("HIGH - Benzodiazepines/Alcohol.")).toBe("Benzodiazepines/Alcohol.");
    expect(interactionNoteBody("MODERATE – Antacids bind the drug.")).toBe("Antacids bind the drug.");
  });

  it("removes nothing else — every sentence of the clinical claim survives", () => {
    const note =
      "CRITICAL — NSAID + ACEi/ARB + Diuretic. Will virtually guarantee acute renal failure. NEVER prescribe this combination.";
    const body = interactionNoteBody(note);
    expect(body).toContain("Will virtually guarantee acute renal failure.");
    expect(body).toContain("NEVER prescribe this combination.");
    // Only the prefix is gone; the rest is byte-identical.
    expect(note.endsWith(body)).toBe(true);
  });

  it("leaves a row with no severity prefix untouched", () => {
    expect(interactionNoteBody("Blocks the cardioprotective effect of low-dose Aspirin.")).toBe(
      "Blocks the cardioprotective effect of low-dose Aspirin.",
    );
  });

  it("does not strip unknown uppercase clinical wording before a dash", () => {
    expect(interactionNoteBody("NSAID-induced renal injury")).toBe("NSAID-induced renal injury");
    expect(interactionNoteBody("NEVER-combine with MAOIs")).toBe("NEVER-combine with MAOIs");
  });

  it("does not eat an all-caps word that is part of the sentence", () => {
    // No dash, so nothing is a prefix.
    expect(interactionNoteBody("NEVER combine with MAOIs")).toBe("NEVER combine with MAOIs");
  });

  it("labels severity for display", () => {
    expect(severityLabel("critical")).toBe("Critical");
    expect(severityLabel("unknown")).toBe("Unknown");
  });
});

describe("loperamide over-match: the other directions", () => {
  // Complements the reverse-row test above. The over-match had two halves, fixed by
  // two different mechanisms, so each needs its own guard: `denySlugs` stops
  // loperamide being pulled INTO the opioids term (its catalogue subclass is
  // "Peripheral Opioid Agonist", which the term matches as a substring), and
  // `sourceDenySlugs` stops loperamide's OWN P-gp row — "…causing opioid
  // sedation…" — expanding to all 14 opioids.
  it("stays silent when loperamide is the medication being viewed", () => {
    const result = evaluateMedicationInteractions("loperamide", ["morphine-ir-iv"]);
    expect(result.interactions.some((item) => item.counterpartySlug === "morphine-ir-iv")).toBe(false);
  });

  it("keeps the genuine P-gp counterparty on loperamide's own row", () => {
    // Verapamil really is a P-gp inhibitor, which is what that row is about.
    // Losing it would mean the fix had over-corrected in the dangerous direction.
    const result = evaluateMedicationInteractions("loperamide", ["verapamil"]);
    expect(result.interactions.some((item) => item.counterpartySlug === "verapamil")).toBe(true);
  });

  it("leaves the sedation alerts a real opioid still triggers", () => {
    // Guards the other over-correction: the deny-list must remove loperamide only,
    // not weaken the term for opioids that do cross the blood-brain barrier.
    const result = evaluateMedicationInteractions("diazepam", ["morphine-ir-iv"]);
    expect(result.interactions.length).toBeGreaterThan(0);
  });
});

describe("clinical review 2026-08-22: three terms narrowed (ledger #1YPV51)", () => {
  // Each of the three corrections has the same shape as the loperamide fix — a
  // class token matching drugs the interaction rows plainly do not mean — so each
  // needs a guard in BOTH directions: the false alert is gone, and the true alert
  // the term exists for still fires.

  describe("antihistamines: anticholinergic burden, not histamine blockade", () => {
    it.each(["cetirizine", "fexofenadine", "loratadine"])(
      "no longer fires the anticholinergic toxidrome alert for %s",
      (slug) => {
        const result = evaluateMedicationInteractions("benzatropine", [slug]);
        expect(result.interactions.some((item) => item.counterpartySlug === slug)).toBe(false);
      },
    );

    it.each(["promethazine", "diphenhydramine", "alimemazine", "cyclizine"])(
      "still fires for %s, which is genuinely anticholinergic",
      (slug) => {
        const result = evaluateMedicationInteractions("benzatropine", [slug]);
        expect(result.interactions.some((item) => item.counterpartySlug === slug)).toBe(true);
      },
    );

    it("still fires on oxybutynin, the other critical anticholinergic row", () => {
      const result = evaluateMedicationInteractions("oxybutynin", ["promethazine"]);
      expect(result.interactions.some((item) => item.counterpartySlug === "promethazine")).toBe(true);
    });
  });

  describe("corticosteroids: systemic effects only", () => {
    it.each(["betamethasone", "clobetasol", "hydrocortisone-1", "triamcinolone"])(
      "no longer claims topical %s raises insulin requirements",
      (slug) => {
        const result = evaluateMedicationInteractions("insulin-glargine", [slug]);
        expect(result.interactions.some((item) => item.counterpartySlug === slug)).toBe(false);
      },
    );

    it.each(["prednisolone", "dexamethasone", "fludrocortisone"])("still fires for systemic %s", (slug) => {
      const result = evaluateMedicationInteractions("insulin-glargine", [slug]);
      expect(result.interactions.some((item) => item.counterpartySlug === slug)).toBe(true);
    });

    it.each(["budesonide", "ciclesonide", "fluticasone", "beclometasone", "mometasone"])(
      "deliberately keeps inhaled %s, which the hypokalaemia row is about",
      (slug) => {
        const result = evaluateMedicationInteractions("formoterol", [slug]);
        expect(result.interactions.some((item) => item.counterpartySlug === slug)).toBe(true);
      },
    );
  });

  describe("oral contraceptives: the combined pill", () => {
    it("no longer sweeps depot medroxyprogesterone into the generic inducer alerts", () => {
      // Topiramate's row is one of the "inducer destroys the OCP, use alternative
      // contraception" rows. Medroxyprogesterone reached it only through the
      // oral-contraceptives term, so removing it from that term removes the alert.
      const result = evaluateMedicationInteractions("topiramate", ["medroxyprogesterone"]);
      expect(result.interactions.some((item) => item.counterpartySlug === "medroxyprogesterone")).toBe(false);
    });

    it("keeps medroxyprogesterone's OWN inducer row, which is the accurate one", () => {
      // The catalogue already states the nuance the generic term flattened:
      // inducers "accelerate the clearance of the oral tablets, but the massive
      // 150mg IM depot is generally resistant to clinically failing from this."
      // That row must survive — losing it would be the dangerous over-correction,
      // and keeping it is why removing the generic alert is safe.
      const result = evaluateMedicationInteractions("medroxyprogesterone", ["carbamazepine"]);
      expect(result.interactions.some((item) => item.counterpartySlug === "carbamazepine")).toBe(true);
    });

    it.each(["ethinylestradiol", "levonorgestrel"])("still warns about %s", (slug) => {
      const result = evaluateMedicationInteractions("carbamazepine", [slug]);
      expect(result.interactions.some((item) => item.counterpartySlug === slug)).toBe(true);
    });
  });
});
