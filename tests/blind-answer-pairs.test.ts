import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  buildBlindArtifacts,
  buildUnblindedReport,
  deriveAssignment,
  parseAnswerDump,
  parseBlindArgs,
  parseVerdictSheet,
  resolveLocalArtifactPath,
  sha256Hex,
  type AssignmentKey,
} from "../scripts/blind-answer-pairs";

// Trap markers: none of these may ever reach the blinded reading pack or verdict sheet.
const TRAP_TIMESTAMP = "2026-08-21T00:00:00.000Z";
const TRAP_MODEL = "gpt-test-terra";
const TRAP_ROUTING = "high_confidence_extractive_retrieval; generation_fallback:provider_probe";
const BEFORE_LABEL = "v18-4ea310e48";
const AFTER_LABEL = "v19-a341832af";

type FixtureCase = {
  id: string;
  question: string;
  answer: string;
  answer_sections?: Array<{ heading: string; body: string }>;
  sources?: Array<{ title: string; filename: string; page: number | null }>;
  cited_sources?: Array<{ title: string; filename: string; page: number | null }>;
  citation_count?: number;
  grounded?: boolean;
  answer_quality_tier?: string | null;
  degraded_mode?: { active: boolean; reason: string | null } | null;
  fallback_reason?: string | null;
  generation_quality_gate_reasons?: string[];
};

// New-style record: carries every gate key (null-valued when inapplicable) plus cited_sources.
// The retrieved-source list deliberately contains an uncited trap document that must never
// reach the reading pack.
function makeDumpJson(cases: FixtureCase[], marker: string): string {
  return JSON.stringify(
    {
      generated_at: TRAP_TIMESTAMP,
      case_count: cases.length,
      capture_only_count: 0,
      dump_marker: marker,
      cases: cases.map((entry) => ({
        route: "fast",
        routing_reason: TRAP_ROUTING,
        model: TRAP_MODEL,
        openai_usage: { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 200 },
        estimated_cost_usd: 0.0123,
        grounded: true,
        confidence: "medium",
        capture_only: false,
        answer_quality_tier: null,
        degraded_mode: null,
        fallback_reason: null,
        generation_quality_gate_reasons: [],
        citation_count: 1,
        cited_sources: [{ title: "Prescribing guideline", filename: "guideline.pdf", page: 12 }],
        sources: [
          { title: "Prescribing guideline", filename: "guideline.pdf", page: 12 },
          { title: "Uncited retrieval hit", filename: "uncited-retrieval.pdf", page: 3 },
        ],
        ...entry,
      })),
    },
    null,
    2,
  );
}

// Legacy-style record: predates cited_sources and the four gate-outcome keys entirely.
function makeLegacyDumpJson(cases: FixtureCase[], marker: string): string {
  return JSON.stringify(
    {
      generated_at: TRAP_TIMESTAMP,
      case_count: cases.length,
      dump_marker: marker,
      cases: cases.map((entry) => ({
        route: "fast",
        routing_reason: TRAP_ROUTING,
        model: TRAP_MODEL,
        grounded: true,
        confidence: "medium",
        citation_count: 1,
        sources: [{ title: "Prescribing guideline", filename: "guideline.pdf", page: 12 }],
        ...entry,
      })),
    },
    null,
    2,
  );
}

const PAIR_IDS = Array.from({ length: 12 }, (_, index) => `quality-case-${String(index + 1).padStart(2, "0")}`);

function fixtureCases(side: "one" | "two"): FixtureCase[] {
  const cases: FixtureCase[] = PAIR_IDS.map((id) => ({
    id,
    question: `Question for ${id}?`,
    answer:
      side === "one"
        ? `Side-one answer for ${id}: check levels at baseline and repeat before review.`
        : `Side-two answer for ${id}: check levels at baseline, after dose changes, then quarterly.`,
    answer_sections: [{ heading: "Monitoring", body: `Side-${side} monitoring detail for ${id}.` }],
  }));
  if (side === "two") {
    cases[2] = {
      ...cases[2],
      answer_quality_tier: "source_only",
      degraded_mode: { active: true, reason: "provider_probe" },
      fallback_reason: "provider_probe",
      generation_quality_gate_reasons: ["unsupported_claims"],
    };
  }
  return cases;
}

const beforeDump = makeDumpJson(
  [...fixtureCases("one"), { id: "before-only-case", question: "Only in before?", answer: "Before-only answer." }],
  "DUMP-MARKER-ONE",
);
const afterDump = makeDumpJson(
  [...fixtureCases("two"), { id: "after-only-case", question: "Only in after?", answer: "After-only answer." }],
  "DUMP-MARKER-TWO",
);

const buildInput = {
  beforeText: beforeDump,
  afterText: afterDump,
  beforeLabel: BEFORE_LABEL,
  afterLabel: AFTER_LABEL,
};

describe("blind-answer-pairs argument parsing and paths", () => {
  it("is import-safe and never touches src/ or provider env", () => {
    const source = readFileSync(new URL("../scripts/blind-answer-pairs.ts", import.meta.url), "utf8");
    expect(source).toMatch(/isDirectEntrypoint|import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href/);
    // Every import must be a node: builtin — no src/, no sibling scripts, no @next/env, so the
    // script can never pull provider env or clients.
    expect(source).not.toMatch(/from "(?!node:)/);
  });

  it("parses build and unblind modes strictly", () => {
    expect(
      parseBlindArgs([
        "build",
        "--before",
        "output/a.json",
        "--after",
        "output/b.json",
        "--before-label",
        "x",
        "--after-label",
        "y",
        "--out-dir",
        "output/blind",
      ]),
    ).toEqual({
      mode: "build",
      before: "output/a.json",
      after: "output/b.json",
      beforeLabel: "x",
      afterLabel: "y",
      outDir: "output/blind",
    });
    expect(
      parseBlindArgs(["unblind", "--key", "output/k.json", "--verdicts", "output/v.md", "--out", "output/r.md"]),
    ).toEqual({ mode: "unblind", key: "output/k.json", verdicts: "output/v.md", out: "output/r.md" });
    expect(() => parseBlindArgs(["build", "--before", "a"])).toThrow("missing required --after");
    expect(() => parseBlindArgs(["build", "--before"])).toThrow("Missing value for --before");
    expect(() => parseBlindArgs(["build", "stray"])).toThrow("Unexpected argument: stray");
    expect(() => parseBlindArgs(["unblind", "--key", "k", "--verdicts", "v", "--out", "o", "--mystery", "m"])).toThrow(
      "unknown option --mystery",
    );
    expect(() => parseBlindArgs(["publish"])).toThrow("Usage: blind-answer-pairs.ts");
    expect(() => parseBlindArgs([])).toThrow("Usage: blind-answer-pairs.ts");
  });

  it("restricts artefact writes to repo-local ignored roots", () => {
    expect(resolveLocalArtifactPath("output/gate-e/blind/reading-pack.md")).toContain("output");
    expect(resolveLocalArtifactPath(".local/gate-e/key.json")).toContain(".local");
    expect(() => resolveLocalArtifactPath("docs/reading-pack.md")).toThrow("under .local/ or output/");
    expect(() => resolveLocalArtifactPath(".local/../../docs/reading-pack.md")).toThrow("under .local/ or output/");
  });
});

describe("blind build determinism", () => {
  it("produces byte-identical artefacts for identical inputs, LF-only", () => {
    const first = buildBlindArtifacts(buildInput);
    const second = buildBlindArtifacts(buildInput);
    expect(second.readingPack).toBe(first.readingPack);
    expect(second.verdictSheet).toBe(first.verdictSheet);
    expect(second.assignmentKeyJson).toBe(first.assignmentKeyJson);
    expect(first.readingPack).not.toContain("\r");
    expect(first.verdictSheet).not.toContain("\r");
    expect(first.assignmentKeyJson).not.toContain("\r");
  });

  it("reports unpaired ids without blocking the paired set", () => {
    const artifacts = buildBlindArtifacts(buildInput);
    expect(artifacts.pairedIds).toEqual(PAIR_IDS);
    expect(artifacts.unpairedBeforeIds).toEqual(["before-only-case"]);
    expect(artifacts.unpairedAfterIds).toEqual(["after-only-case"]);
    expect(artifacts.readingPack).not.toContain("before-only-case");
    expect(artifacts.readingPack).not.toContain("after-only-case");
  });
});

describe("blinding is real", () => {
  const artifacts = buildBlindArtifacts(buildInput);
  const key = JSON.parse(artifacts.assignmentKeyJson) as AssignmentKey;

  it("keeps every identifying marker out of the reader-facing artefacts", () => {
    for (const text of [artifacts.readingPack, artifacts.verdictSheet]) {
      expect(text).not.toContain(BEFORE_LABEL);
      expect(text).not.toContain(AFTER_LABEL);
      expect(text).not.toContain(TRAP_MODEL);
      expect(text).not.toContain(TRAP_TIMESTAMP);
      expect(text).not.toContain(TRAP_ROUTING);
      expect(text).not.toContain("DUMP-MARKER-ONE");
      expect(text).not.toContain("DUMP-MARKER-TWO");
      expect(text).not.toContain("0.0123");
      expect(text).not.toContain("input_tokens");
      expect(text).not.toContain(sha256Hex(beforeDump));
      expect(text).not.toContain(sha256Hex(afterDump));
      expect(text).not.toContain("dump-v18");
      expect(text).not.toContain("dump-v19");
    }
  });

  it("assigns both sides to A across the pair set (not a constant assignment)", () => {
    const sides = new Set(key.pairs.map((pair) => pair.a_is));
    expect(sides).toEqual(new Set(["before", "after"]));
  });

  it("renders the gate outcome without naming versions", () => {
    const pairThree = artifacts.readingPack.split("## Pair ")[3];
    expect(pairThree).toContain("quality-case-03");
    expect(pairThree).toContain("tier=source_only");
    expect(pairThree).toContain("(provider_probe)");
    expect(pairThree).toContain("gate_reasons=[unsupported_claims]");
  });

  it("renders only the sources the answer actually cited, never the retrieval diagnostics", () => {
    expect(artifacts.readingPack).toContain("Prescribing guideline (guideline.pdf, p. 12)");
    expect(artifacts.readingPack).not.toContain("Uncited retrieval hit");
    expect(artifacts.readingPack).not.toContain("uncited-retrieval.pdf");
  });

  it("omits fields one side never recorded instead of rendering an asymmetric unknown", () => {
    // A legacy dump (no cited_sources, no gate-outcome keys) paired against a new-style dump
    // must not produce per-side "unknown" markers that identify the older capture.
    const legacy = makeLegacyDumpJson(
      [{ id: "quality-case-01", question: "Question for quality-case-01?", answer: "Legacy answer." }],
      "LEGACY-MARKER",
    );
    const modern = makeDumpJson(
      [
        {
          id: "quality-case-01",
          question: "Question for quality-case-01?",
          answer: "Modern answer.",
          answer_quality_tier: "model_synthesis",
          generation_quality_gate_reasons: ["unsupported_claims"],
        },
      ],
      "MODERN-MARKER",
    );
    const mixed = buildBlindArtifacts({
      beforeText: legacy,
      afterText: modern,
      beforeLabel: BEFORE_LABEL,
      afterLabel: AFTER_LABEL,
    });
    expect(mixed.readingPack).not.toContain("tier=");
    expect(mixed.readingPack).not.toContain("gate_reasons=");
    expect(mixed.readingPack).not.toContain("degraded=");
    expect(mixed.readingPack).not.toContain("(guideline.pdf");
    expect(mixed.readingPack).toContain("1 cited source(s); details not recorded in this capture");
    expect(mixed.readingPack).toContain("Gate outcome: grounded=true");
  });

  it("emits a byte-identical pack with a fully flipped key when the inputs are swapped", () => {
    // Identical pack bytes admitting two different valid keys is the proof that the
    // assignment is not a function of anything the reader can see.
    const swapped = buildBlindArtifacts({
      beforeText: afterDump,
      afterText: beforeDump,
      beforeLabel: AFTER_LABEL,
      afterLabel: BEFORE_LABEL,
    });
    expect(swapped.readingPack).toBe(artifacts.readingPack);
    expect(swapped.verdictSheet).toBe(artifacts.verdictSheet);
    const swappedKey = JSON.parse(swapped.assignmentKeyJson) as AssignmentKey;
    expect(swappedKey.pairs.length).toBe(key.pairs.length);
    for (const [index, pair] of key.pairs.entries()) {
      expect(swappedKey.pairs[index].id).toBe(pair.id);
      expect(swappedKey.pairs[index].a_is).not.toBe(pair.a_is);
    }
  });

  it("derives the assignment only from input content digests", () => {
    const { assignment, beforeSha256, afterSha256 } = deriveAssignment(beforeDump, afterDump, PAIR_IDS);
    expect(beforeSha256).toBe(sha256Hex(beforeDump));
    expect(afterSha256).toBe(sha256Hex(afterDump));
    for (const pair of key.pairs) {
      expect(assignment.get(pair.id)).toBe(pair.a_is);
    }
  });
});

describe("verdict round-trip", () => {
  const artifacts = buildBlindArtifacts(buildInput);
  const key = JSON.parse(artifacts.assignmentKeyJson) as AssignmentKey;

  function fillSheet(fills: Record<string, { verdict: string; notes?: string }>): string {
    return artifacts.verdictSheet
      .split("\n")
      .map((line) => {
        const match = /^(\S+): verdict= notes=$/.exec(line);
        if (!match) return line;
        const fill = fills[match[1]];
        if (!fill) return line;
        return `${match[1]}: verdict=${fill.verdict} notes=${fill.notes ?? ""}`;
      })
      .join("\n");
  }

  it("maps every verdict back to the correct label with exact tallies", () => {
    const fills: Record<string, { verdict: string; notes?: string }> = {};
    PAIR_IDS.forEach((id, index) => {
      fills[id] =
        index === 0
          ? { verdict: "tie" }
          : index === 1
            ? { verdict: "neither", notes: "both miss the schedule" }
            : index % 2 === 0
              ? { verdict: "A" }
              : { verdict: "B" };
    });
    const verdicts = parseVerdictSheet(fillSheet(fills));
    const report = buildUnblindedReport(key, verdicts);

    let beforeCount = 0;
    let afterCount = 0;
    for (const pair of key.pairs) {
      const fill = fills[pair.id];
      if (fill.verdict !== "A" && fill.verdict !== "B") continue;
      const resolved =
        fill.verdict === "A"
          ? pair.a_is === "before"
            ? BEFORE_LABEL
            : AFTER_LABEL
          : pair.a_is === "before"
            ? AFTER_LABEL
            : BEFORE_LABEL;
      if (resolved === BEFORE_LABEL) beforeCount += 1;
      else afterCount += 1;
      expect(report).toContain(`- ${pair.id}: ${fill.verdict} -> ${resolved}`);
    }
    expect(report).toContain(`- ${BEFORE_LABEL}: ${beforeCount}`);
    expect(report).toContain(`- ${AFTER_LABEL}: ${afterCount}`);
    expect(report).toContain("- tie: 1");
    expect(report).toContain("- neither: 1");
    expect(report).toContain("both miss the schedule");
    expect(report).toContain(`Total pairs: ${PAIR_IDS.length}`);
  });

  it("rejects incomplete, malformed, duplicate, and unknown verdicts", () => {
    expect(() => parseVerdictSheet(artifacts.verdictSheet)).toThrow("malformed or unfilled");
    expect(() => parseVerdictSheet("quality-case-01: verdict=maybe notes=")).toThrow("malformed or unfilled");
    expect(() => parseVerdictSheet("quality-case-01: verdict=A notes=\nquality-case-01: verdict=B notes=")).toThrow(
      "duplicate entries",
    );
    expect(() => parseVerdictSheet("\n\n")).toThrow("no verdict lines");

    const one = parseVerdictSheet("quality-case-01: verdict=A notes=");
    expect(() => buildUnblindedReport(key, one)).toThrow("missing verdicts for");
    const unknown = parseVerdictSheet("mystery-case: verdict=A notes=");
    expect(() => buildUnblindedReport(key, unknown)).toThrow("unknown pair id: mystery-case");
  });
});

describe("input validation", () => {
  it("rejects dumps that cannot support a blinded comparison", () => {
    expect(() => buildBlindArtifacts({ ...buildInput, afterText: beforeDump })).toThrow("byte-identical");
    expect(() =>
      buildBlindArtifacts({
        ...buildInput,
        beforeText: makeDumpJson([{ id: "only-x", question: "?", answer: "x" }], "M1"),
        afterText: makeDumpJson([{ id: "only-y", question: "?", answer: "y" }], "M2"),
      }),
    ).toThrow("nothing to pair");
    expect(() => buildBlindArtifacts({ ...buildInput, afterLabel: BEFORE_LABEL })).toThrow("must differ");
    expect(() => buildBlindArtifacts({ ...buildInput, beforeLabel: " " })).toThrow("must be non-empty");
  });

  it("rejects a paired id whose question text differs between the dumps", () => {
    const before = makeDumpJson([{ id: "quality-case-01", question: "Lithium monitoring?", answer: "A." }], "M-Q1");
    const after = makeDumpJson([{ id: "quality-case-01", question: "Clozapine monitoring?", answer: "B." }], "M-Q2");
    expect(() =>
      buildBlindArtifacts({ beforeText: before, afterText: after, beforeLabel: BEFORE_LABEL, afterLabel: AFTER_LABEL }),
    ).toThrow("different question text");
    // Whitespace/case-only differences are the same question.
    const afterSameQuestion = makeDumpJson(
      [{ id: "quality-case-01", question: "  lithium   MONITORING? ", answer: "B." }],
      "M-Q3",
    );
    expect(() =>
      buildBlindArtifacts({
        beforeText: before,
        afterText: afterSameQuestion,
        beforeLabel: BEFORE_LABEL,
        afterLabel: AFTER_LABEL,
      }),
    ).not.toThrow();
  });

  it("rejects malformed dumps with the offending side named", () => {
    expect(() => parseAnswerDump("not json", "--before")).toThrow("--before: dump is not valid JSON.");
    expect(() => parseAnswerDump(JSON.stringify({ cases: [] }), "--after")).toThrow('non-empty "cases" array');
    expect(() =>
      parseAnswerDump(
        JSON.stringify({
          cases: [
            { id: "dup", answer: "a" },
            { id: "dup", answer: "b" },
          ],
        }),
        "--before",
      ),
    ).toThrow("duplicate case id dup");
    expect(() => parseAnswerDump(JSON.stringify({ cases: [{ answer: "a" }] }), "--before")).toThrow("case 1 has no id");
  });

  it("refuses to build artefacts that would leak a label into the pack", () => {
    const leaky = makeDumpJson(
      [{ id: "quality-case-01", question: "Q?", answer: `This answer mentions ${BEFORE_LABEL} directly.` }],
      "M-LEAK",
    );
    const other = makeDumpJson([{ id: "quality-case-01", question: "Q?", answer: "Clean answer." }], "M-CLEAN");
    expect(() =>
      buildBlindArtifacts({ beforeText: leaky, afterText: other, beforeLabel: BEFORE_LABEL, afterLabel: AFTER_LABEL }),
    ).toThrow("blinding token");
  });
});
