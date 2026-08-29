import { describe, expect, it } from "vitest";

import {
  buildDifferentialSnapshot,
  parseEntryFile,
  parseScenarioPresets,
  parseSearchAliases,
} from "../scripts/lib/parse-differentials-export";
import { staleSeededPresentations } from "@/lib/differential-seed";
import { isDifferentialMetadataArtifactTitle } from "@/lib/differential-snapshot";
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

  it("does not mix bundled search aliases into an explicit release ranking context", () => {
    const diagnosis = {
      ...differentialRecords[0]!,
      slug: "release-alias-diagnosis",
      title: "Delirium",
      subtitle: "",
      clinicalHinge: "",
      safetySnapshot: { summary: "", tags: [] },
      sections: [],
      related: [],
      currentPresentation: [],
      investigations: [],
      immediateActions: [],
    };
    const presentation = {
      ...differentialPresentations()[0]!,
      id: "release-alias-presentation",
      title: "Psychosis",
      subtitle: "",
      safetySnapshot: { summary: "", tags: [] },
      candidates: [],
      reviewChecklist: [],
      highestUrgencyNote: "",
    };
    const context = { diagnoses: [diagnosis], presentations: [presentation] };

    expect(rankDifferentialRecords([diagnosis], "confused", 10, [], context)).toEqual([]);
    expect(rankPresentationWorkflows([presentation], "psychotic", 10, [], context)).toEqual([]);
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
