import { describe, expect, it } from "vitest";
import {
  __safetyPatternLabelForTests,
  collapseDuplicateSafetyFindings,
  extractSafetyFindings,
  groupSafetyFindingsByKind,
  safetyFindingTone,
  sortSafetyFindingsBySeverity,
  type SafetyFinding,
  type SafetyFindingKind,
} from "../src/lib/clinical-safety";
import type { RagAnswer } from "../src/lib/types";

const answer: RagAnswer = {
  answer: "Escalate review for urgent warning features.",
  grounded: true,
  confidence: "medium",
  citations: [],
  sources: [
    {
      id: "chunk-1",
      document_id: "doc-1",
      title: "Risk source",
      file_name: "risk.pdf",
      page_number: 1,
      chunk_index: 0,
      section_heading: "Escalation",
      content: "Escalate for urgent review when red flag features are present.",
      image_ids: [],
      similarity: 0.8,
      images: [],
    },
  ],
};

const directRelevance = {
  verdict: "direct" as const,
  label: "Direct match",
  matchedTerms: ["urgent"],
  missingTerms: [],
  directSourceCount: 1,
  weakSourceCount: 0,
  score: 0.9,
  supportReason: "Direct indexed support found.",
  isSourceBacked: true,
};

const nearbyRelevance = {
  verdict: "nearby" as const,
  label: "Nearby only",
  matchedTerms: ["monitoring"],
  missingTerms: ["lithium"],
  directSourceCount: 0,
  weakSourceCount: 1,
  score: 0.32,
  supportReason: "Only nearby indexed passages were found.",
  isSourceBacked: false,
};

describe("clinical safety findings", () => {
  it("extracts only source-backed safety findings from grounded answers", () => {
    const findings = extractSafetyFindings(answer);

    expect(findings).toHaveLength(1);
    expect(findings[0].label).toBe("Red flag");
    expect(findings[0].text).toContain("Escalate for urgent review");
    expect(findings[0].text).not.toContain("Source mentions:");
    expect(findings[0].href).toBe("/documents/doc-1?page=1&chunk=chunk-1");
  });

  it("does not show safety findings for ungrounded answers", () => {
    expect(extractSafetyFindings({ ...answer, grounded: false })).toEqual([]);
  });

  it("suppresses generic safety findings when evidence is nearby only", () => {
    expect(extractSafetyFindings({ ...answer, relevance: nearbyRelevance })).toEqual([]);
  });

  it("keeps safety findings when relevance is source-backed", () => {
    const findings = extractSafetyFindings({
      ...answer,
      relevance: directRelevance,
      sources: answer.sources.map((source) => ({ ...source, source_strength: "moderate" })),
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].label).toBe("Red flag");
  });

  it("does not leak internal image or table metadata in safety findings", () => {
    const findings = extractSafetyFindings({
      ...answer,
      quoteCards: [
        {
          chunk_id: "chunk-1",
          document_id: "doc-1",
          title: "Risk source",
          file_name: "risk.pdf",
          page_number: 1,
          chunk_index: 0,
          section_heading: null,
          quote:
            "[[IMAGE_DATA_START]] Image ID: img-1; Source kind: table_crop; Image type: clinical_table; Table role: clinical; Table text: | Dose | Route | [[IMAGE_DATA_END]] Monitor blood tests after dose changes.",
        },
      ],
      sources: [],
    });

    expect(findings[0].text).toContain("Monitor blood tests");
    expect(findings[0].text).not.toContain("[[IMAGE_DATA_START]]");
    expect(findings[0].text).not.toContain("Image ID:");
    expect(findings[0].text).not.toContain("Table text:");
  });

  it("removes provenance boilerplate from extracted finding text", () => {
    const findings = extractSafetyFindings({
      ...answer,
      quoteCards: [
        {
          chunk_id: "chunk-1",
          document_id: "doc-1",
          title: "Risk source",
          file_name: "risk.pdf",
          page_number: 1,
          chunk_index: 0,
          section_heading: null,
          quote:
            "Source mentions: Procedure PAE-PRO-0338/16 Page 5 of 5. Chunk index: 12. Monitor FBC weekly and escalate urgent toxicity symptoms.",
        },
      ],
      sources: [],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].text).toContain("Monitor FBC weekly");
    expect(findings[0].text).not.toMatch(/Source mentions|PAE-PRO-0338|Page 5 of 5|Chunk index/i);
  });

  // Audit M9: the document-code scrub carried the `i` flag, so
  // `[A-Z]{2,}(?:-[A-Z0-9]+)+` matched any lowercase hyphenated word after
  // protocol/policy/procedure and deleted the subject of the sentence.
  it("keeps ordinary hyphenated phrases after protocol, policy or procedure (M9)", () => {
    const findings = extractSafetyFindings({
      ...answer,
      quoteCards: [
        {
          chunk_id: "chunk-1",
          document_id: "doc-1",
          title: "Risk source",
          file_name: "risk.pdf",
          page_number: 1,
          chunk_index: 0,
          section_heading: null,
          quote: "Follow the clozapine protocol re-challenge only after haematology review.",
        },
        {
          chunk_id: "chunk-2",
          document_id: "doc-1",
          title: "Risk source",
          file_name: "risk.pdf",
          page_number: 2,
          chunk_index: 1,
          section_heading: null,
          quote: "Per local policy co-prescribing of two antipsychotics requires senior review first.",
        },
        {
          chunk_id: "chunk-3",
          document_id: "doc-1",
          title: "Risk source",
          file_name: "risk.pdf",
          page_number: 3,
          chunk_index: 2,
          section_heading: null,
          quote: "Procedure post-operative delirium monitoring: repeat FBC daily.",
        },
      ],
      sources: [],
    });

    const texts = findings.map((finding) => finding.text).join(" | ");
    expect(texts).toContain("protocol re-challenge");
    expect(texts).toContain("policy co-prescribing");
    expect(texts).toContain("post-operative delirium monitoring");
  });

  // Audit L111: the chip text was cut at a fixed 257 characters with no word or
  // number boundary, so "ANC 1500" straddling the cut rendered as "ANC 1" — a
  // partial number that reads as a complete threshold.
  it("never cuts a safety finding inside a numeric token (L111)", () => {
    const prefix = "Monitor renal function weekly. ".repeat(8);
    const findings = extractSafetyFindings({
      ...answer,
      quoteCards: [
        {
          chunk_id: "chunk-1",
          document_id: "doc-1",
          title: "Risk source",
          file_name: "risk.pdf",
          page_number: 1,
          chunk_index: 0,
          section_heading: null,
          quote: `${prefix}and ANC 1500 requires urgent review and escalation to the on-call haematology team today.`,
        },
      ],
      sources: [],
    });

    const text = findings[0].text;
    expect(text.length).toBeLessThanOrEqual(261);
    // The full threshold did not fit; showing part of it is worse than showing
    // none of it.
    expect(text).not.toMatch(/ANC\s+1\b/);
    // The cut lands on a word boundary, so no token — least of all a number —
    // is shown in part.
    expect(text.replace(/\.+$/, "")).toMatch(/\bweekly$/);
  });

  // Audit L111, second boundary case (Codex review on PR #2610): when a numeric
  // threshold ends EXACTLY at the cut, the slice already holds the complete token,
  // but backing up to the previous space deleted the whole value — "ANC below 1500"
  // rendered as "ANC below", which still reads as a finished instruction with the
  // threshold silently removed.
  it("keeps a threshold that ends exactly at the cut (L111)", () => {
    const tail = "ANC below 1500";
    const lead = "Monitor renal function weekly. ";
    let prefix = "";
    while (prefix.length < 257 - tail.length) prefix += lead;
    prefix = prefix.slice(0, 257 - tail.length);
    const quote = `${prefix}${tail} and escalate to haematology the same day.`;
    // The final "0" is the last sliced character and the cut lands on the space.
    expect(quote[256]).toBe("0");
    expect(quote[257]).toBe(" ");

    const findings = extractSafetyFindings({
      ...answer,
      quoteCards: [
        {
          chunk_id: "chunk-1",
          document_id: "doc-1",
          title: "Risk source",
          file_name: "risk.pdf",
          page_number: 1,
          chunk_index: 0,
          section_heading: null,
          quote,
        },
      ],
      sources: [],
    });

    const text = findings[0].text;
    expect(text.length).toBeLessThanOrEqual(261);
    expect(text).toContain("ANC below 1500");
    // and never the value-stripped form that reads as a complete instruction
    expect(text).not.toMatch(/ANC below\s*\.*$/);
  });

  it("sorts safety findings by clinical severity", () => {
    const findings: SafetyFinding[] = [
      {
        id: "monitoring:1",
        kind: "monitoring",
        label: "Monitoring",
        text: "Monitor renal function.",
        citation: {
          chunk_id: "1",
          document_id: "doc-1",
          title: "Guide",
          file_name: "guide.pdf",
          page_number: 1,
          chunk_index: 0,
        },
        href: "/documents/doc-1?page=1&chunk=1",
      },
      {
        id: "contraindication:2",
        kind: "contraindication",
        label: "Contraindication",
        text: "Do not use with NSAIDs.",
        citation: {
          chunk_id: "2",
          document_id: "doc-1",
          title: "Guide",
          file_name: "guide.pdf",
          page_number: 2,
          chunk_index: 1,
        },
        href: "/documents/doc-1?page=2&chunk=2",
      },
      {
        id: "caveat:3",
        kind: "caveat",
        label: "Caveat",
        text: "Consider dose adjustment.",
        citation: {
          chunk_id: "3",
          document_id: "doc-1",
          title: "Guide",
          file_name: "guide.pdf",
          page_number: 3,
          chunk_index: 2,
        },
        href: "/documents/doc-1?page=3&chunk=3",
      },
    ];

    const sorted = sortSafetyFindingsBySeverity(findings);

    expect(sorted.map((finding) => finding.kind)).toEqual(["contraindication", "monitoring", "caveat"]);
  });

  it("extracts contraindication findings when words like 'contraindicated' or 'contraindications' are used", () => {
    const contraindicatedAnswer: RagAnswer = {
      answer: "This medication is contraindicated in pregnancy.",
      grounded: true,
      confidence: "high",
      citations: [],
      sources: [
        {
          id: "chunk-contra",
          document_id: "doc-contra",
          title: "Obstetrics Guide",
          file_name: "obs.pdf",
          page_number: 5,
          chunk_index: 0,
          section_heading: "Safety in Pregnancy",
          content: "This therapy is strictly contraindicated in pregnancy due to teratogenicity risk.",
          image_ids: [],
          similarity: 0.95,
          images: [],
        },
      ],
    };

    const findings = extractSafetyFindings(contraindicatedAnswer);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("contraindication");
    expect(findings[0].label).toBe("Contraindication");
    expect(findings[0].text).toContain("contraindicated in pregnancy");
  });
});

describe("safety findings are counted once per passage", () => {
  // The live clozapine answer reported "3 safety notes" over two passages: the
  // quote card and its own parent chunk both matched, so one passage was listed
  // twice — once as "Red flag" (the longer text reaches that pattern) and once
  // as "Monitoring" (the extract does not). The count is the whole point of the
  // chip that opens this list, so an inflated one is not cosmetic.
  const passage =
    "clozapine safety checkpoints: FBC/ANC monitoring, myocarditis symptom screening, metabolic monitoring, constipation prevention, and shared-care communication.";
  const fullerPassage = `${passage} Urgent review triggers include fever, chest pain, dyspnoea, tachycardia, marked sedation, seizures.`;

  const duplicatedAnswer: RagAnswer = {
    answer: "Clozapine monitoring covers FBC/ANC and myocarditis screening.",
    grounded: true,
    confidence: "medium",
    citations: [],
    quoteCards: [
      {
        chunk_id: "chunk-a",
        document_id: "doc-a",
        title: "Clozapine monitoring protocol",
        file_name: "clozapine.pdf",
        page_number: 1,
        chunk_index: 0,
        similarity: 0.82,
        quote: passage,
      },
    ] as RagAnswer["quoteCards"],
    sources: [
      {
        id: "chunk-a",
        document_id: "doc-a",
        title: "Clozapine monitoring protocol",
        file_name: "clozapine.pdf",
        page_number: 1,
        chunk_index: 0,
        section_heading: "Monitoring",
        content: fullerPassage,
        image_ids: [],
        similarity: 0.82,
        images: [],
      },
      {
        id: "chunk-b",
        document_id: "doc-a",
        title: "Clozapine monitoring protocol",
        file_name: "clozapine.pdf",
        page_number: 2,
        chunk_index: 1,
        section_heading: "Escalation",
        content: "Escalate for urgent review when red flag features are present.",
        image_ids: [],
        similarity: 0.8,
        images: [],
      },
    ],
  };

  it("collapses a quote card into its own parent chunk", () => {
    const findings = extractSafetyFindings(duplicatedAnswer);
    const page1 = findings.filter((finding) => finding.citation.page_number === 1);

    expect(page1).toHaveLength(1);
    // The fuller text survives, and with it the more severe of the two labels.
    expect(page1[0].text).toContain("Urgent review triggers");
    expect(page1[0].label).toBe("Red flag");
    // A genuinely separate passage on another page is untouched.
    expect(findings.filter((finding) => finding.citation.page_number === 2)).toHaveLength(1);
  });

  it("collapses warnings that arrive already computed, not only freshly extracted ones", () => {
    // The server computes these and the client re-reads them, so the guarantee
    // has to hold on the way in as well as at extraction.
    const precomputed = extractSafetyFindings({ ...duplicatedAnswer });
    const doubled = [...precomputed, ...precomputed];

    expect(extractSafetyFindings({ ...duplicatedAnswer, safetyWarnings: doubled })).toHaveLength(precomputed.length);
  });

  it("collapses a short quote against its own parent chunk, under the length floor", () => {
    // The floor exists for the cross-chunk case. A quote card carries its parent
    // chunk's id, so containment there is proof of one passage however short the
    // extract — and applying the floor to it let a short quote double-count
    // against the very chunk it was cut from.
    const fromChunk = (id: string, chunkId: string, text: string, kind: SafetyFinding["kind"]): SafetyFinding => ({
      id,
      kind,
      label: kind === "red_flag" ? "Red flag" : "Monitoring",
      text,
      citation: {
        chunk_id: chunkId,
        document_id: "doc-a",
        title: "Protocol",
        file_name: "p.pdf",
        page_number: 1,
        chunk_index: 0,
        similarity: 0.8,
      },
      href: "/documents/doc-a?page=1",
    });

    const findings = collapseDuplicateSafetyFindings([
      fromChunk("monitoring:chunk-a", "chunk-a", "Monitor ANC weekly.", "monitoring"),
      fromChunk("red_flag:chunk-a", "chunk-a", "Monitor ANC weekly. Urgent review if fever develops.", "red_flag"),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0].text).toContain("Urgent review");
    expect(findings[0].label).toBe("Red flag");
    // The id encodes the kind, so a merge that takes one finding's text and the
    // other's severity has to rebuild it.
    expect(findings[0].id).toBe("red_flag:chunk-a");
  });

  it("reaches a fixed point, so the server and client counts cannot disagree", () => {
    // One pass merges into the FIRST passage-key match, so a finding containing
    // two already-kept ones lands on the first and leaves the second nested
    // inside it. This function runs server-side into the payload and again on
    // the client; a pass short of a fixed point would render "2" then "1".
    const at = (id: string, text: string): SafetyFinding => ({
      id,
      kind: "monitoring",
      label: "Monitoring",
      text,
      citation: {
        chunk_id: id,
        document_id: "doc-a",
        title: "Protocol",
        file_name: "p.pdf",
        page_number: 1,
        chunk_index: 0,
        similarity: 0.8,
      },
      href: "/documents/doc-a?page=1",
    });

    const first = "Monitor full blood count and absolute neutrophil count every week for the first eighteen weeks.";
    const second =
      "Review metabolic parameters at baseline, three months, and then annually thereafter for this patient.";
    const both = `${second} ${first}`;

    const once = collapseDuplicateSafetyFindings([at("a", first), at("b", second), at("c", both)]);
    expect(once).toHaveLength(1);
    // Idempotent: collapsing the output again changes nothing.
    expect(collapseDuplicateSafetyFindings(once)).toEqual(once);
  });

  it("does not merge two short findings that merely share words", () => {
    const short = (id: string, page: number, text: string): SafetyFinding => ({
      id,
      kind: "monitoring",
      label: "Monitoring",
      text,
      citation: {
        chunk_id: id,
        document_id: "doc-a",
        title: "Protocol",
        file_name: "p.pdf",
        page_number: page,
        chunk_index: 0,
        similarity: 0.8,
      },
      href: `/documents/doc-a?page=${page}`,
    });

    // Same page, one text a substring of the other, but far too short to be
    // treated as the same passage.
    const findings = collapseDuplicateSafetyFindings([
      short("a", 1, "Monitor FBC."),
      short("b", 1, "Monitor FBC. Repeat weekly."),
    ]);

    expect(findings).toHaveLength(2);
  });

  it("collapses safely when citations are missing or undefined", () => {
    const finding1 = {
      id: "monitoring:chunk-1",
      kind: "monitoring" as const,
      label: "Monitoring",
      text: "Monitor ANC weekly.",
      href: "",
      citation: undefined as unknown as never,
    };
    const finding2 = {
      id: "red_flag:chunk-2",
      kind: "red_flag" as const,
      label: "Red flag",
      text: "Monitor ANC weekly. Urgent review if fever develops.",
      href: "",
      citation: null as unknown as never,
    };

    // Should not throw TypeError when computing passageKey
    const findings = collapseDuplicateSafetyFindings([finding1, finding2]);

    // They shouldn't match on sameChunk or passageKey, so they won't be merged
    // unless cross-chunk logic applies, but their passage keys differ (undefined:? vs null:?)
    // But importantly, it shouldn't crash.
    expect(findings).toBeDefined();
  });
});

describe("clinical point tones", () => {
  function finding(id: string, kind: SafetyFindingKind, label: string): SafetyFinding {
    return {
      id,
      kind,
      label,
      text: `${label} text`,
      citation: {
        chunk_id: `chunk-${id}`,
        document_id: "doc-a",
        title: "Protocol",
        file_name: "p.pdf",
        page_number: 1,
        chunk_index: 0,
        similarity: 0.8,
      },
      href: "/documents/doc-a?page=1",
    };
  }

  it("reserves the danger tone for the two kinds that stop a prescription", () => {
    expect(safetyFindingTone("contraindication")).toBe("stop");
    expect(safetyFindingTone("red_flag")).toBe("stop");
    expect(safetyFindingTone("escalation")).toBe("act");
    expect(safetyFindingTone("dose_limit")).toBe("act");
  });

  it("keeps routine practice guidance out of the warning tones", () => {
    // The point of the third tier. TOKENS.md reserves the clinical status
    // colours for sanctioned urgency, and an answer where routine monitoring is
    // painted amber is one where the amber has stopped meaning anything.
    expect(safetyFindingTone("monitoring")).toBe("know");
    expect(safetyFindingTone("exclusion")).toBe("know");
    expect(safetyFindingTone("caveat")).toBe("know");
  });

  it("collapses repeated kinds into one counted pill, in severity order", () => {
    const groups = groupSafetyFindingsByKind([
      finding("a", "monitoring", "Monitoring"),
      finding("b", "contraindication", "Contraindication"),
      finding("c", "monitoring", "Monitoring"),
      finding("d", "dose_limit", "Dose limit"),
    ]);

    expect(groups.map((group) => group.kind)).toEqual(["contraindication", "dose_limit", "monitoring"]);
    expect(groups.map((group) => group.count)).toEqual([1, 1, 2]);
    expect(groups.map((group) => group.tone)).toEqual(["stop", "act", "know"]);
  });

  it("returns nothing to render when an answer carries no findings", () => {
    // The rail is hidden entirely rather than rendering an empty heading.
    expect(groupSafetyFindingsByKind([])).toEqual([]);
  });
});

/**
 * CHARACTERISATION, NOT APPROVAL.
 *
 * `extractSafetyFindings` labels a passage by `safetyPatterns.find` -- the FIRST entry in a flat
 * array whose regex matches, in array order, which is severity order. So the label is decided by
 * array position and by tokens broad enough to appear in ordinary clinical prose.
 *
 * The 2026-09-17 external audit reported this (finding C4) and was right about the mechanism,
 * though wrong about numeric truncation, which `truncateAtSafeBoundary` has handled since L111.
 *
 * These cases pin what the extractor does TODAY, including the cases where it is wrong. They are
 * written this way on purpose, for two reasons:
 *
 *   1. Changing which passages carry a safety label changes which chip, and which tone, a
 *      clinician sees beside a passage in the Key points rail. That is a clinical display decision
 *      for the owner, not a defect to fix in passing. (This point once cited a priority function
 *      that promoted the most severe finding into a headline support card; that card left the
 *      answer surface on 2026-08-31 and the function was deleted on 2026-09-25, #51975R.)
 *   2. The gap is otherwise invisible. Nothing in the suite demonstrated that "review the chart in
 *      six weeks" is labelled Monitoring, or that "cease clozapine immediately" is labelled Red
 *      flag by the word `immediate` rather than by `cease`, which no pattern knows at all.
 *
 * When the owner decides the vocabulary, these expectations should change and the reasoning above
 * should move with them. A green run here is not evidence the labels are clinically right. It is
 * evidence that they are STABLE -- that nobody has moved a label without meaning to. Those are
 * different claims, and only the second one a test can make.
 *
 * Three such decisions have been taken so far, and all are recorded in the cases below rather than
 * in a changelog: #GHC4XZ (stop instructions, `immediate(?:ly)?`), #9XRDF7 (`escalat` and
 * `monitor`, owner-approved 2026-09-19) and #GHC4XZ again (`urgent(?:ly)?`, `seizures?` and
 * `transfer(?:s|red|ring)?`, signed off by Josh on 2026-09-25, with the drug-passage exclusion
 * narrowed by owner decision 16 the same day). Each moved labels a clinician
 * sees, which is why each needed the owner and not a reviewer.
 */
describe("safety finding precision (characterisation)", () => {
  /**
   * Deliberately no `relevance` on the input. When it is present the extractor first applies a
   * source-backing / query-overlap gate, and a candidate dropped there never reaches a pattern at
   * all -- so a fixture carrying relevance would make every case below return undefined and the
   * false-negative case pass vacuously. Omitting it isolates the pattern matching, which is the
   * only thing these cases are about.
   */
  function labelFor(content: string): string | undefined {
    const findings = extractSafetyFindings({
      ...answer,
      sources: [{ ...answer.sources![0]!, content }],
    } as never);
    return findings[0]?.label;
  }

  it("reaches the patterns at all", () => {
    // The guard for the trap this helper just fell into: if the fixture stops reaching the
    // extractor, every expectation below becomes vacuous and the suite looks healthier than it is.
    expect(labelFor("Do not use in severe hepatic impairment.")).toBe("Contraindication");
  });

  it.each([
    ["Review the chart again in six weeks.", "Monitoring", "`review` is an ordinary clinical verb"],
    ["Consider whether the patient would prefer a depot.", "Caveat", "`consider` appears in most advice"],
    ["Avoid delay in transferring the patient.", "Contraindication", "`avoid` outranks everything"],
    ["Discuss the level of support available at home.", "Monitoring", "`level` means a blood level here"],
  ])("labels %o as %s today (%s)", (content, label) => {
    // Each of these is a FALSE POSITIVE: the passage carries no safety instruction, and the first
    // matching token decides the label. The `avoid` case is the sharpest -- it lands on
    // Contraindication, the top severity, the `stop` tone and the danger colour.
    expect(labelFor(content)).toBe(label);
  });

  it("labels an instruction to stop a drug, on the stop instruction itself (#GHC4XZ)", () => {
    // THIS WAS THE FALSE NEGATIVE, and it was the more dangerous direction: no pattern knew
    // `cease`, `withhold`, `hold the dose`, `boxed warning`, `black box`, `hypersensitivity` or
    // `anaphylaxis`, so a passage whose entire content was a stop instruction produced nothing at
    // all. Owner-approved on 2026-09-18; all seven now match.
    //
    // They sit in `red_flag`, not `contraindication`, because a stop instruction is event-driven
    // ("stop now, because X has happened") while a contraindication is a standing property of the
    // patient ("do not use in severe hepatic impairment"). Both kinds carry the `stop` tone, so the
    // reader gets the danger colour either way -- and keeping them one tier down means no passage
    // that reads "Contraindication" today changes label. The single exception is
    // `known hypersensitivity` / `hypersensitivity to`, which name a patient property and so belong
    // at the top tier; bare `hypersensitivity` stays here, where an adverse-effect sentence belongs.
    expect(labelFor("Cease clozapine and withhold further doses if the neutrophil count falls.")).toBe("Red flag");
    expect(labelFor("Boxed warning: fatal agranulocytosis has been reported.")).toBe("Red flag");
    expect(labelFor("Stop the infusion if anaphylaxis occurs.")).toBe("Red flag");
    expect(labelFor("Patients with known hypersensitivity should not receive this drug.")).toBe("Contraindication");
  });

  it("labels a stop instruction on the verb, not on an incidental urgency word (#GHC4XZ)", () => {
    // This case used to pass for the wrong reason: the label came from `immediate`, not from
    // `cease`, so the same instruction without an urgency word produced nothing at all. Both forms
    // now reach Red flag through `cease` itself, which is why the bare form is asserted beside it --
    // drop `cease` from the pattern and the second line goes red while the first stays green.
    expect(labelFor("Cease clozapine, with immediate effect, if the neutrophil count falls.")).toBe("Red flag");
    expect(labelFor("Cease clozapine if the neutrophil count falls.")).toBe("Red flag");
  });

  it("matches both the adjective and the adverb form of its red-flag token (#GHC4XZ)", () => {
    // Not the first-match-wins mechanism -- a plain regex defect. Every red-flag token is wrapped
    // in \b...\b, so `\bimmediate\b` matched "with immediate effect" and did NOT match
    // "immediately", the far commoner clinical phrasing. That was a silent no-finding, not a wrong
    // label. Fixed by `immediate(?:ly)?`; the pair is pinned here because the pair IS the defect,
    // and the probes below carry no other safety token, so only the adverb fix can satisfy them.
    //
    // The escalation and monitoring entries carried the SAME defect, and both were fixed the same
    // way on 2026-09-19 (#9XRDF7, owner-approved). An earlier note on this line recorded the
    // escalation half and said it had been deliberately left alone pending an owner decision; that
    // decision has now been made, so the note is replaced rather than deleted -- the reasoning is
    // what made it worth recording:
    //
    //   `escalat` was never a prefix match. `\b(escalat|...)\b` demands a word boundary straight
    //   after those seven letters, so the entry matched neither "escalate" nor "escalation" and
    //   fired only via "senior review" / "specialist review" / "urgent review" / "higher level" /
    //   "transfer". `\bmonitor\b` matched the imperative ("Monitor the full blood count") and
    //   missed "monitoring", "monitored" and "monitors". Both were SILENT MISSES -- no chip at all
    //   on a passage whose whole content is the instruction -- which is the dangerous direction.
    //
    // It needed an owner decision rather than a passing edit because widening an entry that sits
    // mid-array moves labels the clinician already sees: `safetyPatterns.find` returns the first
    // match in severity order, so a widened entry claims passages from every tier BELOW it, not
    // only passages that had no finding. Those movements are measured and pinned below.
    expect(labelFor("Seek help immediately.")).toBe("Red flag");
    expect(labelFor("Discontinue with immediate effect.")).toBe("Red flag");
  });

  it("takes the first matching pattern in severity order, not the most relevant one", () => {
    // A passage that is plainly about monitoring is labelled Contraindication because `avoid`
    // appears earlier in the array. This is the mechanism behind every case above.
    expect(labelFor("Monitor the full blood count weekly and avoid missing a sample.")).toBe("Contraindication");
  });

  it("labels a bare stop instruction with no other safety word in it (#GHC4XZ)", () => {
    // The core of the fix. Neither sentence contains a single token the array knew before -- no
    // urgency word, no monitoring word, no dose word -- so each one returned nothing at all and the
    // clinician was shown no chip for a passage whose entire content is "stop the drug".
    //
    // `ceasing` and `ceased` are included deliberately: "cease" is the Australian register (US
    // texts say "discontinue"), and the past participle carries real instructions, e.g. "if
    // clozapine is ceased for more than 48 hours, restart titration".
    expect(labelFor("Cease clozapine and arrange haematology follow-up.")).toBe("Red flag");
    expect(labelFor("Ceasing lithium abruptly increases relapse risk.")).toBe("Red flag");
  });

  it("matches `hold` only as a dose instruction, never as ordinary prose (#GHC4XZ)", () => {
    // The reason the pattern spells out `hold <qualifier> dose(s)` instead of a bare \bhold\b:
    // "hold the view that", "hold a discussion", "hold off" are ordinary English, and a bare token
    // would paint them with the danger tone. The negative case is the guard -- it is what stops a
    // later "simplification" of this alternation.
    expect(labelFor("Hold the next dose and arrange a haematology opinion.")).toBe("Red flag");
    expect(labelFor("Hold the view that a depot would suit this patient better.")).toBeUndefined();
  });

  it("matches every inflection of escalate and escalation, not just the review phrases (#9XRDF7)", () => {
    // THE DEFECT. `\b(escalat|...)\b` demanded a word boundary straight after "escalat", so the
    // entry matched neither of the two words it was named for. Every probe below carries no other
    // safety token, so only the inflection fix can satisfy it -- revert the pattern and all six go
    // red. Measured before the fix: all six returned no finding at all.
    expect(labelFor("Escalate to the consultant.")).toBe("Escalation");
    expect(labelFor("Escalation to the on-call registrar is required.")).toBe("Escalation");
    expect(labelFor("Escalated care overnight after the fall.")).toBe("Escalation");
    expect(labelFor("Escalating agitation on the ward.")).toBe("Escalation");
    expect(labelFor("Escalates rapidly in the elderly.")).toBe("Escalation");
    expect(labelFor("Escalations of this kind are documented in the ward policy.")).toBe("Escalation");
  });

  it("matches every inflection of monitor (#9XRDF7)", () => {
    // Same defect, one tier down. The imperative matched and the gerund did not, which is backwards
    // -- guideline prose says "monitoring should continue", not "monitor". Case was never the
    // issue: the pattern carries `/i`. The trailing `\b` was.
    expect(labelFor("Monitoring should continue for eighteen weeks.")).toBe("Monitoring");
    expect(labelFor("Monitored weekly for the first eighteen weeks.")).toBe("Monitoring");
    expect(labelFor("Monitoring of mood and sleep is documented each shift.")).toBe("Monitoring");
    expect(labelFor("Monitor the full blood count weekly.")).toBe("Monitoring");
  });

  it("keeps the escalation entry off `escalator`, which is why it is not `escalat\\w*` (#9XRDF7)", () => {
    // The guard on the narrower spelling. `escalat\w*` would have been one character shorter and
    // would paint hospital-estate prose with the `act` tone; "the patient fell on the escalator" is
    // a fall note, not an instruction to escalate care. This negative case is what stops a later
    // "simplification" back to a bare stem.
    expect(labelFor("The patient fell on the escalator.")).toBeUndefined();
    expect(labelFor("Two escalators were out of service in the outpatient building.")).toBeUndefined();
  });

  it("widening a mid-array entry takes passages from every tier below it (#9XRDF7)", () => {
    // NOT a purely additive change, and the assumption that it was is the thing this case exists to
    // refute. `safetyPatterns.find` returns the FIRST match in severity order, so a widened entry
    // claims passages that already carried a LOWER-severity label, not only passages that carried
    // none. Every line below is a measured before -> after movement:
    //
    //   Dose limit -> Escalation   "Escalate to 600 mg/day if tolerated."
    //   Monitoring -> Escalation   "Escalate and repeat the blood test."
    //   Exclusion  -> Escalation   "Escalate unless the patient declines."
    //   Caveat     -> Escalation   "Consider escalation if symptoms persist."
    //   Exclusion  -> Monitoring   "Monitoring of the exclusion criteria is not applicable."
    //   Caveat     -> Monitoring   "Consider closer monitoring in the elderly."
    //
    // The four that land on Escalation also change TONE, from `know` (no status colour) to `act`
    // (amber). The two that land on Monitoring stay `know`. Tone is what the clinician sees before
    // reading a word, so the four are the ones worth arguing about.
    expect(labelFor("Escalate to 600 mg/day if tolerated.")).toBe("Escalation");
    expect(labelFor("Escalate and repeat the blood test.")).toBe("Escalation");
    expect(labelFor("Escalate unless the patient declines.")).toBe("Escalation");
    expect(labelFor("Consider escalation if symptoms persist.")).toBe("Escalation");
    expect(labelFor("Monitoring of the exclusion criteria is not applicable.")).toBe("Monitoring");
    expect(labelFor("Consider closer monitoring in the elderly.")).toBe("Monitoring");
  });

  it("leaves a passage that already reached a higher tier exactly where it was (#9XRDF7)", () => {
    // The other half of the measurement, and the half that keeps the blast radius honest: nothing
    // above the widened entry moves. These four all contain "escalate" or "monitoring" and none of
    // them changed label, because a more severe entry matched first.
    expect(labelFor("Escalate immediately if the patient deteriorates.")).toBe("Red flag");
    expect(labelFor("Monitoring is required if severe symptoms appear.")).toBe("Red flag");
    expect(labelFor("Cardiac monitoring in the emergency department.")).toBe("Red flag");
    expect(labelFor("Monitoring at the maximum dose is essential.")).toBe("Dose limit");
  });

  it("over-calls equipment prose as Monitoring, the accepted cost of the monitor fix (#9XRDF7)", () => {
    // NOT a passing behaviour -- a known false positive, pinned so it is deliberate rather than
    // discovered later, exactly as the `ceased` case below is. A blood-pressure monitor is a
    // device; calibrating one is an estate task, not patient monitoring. It is accepted because
    // `monitor(?:s|ed|ing)?` is what makes "monitoring should continue for eighteen weeks" produce
    // a chip at all, and because Monitoring carries the `know` tone -- no status colour, the
    // cheapest label in the array to be wrong about.
    expect(labelFor("Blood pressure monitors must be calibrated annually.")).toBe("Monitoring");
  });

  it("matches `urgently`, `seizures` and the inflected `transfer` forms (#GHC4XZ, owner sign-off 2026-09-25)", () => {
    // This expectation was pinned as an explicitly-labelled unfixed gap (#9XRDF7): `\burgent\b`
    // missed "urgently" and `\btransfer\b` missed "transferring", so both passages below produced
    // no chip at all. Widening a red-flag token moves passages onto the danger colour, which was
    // held for the owner. Josh (psychiatrist, product owner) signed that decision off on 2026-09-25:
    // red_flag gains `urgent(?:ly)?` and `seizures?`, escalation gains `transfer(?:s|red|ring)?`,
    // and nothing else. `review`, `exclude`, `consider` and `caution` keep their inflection gap
    // because that decision did not cover them.
    expect(labelFor("Urgently reassess the patient.")).toBe("Red flag");
    expect(labelFor("Transferring the patient to the medical ward.")).toBe("Escalation");
    expect(labelFor("Recurrent seizures were reported after the dose increase.")).toBe("Red flag");
    expect(labelFor("The patient was transferred to the high dependency unit.")).toBe("Escalation");
    expect(labelFor("The team transfers care to the medical ward.")).toBe("Escalation");
    // The bare forms already matched and must still.
    expect(labelFor("Urgent reassessment is needed.")).toBe("Red flag");
    expect(labelFor("A seizure occurred overnight.")).toBe("Red flag");
    expect(labelFor("Arrange transfer to the medical ward.")).toBe("Escalation");
  });

  it("moves passages up from lower tiers, the measured cost of the #GHC4XZ widening", () => {
    // Widening is not purely additive: `safetyPatterns.find` takes the FIRST match in severity
    // order, so the widened entries also claim passages that read as a lower tier before. Every
    // movement measured against the pre-widening patterns, pinned so none is discovered later.
    //
    //   Escalation -> Red flag     "Urgently escalate to the consultant."
    //   Dose limit -> Red flag     "Seizures occurred above 600 mg/day."
    //   Monitoring -> Red flag     "Monitor for seizures."
    //   Exclusion  -> Red flag     "Exclude patients with seizures."
    //   Caveat     -> Red flag     "Consider an EEG if seizures recur."
    //   Dose limit -> Escalation   "Transferred after exceeding 600 mg/day."
    //   Monitoring -> Escalation   "Transferred for renal monitoring."
    //   Exclusion  -> Escalation   "Transferred unless the patient declines."
    //   Caveat     -> Escalation   "Consider transferring to a specialist unit."
    //
    // All nine move to a MORE severe tier and a stronger tone, which is the direction the owner
    // approved (a passage about seizures or urgency should not read as a caveat).
    expect(labelFor("Urgently escalate to the consultant.")).toBe("Red flag");
    expect(labelFor("Seizures occurred above 600 mg/day.")).toBe("Red flag");
    expect(labelFor("Monitor for seizures.")).toBe("Red flag");
    expect(labelFor("Exclude patients with seizures.")).toBe("Red flag");
    expect(labelFor("Consider an EEG if seizures recur.")).toBe("Red flag");
    expect(labelFor("Transferred after exceeding 600 mg/day.")).toBe("Escalation");
    expect(labelFor("Transferred for renal monitoring.")).toBe("Escalation");
    expect(labelFor("Transferred unless the patient declines.")).toBe("Escalation");
    expect(labelFor("Consider transferring to a specialist unit.")).toBe("Escalation");
    // Nothing above the widened entries moves.
    expect(labelFor("Do not use in patients with seizures.")).toBe("Contraindication");
    expect(labelFor("Avoid if seizures occur.")).toBe("Contraindication");
  });

  it("does not read transferrin or transference as a transfer (#GHC4XZ)", () => {
    // `transfer(?:s|red|ring)?` is an explicit suffix group, not `transfer\w*`, precisely so these
    // two stay unlabelled: an iron-studies result and a psychotherapy term carry no instruction to
    // move the patient, and would otherwise arrive painted with the amber `act` tone.
    expect(labelFor("Serum transferrin saturation was within the reference range.")).toBeUndefined();
    expect(labelFor("Transferrin saturation was low.")).toBeUndefined();
    expect(labelFor("Transference is common in long-term psychotherapy.")).toBeUndefined();
    expect(labelFor("Countertransference shaped the therapeutic alliance.")).toBeUndefined();
    // Nor the enzyme or the adjective (#GHC4XZ, owner decision 16 restated the list).
    expect(labelFor("Glutathione S-transferase activity was reduced.")).toBeUndefined();
    expect(labelFor("The prescription is transferable to another pharmacy.")).toBeUndefined();
    // Nor is the widened red-flag entry a prefix match on longer words.
    expect(labelFor("Seizureless intervals lengthened over the year.")).toBeUndefined();
    expect(labelFor("The urgentness of the tone was noted.")).toBeUndefined();
  });

  it("does not read a drug passing into milk, across the placenta or into the fetus, brain or CSF as a transfer (#GHC4XZ, owner decisions 9 and 16, 2026-09-25)", () => {
    // Josh (psychiatrist, product owner) decided on 2026-09-25 (decision 9) that a drug moving
    // between body compartments is pharmacokinetics, not an instruction to move the patient, and
    // must not arrive painted with the amber `act` tone. Decision 9 first excluded every `transfer`
    // followed by "into" or "across"; decision 16 (same day) narrowed that to the DRUG-PASSAGE
    // phrases only: into (the) (breast) milk, across the placenta / (trans)placental transfer,
    // into / to / across the fetus or foetus, across the blood-brain barrier, and into the CSF.
    // Every other "transfer into" or "transfer across" is a patient transfer and keeps Escalation.
    // Before the widening, the first two passages below carried no chip at all (bare
    // `\btransfer\b` missed "transfers" and "transferred") and they keep that.
    expect(labelFor("Sertraline transfers into breast milk.")).toBeUndefined();
    expect(labelFor("Lithium is transferred across the placenta.")).toBeUndefined();
    expect(labelFor("Placental transfer across the membrane is rapid.")).toBeUndefined();
    expect(labelFor("Drug transferring into breast milk was minimal.")).toBeUndefined();
    expect(labelFor("Lamotrigine transfers into the milk in small amounts.")).toBeUndefined();
    expect(labelFor("Transplacental transfer of valproate is well documented.")).toBeUndefined();
    expect(labelFor("Lithium transfers to the fetus.")).toBeUndefined();
    expect(labelFor("The drug is transferred into the foetus.")).toBeUndefined();
    expect(labelFor("Valproate transfers across the fetus's circulation.")).toBeUndefined();
    expect(labelFor("Clozapine transfers across the blood-brain barrier.")).toBeUndefined();
    expect(labelFor("Little of the drug is transferred into the CSF.")).toBeUndefined();
    // A patient transfer is still an escalation, whatever preposition follows it (decision 16),
    // and urgency still outranks it.
    expect(labelFor("Transfer into ICU was arranged.")).toBe("Escalation");
    expect(labelFor("The patient was transferred into the care of the inpatient team.")).toBe("Escalation");
    expect(labelFor("Transferring the patient across to the medical ward.")).toBe("Escalation");
    expect(labelFor("Transferred across to the medical ward.")).toBe("Escalation");
    expect(labelFor("Transferred urgently into ICU.")).toBe("Red flag");
    expect(labelFor("Transferring the patient to ICU.")).toBe("Escalation");
    expect(labelFor("Transferred to the medical ward urgently.")).toBe("Red flag");
    expect(labelFor("Transferred to the medical ward.")).toBe("Escalation");
    // The exclusion is whole-word: "intolerance" is not "into".
    expect(labelFor("Transferred given intolerance of the ward.")).toBe("Escalation");
  });

  it("also excludes `transfer of <drug> across the placenta`, `via` and human milk, and keeps patient transfers (#GHC4XZ, owner decision 16, 2026-09-25)", () => {
    // A clinical reviewer's battery found three drug-passage phrasings the first cut of decision 16
    // still painted Escalation: a named drug between "transfer of" and the preposition, the
    // preposition "via", and "human milk". Each is pharmacokinetics, not a patient move.
    expect(labelFor("Transfer of lithium across the placenta is complete.")).toBeUndefined();
    expect(labelFor("Transfer of lithium carbonate across the placenta is complete.")).toBeUndefined();
    expect(labelFor("Transfer of the drug into breast milk is low.")).toBeUndefined();
    expect(labelFor("Transfer of sertraline into human milk is low.")).toBeUndefined();
    expect(labelFor("Transfer of valproate to the fetus is expected.")).toBeUndefined();
    expect(labelFor("Transfer of lithium into the foetus is expected.")).toBeUndefined();
    expect(labelFor("Transfer of clozapine across the blood-brain barrier is rapid.")).toBeUndefined();
    expect(labelFor("Transfer of the drug into the CSF is limited.")).toBeUndefined();
    expect(labelFor("The drug is transferred into human milk.")).toBeUndefined();
    expect(labelFor("Valproate is transferred via the placenta.")).toBeUndefined();
    expect(labelFor("Sertraline transfers via breast milk to the infant.")).toBeUndefined();
    // Patient transfers keep Escalation, including "transfer of" followed by a patient or care.
    expect(labelFor("Transfer into ICU.")).toBe("Escalation");
    expect(labelFor("The patient was transferred to the medical ward.")).toBe("Escalation");
    expect(labelFor("Transfer the patient into the care of the on-call team.")).toBe("Escalation");
    expect(labelFor("Transfer from oral to depot risperidone.")).toBe("Escalation");
    expect(labelFor("Transfer of care to the community team.")).toBe("Escalation");
    expect(labelFor("Arrange transfer of the patient to ED.")).toBe("Escalation");
    // Urgency still outranks it.
    expect(labelFor("Patients who deteriorate should be transferred urgently.")).toBe("Red flag");
    expect(labelFor("Transfer to the ED immediately.")).toBe("Red flag");
    // The suffix group still refuses the longer words.
    expect(labelFor("Check serum iron, transferrin and ferritin.")).toBeUndefined();
    expect(labelFor("Transference and countertransference should be explored in supervision.")).toBeUndefined();
  });

  it("keeps Escalation for a patient transfer to a service named after a drug-passage object (#GHC4XZ, owner decision 16)", () => {
    // Re-review 2026-09-25: "to the placenta / CSF" also reads as the start of a named destination.
    // A patient transfer must never lose its chip, so a service word after the object keeps it.
    expect(labelFor("Transfer to the placenta accreta spectrum service.")).toBe("Escalation");
    expect(labelFor("Transfer to Placenta Accreta Service.")).toBe("Escalation");
    expect(labelFor("Transfer of women to placenta accreta centres.")).toBe("Escalation");
    expect(labelFor("Transfer to the CSF shunt clinic.")).toBe("Escalation");
    expect(labelFor("Transfer to the placenta praevia unit.")).toBe("Escalation");
    // One-word "breastmilk" and "maternal milk" are drug passage too (common in Australian guidance).
    expect(labelFor("Transfer into the breastmilk is minimal.")).toBeUndefined();
    expect(labelFor("Transfer into maternal milk is low.")).toBeUndefined();
    // An adverb between the verb and the preposition is still drug passage (Claude review on #3031).
    expect(labelFor("Lithium transfers readily across the placenta and into breast milk.")).toBeUndefined();
    expect(labelFor("Sertraline is transferred minimally into breast milk.")).toBeUndefined();
    expect(labelFor("Valproate transfers freely to the fetus.")).toBeUndefined();
    // ...but an adverb does not turn a patient transfer into drug passage.
    expect(labelFor("Transfer promptly to the medical ward.")).toBe("Escalation");
    expect(labelFor("Transferred safely to the placenta accreta service.")).toBe("Escalation");
    // The plain drug-passage forms are unchanged.
    expect(labelFor("Transfer of lithium across the placenta is complete.")).toBeUndefined();
    expect(labelFor("Little of the drug is transferred into the CSF.")).toBeUndefined();
  });

  it("keeps the transfer exclusion linear-time on hostile input (#GHC4XZ)", () => {
    // The `transfer of <1-3 words>` lookahead is bounded and its word and space classes are
    // disjoint, so no input can make it backtrack super-linearly. Pin that with inputs shaped
    // to hurt it: one enormous word after "transfer of", and a long run of near-miss phrases.
    // This calls the pattern list directly: `extractSafetyFindings` cuts a passage to 260
    // characters before any pattern runs, so it could never hand a pattern hostile input.
    const hostile = [
      `transfer of ${"a".repeat(200_000)}`,
      "transfer of a b c d ".repeat(10_000),
      `transfer${" ".repeat(200_000)}x`,
      "transferred of the the the into ".repeat(6_000),
    ];
    for (const content of hostile) {
      const started = performance.now();
      __safetyPatternLabelForTests(content);
      expect(performance.now() - started).toBeLessThan(500);
    }
  });

  it("over-calls an intransitive `ceased`, which is the accepted cost of the fix (#GHC4XZ)", () => {
    // NOT a passing behaviour -- a known false positive, pinned so it is deliberate rather than
    // discovered later. "The tremor ceased overnight." is an observation, not an instruction, and
    // it now carries the top-severity stop tone.
    //
    // It is accepted because the alternative is reinstating the silent miss on the commonest stop
    // phrasing in the corpus, and because this failure is LOUD: the clinician sees a chip and can
    // read past it in a second. The failure it replaces was a passage reading "cease clozapine"
    // with no chip at all. If the vocabulary is ever narrowed, this is the case to revisit first.
    expect(labelFor("The tremor ceased overnight.")).toBe("Red flag");
  });
});
