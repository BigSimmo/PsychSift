import { describe, expect, it } from "vitest";

import {
  buildDifferentialSnapshot,
  parseEntryFile,
  parseScenarioPresets,
  parseSearchAliases,
} from "../scripts/lib/parse-differentials-export";
import { staleSeededPresentations } from "@/lib/differential-seed";
import { normalizePresentationWorkflow } from "@/lib/differential-presentation-display";
import { isDifferentialMetadataArtifactTitle } from "@/lib/differential-snapshot";
import { rowGovernance, type DifferentialRecordRow } from "@/lib/differential-records";
import {
  buildAdHocPresentationWorkflow,
  composeDifferentialSearchResults,
  differentialDiagnosesCards,
  differentialPresentations,
  differentialPresentationsCards,
  differentialRecords,
  differentialStaticParams,
  getDifferentialRecord,
  getPresentationWorkflow,
  getPresentationWorkflowForDiagnosisIds,
  getPresentationWorkflowSelectionForDiagnosisIds,
  loadDifferentialSnapshot,
  rankDifferentialRecords,
  rankPresentationWorkflows,
  searchDifferentialRecords,
  searchPresentationWorkflows,
  type DifferentialPresentationMatch,
  type DifferentialRecord,
  type DifferentialRecordMatch,
} from "@/lib/differentials";

describe("presentation workflow routing", () => {
  it("routes selected diagnoses to a workflow that contains them", () => {
    expect(getPresentationWorkflowForDiagnosisIds(["bipolar-depression-mixed-state"])?.id).toBe(
      "suicidal-ideation-suicide-attempt-self-harm",
    );
    expect(getPresentationWorkflowForDiagnosisIds([])).toBeNull();
  });

  it("keeps every valid diagnosis when selections span presentations", () => {
    const selection = getPresentationWorkflowSelectionForDiagnosisIds([
      "wernicke-encephalopathy",
      "major-depressive-disorder",
    ]);
    expect(selection?.kind).toBe("ad-hoc");
    expect(selection?.workflow.id).toBe("selected-differentials");
    expect(selection?.diagnosisIds).toEqual(["wernicke-encephalopathy", "major-depressive-disorder"]);
    expect(selection?.workflow.candidates.every((candidate) => candidate.selected)).toBe(true);
  });

  it("preserves the Pain search cross-presentation pair into an ad-hoc compare", () => {
    const selection = getPresentationWorkflowSelectionForDiagnosisIds([
      "medical-gi-endocrine-painful-organic-cause",
      "bpsd-as-unmet-need-delirium-pain-mimic",
    ]);
    expect(selection?.kind).toBe("ad-hoc");
    expect(selection?.diagnosisIds).toEqual([
      "medical-gi-endocrine-painful-organic-cause",
      "bpsd-as-unmet-need-delirium-pain-mimic",
    ]);
    expect(selection?.workflow.candidates.map((candidate) => candidate.slug)).toEqual([
      "medical-gi-endocrine-painful-organic-cause",
      "bpsd-as-unmet-need-delirium-pain-mimic",
    ]);
  });

  it("routes same-presentation selections to the hosting catalogue workflow", () => {
    const selection = getPresentationWorkflowSelectionForDiagnosisIds([
      "anorexia-nervosa",
      "bulimia-nervosa-binge-purge-pattern",
    ]);
    expect(selection?.kind).toBe("presentation");
    expect(selection?.workflow.id).toBe("food-refusal-not-eating-eating-disorder-spectrum");
    expect(selection?.diagnosisIds).toEqual(["anorexia-nervosa", "bulimia-nervosa-binge-purge-pattern"]);
  });

  it("omits unsupported ad-hoc compare criteria so cross-presentation rows are not placeholders", () => {
    const workflow = buildAdHocPresentationWorkflow([
      "medical-gi-endocrine-painful-organic-cause",
      "bpsd-as-unmet-need-delirium-pain-mimic",
    ]);
    expect(workflow).not.toBeNull();
    expect(workflow?.criteria.map((criterion) => criterion.id)).not.toContain("what-argues-against");
    for (const candidate of workflow?.candidates ?? []) {
      expect(candidate.comparison["what-argues-against"]).toBeUndefined();
      const nonPlaceholder = Object.values(candidate.comparison).filter((cell) => cell !== "Review locally.");
      expect(nonPlaceholder.length).toBeGreaterThan(0);
    }
  });
});

const deliriumEntry = `=== ENTRY 1 ===
Delirium / Acute Confusion / Encephalopathy

Urgency: emergent
Axis: organic
Population: general

TRIAGE RATIONALE:
Delirium and its encephalopathic mimics are acute medical emergencies.

MUST NOT MISS:
- Delirium

MIMICS:
Primary psychosis

CLINICAL HINGE:
Inattention plus altered awareness.

IMMEDIATE ACTIONS:
- Do vitals early

INVESTIGATIONS:
- Blood glucose

OPTIONS:
1. Delirium — Acute change, fluctuating course. Red flags: Sepsis, hypoxia.
2. Substance intoxication — Time-link to use. Red flags: Opioid respiratory depression.

SOURCE: v10`;

describe("differential export parser", () => {
  it("parses presentation entries and options", () => {
    const parsed = parseEntryFile(deliriumEntry);
    expect(parsed.slug).toBe("acute-confusion-encephalopathy");
    expect(parsed.options[0]?.slug).toBe("delirium");
    expect(parsed.options[1]?.slug).toBe("substance-intoxication");
  });

  it("preserves hyphenated option names when splitting summary", () => {
    const parsed = parseEntryFile(`=== ENTRY 1 ===
Delirium / Acute Confusion / Encephalopathy

Urgency: emergent
Axis: organic
Population: general

OPTIONS:
1. Post-ictal confusion — Witnessed or suspected seizure, stereotyped event. Red flags: Non-convulsive status epilepticus.

SOURCE: v10`);
    expect(parsed.options[0]?.name).toBe("Post-ictal confusion");
    expect(parsed.options[0]?.slug).toBe("post-ictal-confusion");
  });

  it("maps standard urgency to routine", () => {
    const parsed = parseEntryFile(`=== ENTRY 15 ===
Anxiety

Urgency: standard
Axis: mixed
Population: general

OPTIONS:
1. GAD — Chronic worry`);
    expect(parsed.status).toBe("routine");
  });

  it("parses scenario presets and search aliases", () => {
    const presets = parseScenarioPresets(
      `## 1. Older adult acute confusion\n- **Query:** \`older adult acute confusion\`\n- **Signals:** Older adult onset\n- **Entries:**\n  - Entry 1 — Delirium`,
    );
    expect(presets[0]?.query).toBe("older adult acute confusion");
    const aliases = parseSearchAliases("| delirium | confusion, fluctuation |");
    expect(aliases.delirium).toContain("confusion");
  });

  it("drops the document preamble and weight-table rows from presets and aliases", () => {
    const presets = parseScenarioPresets(
      `# Scenario Presets\n\nIntro prose mentioning Entry 26.\n\n## 1. Older adult acute confusion\n- **Query:** \`older adult acute confusion\``,
    );
    expect(presets).toHaveLength(1);
    expect(presets[0]?.query).toBe("older adult acute confusion");

    const aliases = parseSearchAliases("| tags | 1.1 |\n| delirium | confusion, 2.0, fluctuation |");
    expect(aliases.tags).toBeUndefined();
    expect(aliases.delirium).toEqual(["confusion", "fluctuation"]);
  });

  it("titles a titleless entry from its header instead of surfacing a metadata row", () => {
    // The trap-tables appendix has no title line, so the first line after the
    // header is a metadata row ("Urgency: urgent"). The parser must fall back
    // to the header text rather than use the metadata row as the title.
    const trapEntry = `=== FOCUSED DIAGNOSTIC TRAP TABLES ===

Urgency: urgent
Axis: mixed
Population: general

PURPOSE: Distinguishes intrusive/obsessional phenomena from psychotic or violent intent.

OPTIONS:
1. OCD — Repetitive intrusive thoughts with rituals. Red flags: Functional collapse.

SOURCE: v10`;
    const snapshot = buildDifferentialSnapshot({
      entryFiles: [
        { name: "01_Delirium.txt", content: deliriumEntry },
        { name: "T_Focused_Diagnostic_Trap_Tables.txt", content: trapEntry },
      ],
      presetsMarkdown: "",
      flowsMarkdown: "",
      aliasesMarkdown: "",
      governanceMarkdown: "",
    });
    const trap = snapshot.presentations.find((presentation) => presentation.id === "focused-diagnostic-trap-tables");
    expect(trap?.title).toBe("Focused Diagnostic Trap Tables");
    // No presentation may carry a metadata-row title.
    expect(
      snapshot.presentations.filter((presentation) => isDifferentialMetadataArtifactTitle(presentation.title)),
    ).toEqual([]);
    // The appendix keeps its options as diagnoses, parented by the retitled entry.
    expect(snapshot.diagnoses.find((diagnosis) => diagnosis.slug === "ocd")).toBeDefined();
  });

  it("preserves section summaries across merged presentation records (#VMG7D8)", () => {
    const entryA = `=== ENTRY 1 ===
Presentation Alpha
Urgency: routine
Axis: organic
Population: general

IMMEDIATE ACTIONS:
- Check vitals immediately
- Ensure patient safety

OPTIONS:
1. Shared Diagnosis — First entry summary. Red flags: Shock.

SOURCE: v10`;

    const entryB = `=== ENTRY 2 ===
Presentation Beta
Urgency: emergent
Axis: organic
Population: general

OPTIONS:
1. Shared Diagnosis — Higher urgency variant without immediate actions. Red flags: Coma.

SOURCE: v10`;

    const snapshot = buildDifferentialSnapshot({
      entryFiles: [
        { name: "01_Alpha.txt", content: entryA },
        { name: "02_Beta.txt", content: entryB },
      ],
      presetsMarkdown: "",
      flowsMarkdown: "",
      aliasesMarkdown: "",
      governanceMarkdown: "",
    });

    const diagnosis = snapshot.diagnoses.find((d) => d.slug === "shared-diagnosis");
    expect(diagnosis).toBeDefined();
    const actionSection = diagnosis?.sections.find((s) => s.id === "immediate-action");
    expect(actionSection).toBeDefined();
    // Entry B (emergent) had no immediate actions, but Entry A's section summary must be preserved.
    expect(actionSection?.summary).toContain("Check vitals");
    expect(actionSection?.items.length).toBeGreaterThan(0);
    expect(actionSection?.items).not.toContain("Stabilise and reassess.");
  });

  it("does not overwrite short real clinical actions with longer generic fallback text (#VMG7D8)", () => {
    const entryA = `=== ENTRY 1 ===
Presentation Alpha
Urgency: routine
Axis: organic
Population: general

IMMEDIATE ACTIONS:
- Check ECG

OPTIONS:
1. Short Action Dx — Summary. Red flags: None.

SOURCE: v10`;

    const entryB = `=== ENTRY 2 ===
Presentation Beta
Urgency: emergent
Axis: organic
Population: general

OPTIONS:
1. Short Action Dx — Higher urgency without immediate actions. Red flags: Coma.

SOURCE: v10`;

    const snapshot = buildDifferentialSnapshot({
      entryFiles: [
        { name: "01_Alpha.txt", content: entryA },
        { name: "02_Beta.txt", content: entryB },
      ],
      presetsMarkdown: "",
      flowsMarkdown: "",
      aliasesMarkdown: "",
      governanceMarkdown: "",
    });

    const diagnosis = snapshot.diagnoses.find((d) => d.slug === "short-action-dx");
    expect(diagnosis).toBeDefined();
    const actionSection = diagnosis?.sections.find((s) => s.id === "immediate-action");
    expect(actionSection).toBeDefined();
    // "Check ECG." is only 10 chars, while "Stabilise and reassess." is 23 chars.
    // The shorter real action must win over the longer generic placeholder.
    expect(actionSection?.summary).toBe("Check ECG.");
    expect(actionSection?.items).toEqual(["Check ECG"]);
  });
});

describe("differential records", () => {
  it("loads v10 snapshot with presentations and diagnoses", () => {
    const snapshot = loadDifferentialSnapshot();
    expect(snapshot.presentations).toHaveLength(31);
    expect(snapshot.diagnoses.length).toBeGreaterThan(100);
    expect(differentialRecords.length).toBe(snapshot.diagnoses.length);
    // No presentation may ship with a metadata-row title (e.g. "Urgency: urgent"),
    // and the mis-titled trap-tables appendix now carries its header title.
    expect(
      snapshot.presentations.filter((presentation) => isDifferentialMetadataArtifactTitle(presentation.title)),
    ).toEqual([]);
    expect(snapshot.presentations.some((presentation) => presentation.id === "urgency-urgent")).toBe(false);
    expect(
      snapshot.presentations.find((presentation) => presentation.id === "focused-diagnostic-trap-tables")?.title,
    ).toBe("Focused Diagnostic Trap Tables");
  });

  it("formats immediate action section summaries with commas and terminal periods (#Z9NS6H)", () => {
    const snapshot = loadDifferentialSnapshot();
    let multiItemCount = 0;
    for (const diagnosis of snapshot.diagnoses) {
      for (const section of diagnosis.sections || []) {
        if (section.id === "immediate-action" && Array.isArray(section.items) && section.items.length > 1) {
          multiItemCount += 1;
          const spaceJoined = section.items.join(" ");
          expect(section.summary).not.toBe(spaceJoined);
          expect(section.summary.endsWith(".")).toBe(true);
        }
      }
    }
    expect(multiItemCount).toBeGreaterThan(0);
  });

  it("uses concise presentation titles while retaining imported slash titles as searchable aliases", () => {
    const snapshot = loadDifferentialSnapshot();
    const retitled = snapshot.presentations.filter((presentation) => presentation.sourceTitle?.includes("/"));

    expect(retitled).toHaveLength(22);
    expect(retitled.every((presentation) => !presentation.title.includes("/"))).toBe(true);
    expect(retitled.every((presentation) => Boolean(presentation.scopeLabel))).toBe(true);
    expect(retitled.every((presentation) => presentation.titleAliases?.includes(presentation.sourceTitle ?? ""))).toBe(
      true,
    );

    const acuteConfusion = snapshot.presentations.find(
      (presentation) => presentation.id === "acute-confusion-encephalopathy",
    );
    expect(acuteConfusion?.title).toBe("Acute confusion and delirium");
    expect(acuteConfusion?.sourceTitle).toBe("Delirium / Acute Confusion / Encephalopathy");
    expect(rankPresentationWorkflows(snapshot.presentations, acuteConfusion?.sourceTitle ?? "")[0]?.workflow.id).toBe(
      "acute-confusion-encephalopathy",
    );
  });

  it("normalizes an older stored presentation payload without changing its stable route id", () => {
    const current = getPresentationWorkflow("acute-confusion-encephalopathy");
    expect(current).not.toBeNull();
    const legacyPayload = {
      ...current!,
      title: current!.sourceTitle!,
      sourceTitle: undefined,
      scopeLabel: undefined,
      titleAliases: undefined,
    };

    const normalized = normalizePresentationWorkflow(legacyPayload);
    expect(normalized.id).toBe(legacyPayload.id);
    expect(normalized.title).toBe("Acute confusion and delirium");
    expect(normalized.sourceTitle).toBe("Delirium / Acute Confusion / Encephalopathy");
    expect(normalized.titleAliases).toContain(legacyPayload.title);
  });

  it("flags a retired presentation slug for pruning, leaving diagnoses alone", () => {
    // Retitling changed the appendix slug, so the old "urgency-urgent" row is no
    // longer produced by the snapshot and must be pruned from seeded owners.
    const rows = [
      { kind: "presentation", slug: "urgency-urgent" },
      { kind: "presentation", slug: "focused-diagnostic-trap-tables" },
      { kind: "diagnosis", slug: "urgency-urgent" },
    ];
    const stale = staleSeededPresentations(rows);
    expect(stale).toEqual([{ kind: "presentation", slug: "urgency-urgent" }]);
  });

  it("links cards to routes", () => {
    expect(differentialDiagnosesCards.every((card) => card.href.startsWith("/differentials/diagnoses/"))).toBe(true);
    expect(
      differentialPresentationsCards.find((card) => card.id === "presentation-acute-confusion-encephalopathy")?.href,
    ).toBe("/differentials/presentations/acute-confusion-encephalopathy");
  });

  it("wires acute confusion candidates to diagnosis records", () => {
    const workflow = getPresentationWorkflow("acute-confusion-encephalopathy");
    expect(workflow?.candidates.every((candidate) => getDifferentialRecord(candidate.slug))).toBe(true);
  });

  it("supports lookup and search", () => {
    expect(getDifferentialRecord("delirium")).not.toBeNull();
    expect(differentialStaticParams().length).toBe(differentialRecords.length);
    expect(searchDifferentialRecords("delirium").length).toBeGreaterThan(0);
  });

  it("ranks exact diagnosis matches first with reasons", () => {
    const matches = rankDifferentialRecords(differentialRecords, "delirium");
    expect(matches[0]?.record.slug).toBe("delirium");
    expect(matches[0]?.reasons).toContain("title");
    expect(matches[0]?.score ?? 0).toBeGreaterThan(0);
    // Ranked order is monotonic by score.
    for (let index = 1; index < matches.length; index += 1) {
      expect(matches[index - 1]!.score).toBeGreaterThanOrEqual(matches[index]!.score);
    }
  });

  it("surfaces symptom-alias matches from the imported alias table", () => {
    // "confused" expands via the catalogue searchAliases to confusion/delirium/
    // encephalopathy, so the delirium record matches through the alias path.
    const matches = rankDifferentialRecords(differentialRecords, "confused");
    const delirium = matches.find((match) => match.record.slug === "delirium");
    expect(delirium).toBeDefined();
    expect(delirium?.reasons).toContain("symptom alias");
  });

  it("returns no ranked matches for an empty query but keeps the legacy full-set contract", () => {
    expect(rankDifferentialRecords(differentialRecords, "  ")).toEqual([]);
    expect(rankPresentationWorkflows(differentialPresentations(), "")).toEqual([]);
    expect(searchDifferentialRecords("").length).toBe(differentialRecords.length);
    expect(searchPresentationWorkflows("").length).toBe(differentialPresentations().length);
  });

  it("ranks the acute confusion presentation first for its own vocabulary", () => {
    const matches = rankPresentationWorkflows(differentialPresentations(), "acute confusion");
    expect(matches[0]?.workflow.id).toBe("acute-confusion-encephalopathy");
  });

  it("surfaces the containing presentation for a candidate diagnosis term", () => {
    // "wernicke" is no presentation's own vocabulary; the cross-entity candidates lane links
    // the query to the work-up that lists Wernicke encephalopathy as a differential.
    const matches = rankPresentationWorkflows(differentialPresentations(), "wernicke");
    expect(matches[0]?.workflow.id).toBe("acute-confusion-encephalopathy");
    expect(matches[0]?.reasons).toContain("candidate differential");
  });

  it("threads expansions into the presentation ranker's expanded lane", () => {
    // A nonsense base query matches nothing on its own…
    expect(rankPresentationWorkflows(differentialPresentations(), "zzznotarealterm", 5)).toHaveLength(0);
    // …but an expansion term surfaces the matching workflow (parity with rankDifferentialRecords).
    const expanded = rankPresentationWorkflows(differentialPresentations(), "zzznotarealterm", 5, ["hallucinations"]);
    expect(expanded.some((match) => match.workflow.id === "hallucinations")).toBe(true);
  });

  it("surfaces candidate diagnoses for a presentation-title query", () => {
    const workflow = getPresentationWorkflow("acute-confusion-encephalopathy");
    const matches = rankDifferentialRecords(
      differentialRecords,
      "acute confusion encephalopathy",
      differentialRecords.length,
    );
    const matchedSlugs = new Set(matches.map((match) => match.record.slug));
    // Every candidate of the matching presentation surfaces, even those whose own titles
    // share none of the query vocabulary (e.g. delirium), via the reverse link lane.
    expect(workflow?.candidates.every((candidate) => matchedSlugs.has(candidate.slug))).toBe(true);
    const delirium = matches.find((match) => match.record.slug === "delirium");
    expect(delirium?.reasons).toContain("presentation link");
  });

  it("does not leak service registry terms", () => {
    const combinedDifferentialText = JSON.stringify({
      differentialRecords,
      differentialDiagnosesCards,
      differentialPresentationsCards,
    }).toLowerCase();

    for (const serviceTerm of [
      "13yarn",
      "mherl",
      "rurallink",
      "medicare mental health",
      "service referral",
      "transport order",
      "mental health act form",
    ]) {
      expect(combinedDifferentialText).not.toContain(serviceTerm);
    }
  });
});

function makeRecord(slug: string, status: DifferentialRecord["status"] = "routine"): DifferentialRecord {
  return {
    slug,
    title: slug,
    status,
    subtitle: `${slug} subtitle`,
    clinicalHinge: `${slug} hinge`,
    safetySnapshot: { summary: `${slug} safety`, tags: [] },
    sections: [],
    related: [],
    currentPresentation: [`${slug} presentation feature`],
    investigations: [`${slug} test`],
    immediateActions: [],
  };
}

function diagnosisMatch(slug: string, score: number): DifferentialRecordMatch {
  return { record: makeRecord(slug), score, reasons: ["title"] };
}

function presentationMatch(id: string, score: number, candidateSlugs: string[]): DifferentialPresentationMatch {
  return {
    workflow: {
      id,
      title: id,
      status: "emergent",
      subtitle: `${id} subtitle`,
      selectedCount: 0,
      totalCount: candidateSlugs.length,
      safetySnapshot: { summary: `${id} safety`, tags: ["tag-one"] },
      criteria: [],
      candidates: candidateSlugs.map((slug) => ({ slug, selected: false, comparison: {} })),
      reviewChecklist: [`${id} review step`],
      highestUrgencyNote: "",
      sourceStatus: { label: "", version: "", lastUpdated: "" },
    },
    score,
    reasons: ["title"],
  };
}

describe("composeDifferentialSearchResults", () => {
  it("leads with a presentation when it matches about as strongly as the best diagnosis", () => {
    const results = composeDifferentialSearchResults(
      [diagnosisMatch("alpha", 10), diagnosisMatch("beta", 8)],
      [presentationMatch("workflow-one", 9, ["beta"])],
    );
    expect(results[0]).toMatchObject({
      kind: "presentation",
      id: "workflow-one",
      matchLabel: "Best match",
      clinicalCues: ["tag-one"],
      nextSteps: ["workflow-one review step"],
    });
    // Candidate diagnoses of the lead presentation come before other diagnoses.
    expect(results[1]).toMatchObject({ kind: "diagnosis", id: "beta" });
    expect(results[2]).toMatchObject({ kind: "diagnosis", id: "alpha" });
  });

  it("leads with diagnoses when the presentation match is weak", () => {
    const results = composeDifferentialSearchResults(
      [diagnosisMatch("alpha", 20)],
      [presentationMatch("workflow-one", 3, [])],
    );
    expect(results[0]).toMatchObject({
      kind: "diagnosis",
      id: "alpha",
      clinicalCues: ["alpha presentation feature"],
      nextSteps: ["alpha test"],
    });
    expect(results[1]).toMatchObject({ kind: "presentation", id: "workflow-one" });
  });

  it("dedupes by id, caps at the limit, and tiers match labels", () => {
    const diagnoses = Array.from({ length: 12 }, (_, index) => diagnosisMatch(`dx-${index}`, 20 - index));
    const results = composeDifferentialSearchResults([...diagnoses, diagnosisMatch("dx-0", 20)], []);
    expect(results).toHaveLength(8);
    expect(new Set(results.map((result) => result.id)).size).toBe(8);
    expect(results[0]?.matchLabel).toBe("Best match");
    expect(results[1]?.matchLabel).toBe("High match");
    const lowest = composeDifferentialSearchResults([diagnosisMatch("a", 9), diagnosisMatch("b", 4)], []);
    expect(lowest[1]?.matchLabel).toBe("Lower match");
  });

  it("maps hrefs to the catalogue detail pages", () => {
    const results = composeDifferentialSearchResults(
      [diagnosisMatch("alpha", 10)],
      [presentationMatch("workflow-one", 10, [])],
    );
    const presentation = results.find((result) => result.kind === "presentation");
    const diagnosis = results.find((result) => result.kind === "diagnosis");
    expect(presentation?.href).toBe("/differentials/presentations/workflow-one");
    expect(diagnosis?.href).toBe("/differentials/diagnoses/alpha");
  });
});

describe("ranked differential search", () => {
  it("interprets presentation language without leaving the differential catalogue", () => {
    const matches = rankDifferentialRecords(
      differentialRecords,
      "What can cause hearing voices?",
      differentialRecords.length,
      [],
      true,
    );
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some(({ record }) => record.slug.includes("psychosis"))).toBe(true);
  });

  it("ranks title matches above content-only matches", () => {
    const matches = rankDifferentialRecords(differentialRecords, "delirium");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].record.slug).toContain("delirium");
    expect(matches[0].score).toBeGreaterThanOrEqual(matches[matches.length - 1].score);
    expect(matches[0].reasons).toContain("title");
  });

  it("keeps the full catalogue for an empty query and still honours aliases", () => {
    expect(searchDifferentialRecords("")).toEqual(differentialRecords);
    expect(searchDifferentialRecords("   ")).toEqual(differentialRecords);
  });
});

describe("differential rowGovernance", () => {
  function makeDifferentialRow(overrides: Partial<DifferentialRecordRow> = {}): DifferentialRecordRow {
    return {
      id: "11111111-1111-4111-8111-111111111111",
      owner_id: "22222222-2222-4222-8222-222222222222",
      slug: "test-differential",
      kind: "presentation",
      title: "Test Differential",
      subtitle: null,
      status: "routine",
      clinical_hinge: null,
      tags: [],
      payload: {},
      source: {},
      source_status: "current",
      validation_status: "unverified",
      last_reviewed_at: null,
      review_due_at: null,
      created_at: "2026-05-14T00:00:00.000Z",
      updated_at: "2026-05-14T00:00:00.000Z",
      ...overrides,
    };
  }

  it("preserves stored outdated status when no newer review has occurred", () => {
    const row = makeDifferentialRow({ source_status: "outdated", last_reviewed_at: null });
    const governance = rowGovernance(row, new Date("2026-09-02T00:00:00.000Z"));
    expect(governance.sourceStatus).toBe("outdated");
  });

  it("CONTRACT CHANGED: a review date three days in the future does not clear outdated", () => {
    // This previously expected "current". A mistyped year is the only way a
    // review date lands meaningfully ahead of the reference, and it must not read
    // as a fresh check. One day of tolerance covers clock skew; three days is a
    // data error. registry-records.ts bounds the same way.
    const row = makeDifferentialRow({
      source_status: "outdated",
      last_reviewed_at: "2026-09-05T00:00:00.000Z",
    });
    const governance = rowGovernance(row, new Date("2026-09-02T00:00:00.000Z"));
    expect(governance.sourceStatus).toBe("outdated");
    // The date is still surfaced — it is reported, just not treated as evidence.
    expect(governance.lastReviewedAt).toBe("2026-09-05T00:00:00.000Z");
  });

  it("accepts a review dated within the future-date tolerance as a re-verification", () => {
    const row = makeDifferentialRow({
      source_status: "outdated",
      last_reviewed_at: "2026-09-02T18:00:00.000Z",
    });
    expect(rowGovernance(row, new Date("2026-09-02T00:00:00.000Z")).sourceStatus).toBe("current");
  });

  it("re-evaluates outdated status to review_due when review_due_at has passed", () => {
    const row = makeDifferentialRow({
      source_status: "outdated",
      last_reviewed_at: "2026-09-01T00:00:00.000Z",
      review_due_at: "2026-09-05T00:00:00.000Z",
    });
    const governance = rowGovernance(row, new Date("2026-09-10T00:00:00.000Z"));
    expect(governance.sourceStatus).toBe("review_due");
  });

  it("CONTRACT CHANGED: source.lastUpdated alone does not clear a supersession", () => {
    // This previously expected "current", and it is the sharpest case. Supersession
    // is a recorded clinical judgement about THIS RECORD. `source.lastUpdated`
    // says when the upstream document changed — which is not evidence that anyone
    // re-examined this record against it, and certainly not that the replacement
    // content was reviewed. The old predicate accepted the mere EXISTENCE of the
    // field.
    const row = makeDifferentialRow({
      source_status: "outdated",
      source: { label: "Updated Source", lastUpdated: "2026-09-05" },
    });
    expect(rowGovernance(row, new Date("2026-09-10T00:00:00.000Z")).sourceStatus).toBe("outdated");
  });

  it("keeps outdated when the only evidence is an old review date", () => {
    // The other half of the old `hasValidReviewDate || …` predicate: any parseable
    // date, however old, promoted a superseded record back to current.
    const row = makeDifferentialRow({
      source_status: "outdated",
      last_reviewed_at: "2019-01-01T00:00:00.000Z",
      review_due_at: null,
    });
    expect(rowGovernance(row, new Date("2026-09-10T00:00:00.000Z")).sourceStatus).toBe("outdated");
  });

  it("keeps outdated when the review date is implausibly far in the future", () => {
    const row = makeDifferentialRow({
      source_status: "outdated",
      last_reviewed_at: "2126-01-01T00:00:00.000Z",
      review_due_at: null,
    });
    expect(rowGovernance(row, new Date("2026-09-10T00:00:00.000Z")).sourceStatus).toBe("outdated");
  });

  it("keeps outdated when the review date is unparseable", () => {
    const row = makeDifferentialRow({ source_status: "outdated", last_reviewed_at: "not a date" });
    expect(rowGovernance(row, new Date("2026-09-10T00:00:00.000Z")).sourceStatus).toBe("outdated");
  });

  it("clears outdated on a complete recorded review cycle, and still reports the lapse", () => {
    // A review date together with a review-due date is what a governed review
    // actually writes, so it counts — but a due date already past reads review_due,
    // not current.
    const row = makeDifferentialRow({
      source_status: "outdated",
      last_reviewed_at: "2026-09-01T00:00:00.000Z",
      review_due_at: "2026-09-05T00:00:00.000Z",
    });
    expect(rowGovernance(row, new Date("2026-09-10T00:00:00.000Z")).sourceStatus).toBe("review_due");
  });

  it("never promotes a cleared record whose source still says it was not checked", () => {
    const row = makeDifferentialRow({
      source_status: "outdated",
      last_reviewed_at: "2026-09-01T00:00:00.000Z",
      review_due_at: "2027-09-05T00:00:00.000Z",
      source: { label: "Some Source", note: "not checked" },
    });
    expect(rowGovernance(row, new Date("2026-09-10T00:00:00.000Z")).sourceStatus).toBe("unknown");
  });

  it("leaves clinical validation status untouched by any source-freshness decision", () => {
    // Two separate axes: a source can go stale without un-approving the clinical
    // review, and vice versa.
    const row = makeDifferentialRow({
      source_status: "outdated",
      validation_status: "approved",
      last_reviewed_at: "2019-01-01T00:00:00.000Z",
    });
    expect(rowGovernance(row, new Date("2026-09-10T00:00:00.000Z"))).toMatchObject({
      sourceStatus: "outdated",
      validationStatus: "approved",
    });
  });
});
