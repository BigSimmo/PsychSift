// Gate E blinded before/after pairing (docs/rag-improvement/README.md §"Gates A–F"; ledger
// #E0N0QC). Takes two `eval-answer-quality --dump-answers` artefacts — a "before" and an
// "after" capture of the same question set — pairs cases by id, and emits three files:
//
//   reading-pack.md     the ONLY file the blinded reader opens: question + Answer A / Answer B
//                       (text, sections, citations, gate outcome), with no version labels,
//                       commit SHAs, models, timestamps, latencies, costs, or input paths.
//   verdict-sheet.md    one `<case-id>: verdict= notes=` line per pair for the reader to fill
//                       (verdict = A | B | tie | neither).
//   assignment-key.json the per-pair A→before|after mapping. The reader never opens this.
//
// `unblind` maps a filled verdict sheet back through the key into a labelled report.
//
// Pure offline file transformation: this script deliberately imports nothing from `src/` or
// other scripts (no `@/lib/*`, no `@next/env`), so it can never touch provider env or clients.
// The A/B assignment derives from the two input files' content digests, which appear only in
// the key file — the reading pack is byte-identical whichever way the inputs are labelled, so
// the assignment cannot be recovered from the pack alone (proven in
// tests/blind-answer-pairs.test.ts).
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

export const BLIND_TOOL_VERSION = "1";

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// Deliberate duplicate of resolveLocalDiagnosticOutputPath in scripts/eval-answer-quality.ts:
// that script must stay a single-file drop-in for the prompt-v18 capture worktree (Gate E owner
// procedure, docs/rag-improvement/HANDOVER.md) and this one must not import it, so the small
// guard is copied rather than shared.
export function resolveLocalArtifactPath(requestedPath: string, cwd = process.cwd()) {
  const candidate = requestedPath.trim();
  if (!candidate) throw new Error("Artefact output path must not be empty.");
  const resolvedPath = resolve(cwd, candidate);
  const allowedRoots = [resolve(cwd, ".local"), resolve(cwd, "output")];
  const allowed = allowedRoots.some((root) => {
    const fromRoot = relative(root, resolvedPath);
    return Boolean(fromRoot) && !fromRoot.startsWith("..") && !isAbsolute(fromRoot);
  });
  if (!allowed) throw new Error("Blind artefacts must be repo-local files under .local/ or output/.");
  return resolvedPath;
}

export type BlindGateOutcome = {
  grounded: boolean | null;
  tier: string | null;
  degraded: boolean;
  degraded_reason: string | null;
  fallback_reason: string | null;
  gate_reasons: string[];
  // Whether the dump record carried each key at all. An older capture script omits the newer
  // keys entirely; the pack must not render a field one side recorded and the other did not,
  // or the asymmetry becomes a systematic side marker (PR #2208 review).
  recorded: { tier: boolean; degraded: boolean; fallback: boolean; gate_reasons: boolean };
};

export type BlindNormalizedCase = {
  id: string;
  question: string;
  answer: string;
  sections: Array<{ heading: string; body: string }>;
  citation_count: number | null;
  // The sources the answer actually cites (dump field cited_sources); null when the capture
  // predates that field. The broader retrieved-source diagnostics are never rendered.
  cited_sources: Array<{ title: string; filename: string; page: number | null }> | null;
  gate: BlindGateOutcome;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parseAnswerDump(jsonText: string, label: string): BlindNormalizedCase[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(`${label}: dump is not valid JSON.`);
  }
  const cases = (parsed as { cases?: unknown } | null)?.cases;
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error(`${label}: dump must contain a non-empty "cases" array.`);
  }
  const seen = new Set<string>();
  return cases.map((entry, index) => {
    const record = (entry ?? {}) as Record<string, unknown>;
    const id = asString(record.id).trim();
    if (!id) throw new Error(`${label}: case ${index + 1} has no id.`);
    if (seen.has(id)) throw new Error(`${label}: duplicate case id ${id}.`);
    seen.add(id);
    const sections = Array.isArray(record.answer_sections) ? record.answer_sections : [];
    const citedSources = Array.isArray(record.cited_sources) ? record.cited_sources : null;
    const degraded = (record.degraded_mode ?? null) as { active?: unknown; reason?: unknown } | null;
    const gateReasons = Array.isArray(record.generation_quality_gate_reasons)
      ? record.generation_quality_gate_reasons
      : [];
    return {
      id,
      question: asString(record.question),
      answer: asString(record.answer),
      sections: sections.map((section) => {
        const raw = (section ?? {}) as Record<string, unknown>;
        return { heading: asString(raw.heading), body: asString(raw.body) };
      }),
      citation_count: typeof record.citation_count === "number" ? record.citation_count : null,
      cited_sources: citedSources
        ? citedSources.map((source) => {
            const raw = (source ?? {}) as Record<string, unknown>;
            return {
              title: asString(raw.title),
              filename: asString(raw.filename),
              page: typeof raw.page === "number" ? raw.page : null,
            };
          })
        : null,
      gate: {
        grounded: typeof record.grounded === "boolean" ? record.grounded : null,
        tier: asString(record.answer_quality_tier) || null,
        degraded: degraded ? Boolean(degraded.active) : false,
        degraded_reason: degraded ? asString(degraded.reason) || null : null,
        fallback_reason: asString(record.fallback_reason) || null,
        gate_reasons: gateReasons.filter((reason): reason is string => typeof reason === "string"),
        recorded: {
          tier: "answer_quality_tier" in record,
          degraded: "degraded_mode" in record,
          fallback: "fallback_reason" in record,
          gate_reasons: "generation_quality_gate_reasons" in record,
        },
      },
    };
  });
}

export function deriveAssignment(beforeText: string, afterText: string, caseIds: string[]) {
  const beforeSha256 = sha256Hex(beforeText);
  const afterSha256 = sha256Hex(afterText);
  if (beforeSha256 === afterSha256) {
    throw new Error("Before and after dumps are byte-identical — a blinded comparison is meaningless.");
  }
  // Swap-symmetric core: sorting the digests makes every derived value identical whichever
  // input is labelled "before", so the reading pack is byte-stable under relabelling and the
  // assignment is recoverable only with the key (which records the labels and digests).
  const core = sha256Hex([beforeSha256, afterSha256].sort().join("\0"));
  const lowSide: "before" | "after" = beforeSha256 < afterSha256 ? "before" : "after";
  const highSide: "before" | "after" = lowSide === "before" ? "after" : "before";
  const assignment = new Map<string, "before" | "after">();
  for (const caseId of caseIds) {
    const bit = parseInt(sha256Hex(`${core}\0${caseId}`).slice(0, 2), 16) & 1;
    assignment.set(caseId, bit === 0 ? lowSide : highSide);
  }
  return { assignment, beforeSha256, afterSha256 };
}

export type AssignmentKey = {
  tool: "blind-answer-pairs";
  tool_version: string;
  before_label: string;
  after_label: string;
  before_sha256: string;
  after_sha256: string;
  pair_count: number;
  unpaired_before_ids: string[];
  unpaired_after_ids: string[];
  pairs: Array<{ id: string; a_is: "before" | "after" }>;
};

function assertBlindSafe(artifactName: string, text: string, forbidden: string[]) {
  for (const token of forbidden) {
    if (token && text.includes(token)) {
      throw new Error(
        `${artifactName} would contain a blinding token ("${token.slice(0, 12)}…") — pick more distinctive labels.`,
      );
    }
  }
}

type PairRenderPlan = {
  citedSources: boolean;
  tier: boolean;
  degraded: boolean;
  fallback: boolean;
  gateReasons: boolean;
};

// A field appears in the pack only when BOTH sides of the pair recorded it. Rendering
// "unknown" on one side against a concrete value on the other would be a systematic side
// marker that defeats the blinding (PR #2208 review).
function pairRenderPlan(a: BlindNormalizedCase, b: BlindNormalizedCase): PairRenderPlan {
  return {
    citedSources: a.cited_sources !== null && b.cited_sources !== null,
    tier: a.gate.recorded.tier && b.gate.recorded.tier,
    degraded: a.gate.recorded.degraded && b.gate.recorded.degraded,
    fallback: a.gate.recorded.fallback && b.gate.recorded.fallback,
    gateReasons: a.gate.recorded.gate_reasons && b.gate.recorded.gate_reasons,
  };
}

function renderAnswerSide(letter: "A" | "B", side: BlindNormalizedCase, plan: PairRenderPlan): string[] {
  const lines: string[] = [`### Answer ${letter}`, ""];
  lines.push(side.answer.trim() ? side.answer.trim() : "_(no answer text)_");
  for (const section of side.sections) {
    lines.push("", `#### ${section.heading.trim() || "(untitled section)"}`, "", section.body.trim());
  }
  lines.push("", "Citations:");
  if (plan.citedSources) {
    const cited = side.cited_sources ?? [];
    if (cited.length === 0) lines.push("- (none)");
    for (const citation of cited) {
      const page = citation.page === null ? "" : `, p. ${citation.page}`;
      lines.push(`- ${citation.title || "(untitled)"} (${citation.filename || "unknown file"}${page})`);
    }
  } else {
    lines.push(
      `- ${side.citation_count ?? "an unknown number of"} cited source(s); details not recorded in this capture`,
    );
  }
  const gate = side.gate;
  const gateParts = [`grounded=${gate.grounded === null ? "unknown" : gate.grounded}`];
  if (plan.tier) gateParts.push(`tier=${gate.tier ?? "unspecified"}`);
  if (plan.degraded) {
    gateParts.push(`degraded=${gate.degraded}${gate.degraded_reason ? ` (${gate.degraded_reason})` : ""}`);
  }
  if (plan.fallback) gateParts.push(`fallback=${gate.fallback_reason ?? "none"}`);
  if (plan.gateReasons) gateParts.push(`gate_reasons=[${gate.gate_reasons.join(", ")}]`);
  lines.push("", `Gate outcome: ${gateParts.join(", ")}`);
  return lines;
}

export type BlindBuildInput = {
  beforeText: string;
  afterText: string;
  beforeLabel: string;
  afterLabel: string;
};

export function buildBlindArtifacts(input: BlindBuildInput) {
  const beforeLabel = input.beforeLabel.trim();
  const afterLabel = input.afterLabel.trim();
  if (!beforeLabel || !afterLabel) throw new Error("Both --before-label and --after-label must be non-empty.");
  if (beforeLabel === afterLabel) throw new Error("--before-label and --after-label must differ.");
  const beforeCases = parseAnswerDump(input.beforeText, "--before");
  const afterCases = parseAnswerDump(input.afterText, "--after");
  const beforeById = new Map(beforeCases.map((entry) => [entry.id, entry] as const));
  const afterById = new Map(afterCases.map((entry) => [entry.id, entry] as const));
  const pairedIds = [...beforeById.keys()].filter((id) => afterById.has(id)).sort();
  if (pairedIds.length === 0) throw new Error("No case ids are present in both dumps — nothing to pair.");
  const unpairedBeforeIds = [...beforeById.keys()].filter((id) => !afterById.has(id)).sort();
  const unpairedAfterIds = [...afterById.keys()].filter((id) => !beforeById.has(id)).sort();
  const { assignment, beforeSha256, afterSha256 } = deriveAssignment(input.beforeText, input.afterText, pairedIds);

  const packLines: string[] = [
    "# Gate E blinded reading pack",
    "",
    "For each pair below, read the question and both answers, then record a verdict in",
    "`verdict-sheet.md` (verdict = A | B | tie | neither). Do not open `assignment-key.json`",
    "until every verdict is recorded.",
    "",
  ];
  const sheetLines: string[] = [
    "# Gate E verdict sheet",
    "",
    "<!-- One line per pair. Fill verdict= with exactly one of: A | B | tie | neither. -->",
    "<!-- notes= is optional free text. Do not open assignment-key.json until done. -->",
    "",
  ];
  const normalizeQuestion = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  pairedIds.forEach((id, index) => {
    const before = beforeById.get(id)!;
    const after = afterById.get(id)!;
    if (normalizeQuestion(before.question) !== normalizeQuestion(after.question)) {
      throw new Error(`Paired case ${id} has different question text in the two dumps — the captures do not match.`);
    }
    const plan = pairRenderPlan(before, after);
    const aSide = assignment.get(id) === "before" ? before : after;
    const bSide = assignment.get(id) === "before" ? after : before;
    const pairNumber = String(index + 1).padStart(2, "0");
    packLines.push(`## Pair ${pairNumber} — ${id}`, "", `**Question:** ${aSide.question || bSide.question}`, "");
    packLines.push(...renderAnswerSide("A", aSide, plan), "");
    packLines.push(...renderAnswerSide("B", bSide, plan), "");
    packLines.push("### Verdict", "", `Record it in verdict-sheet.md under \`${id}\`.`, "");
    sheetLines.push(`${id}: verdict= notes=`);
  });
  const readingPack = `${packLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
  const verdictSheet = `${sheetLines.join("\n").trimEnd()}\n`;

  const key: AssignmentKey = {
    tool: "blind-answer-pairs",
    tool_version: BLIND_TOOL_VERSION,
    before_label: beforeLabel,
    after_label: afterLabel,
    before_sha256: beforeSha256,
    after_sha256: afterSha256,
    pair_count: pairedIds.length,
    unpaired_before_ids: unpairedBeforeIds,
    unpaired_after_ids: unpairedAfterIds,
    pairs: pairedIds.map((id) => ({ id, a_is: assignment.get(id)! })),
  };
  const assignmentKeyJson = `${JSON.stringify(key, null, 2)}\n`;

  for (const [name, text] of [
    ["reading-pack.md", readingPack],
    ["verdict-sheet.md", verdictSheet],
  ] as const) {
    assertBlindSafe(name, text, [beforeLabel, afterLabel, beforeSha256, afterSha256]);
  }
  return { readingPack, verdictSheet, assignmentKeyJson, pairedIds, unpairedBeforeIds, unpairedAfterIds };
}

export type BlindVerdict = { verdict: "A" | "B" | "tie" | "neither"; notes: string };

export function parseVerdictSheet(text: string): Map<string, BlindVerdict> {
  const verdicts = new Map<string, BlindVerdict>();
  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("<!--")) return;
    const match = /^(\S+):\s*verdict=(A|B|tie|neither)\s*(?:notes=(.*))?$/.exec(line);
    if (!match) throw new Error(`Verdict sheet line ${index + 1} is malformed or unfilled: "${line}"`);
    const [, id, verdict, notes] = match;
    if (verdicts.has(id)) throw new Error(`Verdict sheet has duplicate entries for ${id}.`);
    verdicts.set(id, { verdict: verdict as BlindVerdict["verdict"], notes: (notes ?? "").trim() });
  });
  if (verdicts.size === 0) throw new Error("Verdict sheet contains no verdict lines.");
  return verdicts;
}

export function buildUnblindedReport(key: AssignmentKey, verdicts: Map<string, BlindVerdict>): string {
  if (key.tool !== "blind-answer-pairs") throw new Error("Assignment key is not a blind-answer-pairs key.");
  const knownIds = new Set(key.pairs.map((pair) => pair.id));
  for (const id of verdicts.keys()) {
    if (!knownIds.has(id)) throw new Error(`Verdict sheet has an unknown pair id: ${id}`);
  }
  const missing = key.pairs.filter((pair) => !verdicts.has(pair.id)).map((pair) => pair.id);
  if (missing.length) throw new Error(`Verdict sheet is missing verdicts for: ${missing.join(", ")}`);

  const tallies = new Map<string, number>([
    [key.before_label, 0],
    [key.after_label, 0],
    ["tie", 0],
    ["neither", 0],
  ]);
  const lines: string[] = [
    "# Gate E unblinded report",
    "",
    `- before: ${key.before_label} (sha256 ${key.before_sha256})`,
    `- after: ${key.after_label} (sha256 ${key.after_sha256})`,
    `- pairs: ${key.pair_count}`,
    "",
    "## Per-pair verdicts",
    "",
  ];
  for (const pair of key.pairs) {
    const { verdict, notes } = verdicts.get(pair.id)!;
    const aLabel = pair.a_is === "before" ? key.before_label : key.after_label;
    const bLabel = pair.a_is === "before" ? key.after_label : key.before_label;
    const resolved = verdict === "A" ? aLabel : verdict === "B" ? bLabel : verdict;
    tallies.set(resolved, (tallies.get(resolved) ?? 0) + 1);
    lines.push(
      `- ${pair.id}: ${verdict} -> ${resolved} (A was ${aLabel}, B was ${bLabel})${notes ? ` — ${notes}` : ""}`,
    );
  }
  lines.push("", "## Tally", "");
  for (const [labelName, count] of tallies) lines.push(`- ${labelName}: ${count}`);
  lines.push("", `Total pairs: ${key.pair_count}`);
  return `${lines.join("\n")}\n`;
}

export type BlindArgs =
  | { mode: "build"; before: string; after: string; beforeLabel: string; afterLabel: string; outDir: string }
  | { mode: "unblind"; key: string; verdicts: string; out: string };

export function parseBlindArgs(argv: string[]): BlindArgs {
  const [mode, ...rest] = argv;
  const values = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
    if (values.has(token)) throw new Error(`Duplicate option: ${token}`);
    values.set(token, value);
    index += 1;
  }
  const take = (flag: string) => {
    const value = values.get(flag);
    if (!value) throw new Error(`${mode}: missing required ${flag}`);
    values.delete(flag);
    return value;
  };
  if (mode === "build") {
    const args = {
      mode: "build" as const,
      before: take("--before"),
      after: take("--after"),
      beforeLabel: take("--before-label"),
      afterLabel: take("--after-label"),
      outDir: take("--out-dir"),
    };
    if (values.size) throw new Error(`build: unknown option ${[...values.keys()].join(", ")}`);
    return args;
  }
  if (mode === "unblind") {
    const args = {
      mode: "unblind" as const,
      key: take("--key"),
      verdicts: take("--verdicts"),
      out: take("--out"),
    };
    if (values.size) throw new Error(`unblind: unknown option ${[...values.keys()].join(", ")}`);
    return args;
  }
  throw new Error(
    "Usage: blind-answer-pairs.ts <build|unblind> — build: --before <dump.json> --after <dump.json> " +
      "--before-label <s> --after-label <s> --out-dir <dir under output/ or .local/>; " +
      "unblind: --key <assignment-key.json> --verdicts <verdict-sheet.md> --out <report.md>",
  );
}

function main() {
  const args = parseBlindArgs(process.argv.slice(2));
  if (args.mode === "build") {
    const beforeText = readFileSync(resolve(args.before), "utf8");
    const afterText = readFileSync(resolve(args.after), "utf8");
    const artifacts = buildBlindArtifacts({
      beforeText,
      afterText,
      beforeLabel: args.beforeLabel,
      afterLabel: args.afterLabel,
    });
    const outputs = [
      ["reading-pack.md", artifacts.readingPack],
      ["verdict-sheet.md", artifacts.verdictSheet],
      ["assignment-key.json", artifacts.assignmentKeyJson],
    ] as const;
    for (const [name, text] of outputs) {
      const outPath = resolveLocalArtifactPath(join(args.outDir, name));
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, text);
    }
    console.log(`Blinded ${artifacts.pairedIds.length} pair(s) into ${args.outDir}.`);
    if (artifacts.unpairedBeforeIds.length) {
      console.log(`  unpaired (in --before only): ${artifacts.unpairedBeforeIds.join(", ")}`);
    }
    if (artifacts.unpairedAfterIds.length) {
      console.log(`  unpaired (in --after only): ${artifacts.unpairedAfterIds.join(", ")}`);
    }
    console.log("READER: open ONLY reading-pack.md and fill verdict-sheet.md — do NOT open assignment-key.json.");
    return;
  }
  const key = JSON.parse(readFileSync(resolve(args.key), "utf8")) as AssignmentKey;
  const verdicts = parseVerdictSheet(readFileSync(resolve(args.verdicts), "utf8"));
  const report = buildUnblindedReport(key, verdicts);
  const outPath = resolveLocalArtifactPath(args.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, report);
  console.log(report);
  console.log(`Unblinded report written: ${outPath}`);
}

if (isDirectEntrypoint(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
