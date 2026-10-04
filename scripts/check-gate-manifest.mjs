#!/usr/bin/env node
// Gate-manifest self-test (maturity L3).
//
// Invariant: every static gate in the local `verify:full:internal` chain must
// also run in CI. Without this, a gate added to the local chain can be silently
// missed in `.github/workflows/ci.yml`, so a regression it would catch merges
// green because no workflow runs it. This has already happened twice — the
// `static-pr` job comment records type/icon/brand being promoted after that
// exact miss, and sitemap/therapy-data-index/design-system-contract were a
// second instance. This check makes the drift a hard CI failure instead.
//
// Direction is one-way on purpose: CI may run MORE than the local chain (e.g.
// `format:check`, or heavier build/e2e gates in other jobs). It must never run
// LESS of the local static set.
//
// Reads `verify:full:internal`, NOT `verify:cheap:internal`. On 2026-09-17 the
// cheap chain was cut to lint + typecheck + test so day-to-day iteration stopped
// paying for 38 repo-hygiene gates, and the full static set moved to `verify:full`.
// Following the rename matters: pointed at the cheap chain this check would still
// pass — it would simply have stopped asking about the 38 gates that carry the
// actual CI-drift risk, which is precisely the silent weakening it exists to catch.
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const ci = readFileSync(".github/workflows/ci.yml", "utf8");

const localChain = pkg.scripts?.["verify:full:internal"] ?? "";
const localGates = [...localChain.matchAll(/npm run ([\w:.-]+)/g)].map((m) => m[1]);
if (localGates.length === 0) {
  console.error("gate-manifest: could not parse verify:full:internal from package.json.");
  process.exit(1);
}

// The `npm run <script>` invoked by a real YAML `run:` step, anchored to the
// field so a comment that merely mentions `run: npm run X` cannot masquerade as
// an executed gate (which would let the drift check pass after the real step was
// deleted). Trailing `# comment` on the step line is allowed. Steps in this repo
// are single-command, so a single capture is sufficient. Only two forwarded-argument shapes
// are accepted, each named here: the coverage merge flags, and ESLint's worker count
// (`npm run lint -- --concurrency=4`), which changes speed, never what is linted.
const npmRunScript = (line) =>
  line.match(
    /^\s*(?:-\s*)?run:\s+npm run ([\w:.-]+)(?:\s+--\s+(?:--merge-reports=[\w./-]+(?:\s+--reporter=default)?|--concurrency=\d+))?\s*(?:#.*)?$/,
  )?.[1];

// Extract the `run: npm run X` scripts inside a named top-level job (2-space key).
function jobScripts(name) {
  const lines = ci.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${name}:`);
  if (start === -1) return null;
  const scripts = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^  \S/.test(lines[i])) break; // reached the next top-level job
    const script = npmRunScript(lines[i]);
    if (script) scripts.push(script);
  }
  return scripts;
}

const staticPr = jobScripts("static-pr");
if (!staticPr) {
  console.error("gate-manifest: could not find the `static-pr` job in .github/workflows/ci.yml.");
  process.exit(1);
}

// Every `npm run X` anywhere in ci.yml — used to satisfy gates that run in CI
// under a different job/name than in the local chain.
const allCiScripts = new Set(ci.split(/\r?\n/).map(npmRunScript).filter(Boolean));

// A local gate whose CI counterpart has a different script name / job.
const CI_EQUIVALENT = new Map([
  // `npm run test` locally is the full vitest run; CI enforces it as coverage in
  // the dedicated `coverage` job, not in static-pr.
  ["test", "test:coverage"],
]);

// Local gates that deliberately do NOT run in CI. Empty today; kept as the
// explicit, reviewed escape hatch so any future exemption is a conscious edit.
const LOCAL_ONLY = new Set();

const failures = [];
for (const gate of localGates) {
  if (LOCAL_ONLY.has(gate)) continue;
  const equivalent = CI_EQUIVALENT.get(gate);
  if (equivalent) {
    if (!allCiScripts.has(equivalent)) {
      failures.push(`verify:full runs "${gate}" (CI counterpart "${equivalent}") but no CI job runs "${equivalent}".`);
    }
    continue;
  }
  if (!staticPr.includes(gate)) {
    failures.push(
      `verify:full runs "${gate}" but the static-pr CI job does not — add "- run: npm run ${gate}" to the static-pr job in .github/workflows/ci.yml, or record a mapping/exemption in scripts/check-gate-manifest.mjs.`,
    );
  }
}

// Prose that states a gate COUNT drifts silently, because nothing derives it. Both
// numbers below were wrong when found: CLAUDE.md said 24 static gates against an actual
// 25 (`check:assets` landed before the line was written), and the gates skill said "check
// 2 of 26" against an actual 28. A stale count is not cosmetic — an agent that believes
// the chain is 26 long cannot tell how much of it a mid-chain failure skipped. These
// assertions fail closed: if the anchor phrase disappears, the guard reports the lost
// anchor rather than passing on a document it no longer checks.
const HEAVY_GATES = new Set(["lint", "typecheck", "test"]);
const staticGateCount = localGates.filter((gate) => !HEAVY_GATES.has(gate)).length;

const documentedCounts = [
  {
    file: "CLAUDE.md",
    pattern: /(\d+) static\/consistency gates/,
    expected: staticGateCount,
    describes: "static/consistency gates in the verify:full chain (excludes lint/typecheck/test)",
  },
  {
    file: "README.md",
    pattern: /(\d+) static\/consistency gates/,
    expected: staticGateCount,
    describes: "static/consistency gates in the verify:full chain (excludes lint/typecheck/test)",
  },
  {
    file: ".claude/skills/gates/SKILL.md",
    pattern: /check \d+ of (\d+)/,
    expected: localGates.length,
    describes: "total gates in the verify:full chain (includes lint/typecheck/test)",
  },
];

for (const { file, pattern, expected, describes } of documentedCounts) {
  const text = readFileSync(file, "utf8");
  const match = text.match(pattern);
  if (!match) {
    failures.push(
      `${file} no longer matches ${pattern} — the gate-count guard lost its anchor. Restore the phrasing or update the pattern in scripts/check-gate-manifest.mjs.`,
    );
    continue;
  }
  if (Number(match[1]) !== expected) {
    failures.push(
      `${file} says ${match[1]} where the chain has ${expected} (${describes}). Update the document, or the chain, so they agree.`,
    );
  }
}

// High-traffic operating docs that still re-taught "verify:cheap = the static set" after
// the 2026-09-17 split. Count pins above catch bare numbers; these forbidden phrases catch
// membership lies. Historical audit/ledger/superpowers notes are intentionally outside this
// list — rewrite them only when they become living operating guidance again.
const COMPOSITION_GUARD_FILES = [
  "README.md",
  "CLAUDE.md",
  "docs/agents/verification-gates.md",
  "docs/agents/cursor-cloud.md",
  "docs/testing.md",
  "docs/process-hardening.md",
  "docs/scripts-index.md",
  "docs/wiring-conventions.md",
  ".claude/skills/gates/SKILL.md",
  ".claude/agents/verification-router.md",
  "docs/agents/test-deletion-guard.md",
  "docs/design-system/GATES.md",
  "docs/design-system.md",
];

// Named static hygiene gates agents most often mis-attribute to verify:cheap.
// Omit check:gate-manifest itself — operating docs often mention it beside cheap
// when explaining the pin, which is tip-true.
const STATIC_MEMBERSHIP_GATES = [
  "check:runtime",
  "sitemap:check",
  "check:knip",
  "brand:check",
  "check:type-scale",
  "check:icon-scale",
  "check:github-actions",
  "check:ci-scope",
  "check:outstanding-issues",
  "check:mha-act-sections",
  "check:assets",
  "check:pr-policy",
];

const STATIC_GATE_ALTERNATION = STATIC_MEMBERSHIP_GATES.map((gate) => gate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(
  "|",
);

const COMPOSITION_FORBIDDEN = [
  {
    id: "cheap-static-set",
    pattern: /verify:cheap\s+static\s+set/i,
    remediation: 'Do not call verify:cheap a "static set"; static hygiene lives in verify:full.',
  },
  {
    id: "gate-manifest-reads-cheap",
    pattern: /check-gate-manifest[\s\S]{0,160}verify:cheap:internal|reads?\s+[`']?verify:cheap:internal/i,
    remediation: "check-gate-manifest reads verify:full:internal, never verify:cheap:internal.",
  },
  {
    id: "router-cheap-membership",
    pattern: /verify:cheap`?\s*\(\s*runtime,\s*action-pin,\s*sitemap/i,
    remediation: "verify:cheap is lock parity + diff-integrity + lint + typecheck + test only.",
  },
  {
    id: "full-invokes-cheap",
    pattern:
      /verify:full[\s\S]{0,80}(?:invokes?|runs?|includes?|equals?)\s+(?:npm\s+run\s+)?`?verify:cheap(?![\s\S]{0,40}does not invoke)/i,
    remediation: "verify:full does not invoke the verify:cheap script; say so explicitly if both are mentioned.",
  },
];

const CHEAP_MEMBERSHIP_CLAIM = /(?:wired into|runs?\s+in|inside|part of)\s+(?:npm\s+run\s+)?`?verify:cheap\b/i;
const STATIC_GATE_MENTION = new RegExp(`\\b(?:${STATIC_GATE_ALTERNATION})\\b`, "i");
const CHEAP_NEGATION =
  /\b(?:not|never|no longer|does not|do not|don't|without|must not)\b[\s\S]{0,40}(?:npm\s+run\s+)?`?verify:cheap\b|\bdoes not invoke\b[\s\S]{0,40}`?verify:cheap\b/i;
const PRE_SPLIT_HISTORY =
  /pre-split[\s\S]{0,40}verify:cheap|verify:cheap[\s\S]{0,40}pre-split|had grown to \d+ chained commands/i;

/** Reviewed exceptions for dated historical sentences that remain inside operating docs. */
const COMPOSITION_ALLOWLIST = [
  {
    file: "docs/design-system/GATES.md",
    pattern: /previously lived in the pre-split\s+`verify:cheap` chain/,
    reason: "dated 2026-09-17 split history; current sentence names verify:full",
  },
  {
    file: "docs/process-hardening.md",
    pattern: /had grown to 41 chained commands[\s\S]{0,240}38 at the split/,
    reason: "dated split narrative; live count is pinned elsewhere via check:gate-manifest",
  },
];

function stripAllowlisted(file, text) {
  let next = text;
  for (const entry of COMPOSITION_ALLOWLIST) {
    if (entry.file !== file) continue;
    next = next.replace(entry.pattern, "");
  }
  return next;
}

function sentences(text) {
  return text
    .split(/(?:\r?\n|\.(?:\s|$))/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function claimsCheapHostsStaticGate(text) {
  for (const sentence of sentences(text)) {
    if (!CHEAP_MEMBERSHIP_CLAIM.test(sentence)) continue;
    if (!STATIC_GATE_MENTION.test(sentence)) continue;
    if (CHEAP_NEGATION.test(sentence) || PRE_SPLIT_HISTORY.test(sentence)) continue;
    return true;
  }
  // Table rows often omit verbs: "| `sitemap:check` | … | `verify:cheap`, CI |"
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes("|")) continue;
    if (!STATIC_GATE_MENTION.test(line) || !/\bverify:cheap\b/.test(line)) continue;
    if (CHEAP_NEGATION.test(line) || PRE_SPLIT_HISTORY.test(line)) continue;
    // Tip-true when the static gate's host cell already names verify:full.
    if (new RegExp(`(?:${STATIC_GATE_ALTERNATION})[\\s\\S]{0,120}\\bverify:full\\b`, "i").test(line)) continue;
    // Only treat a compact "Runs in" style row as a membership claim — long narrative
    // table cells that merely mention cheap (e.g. "must not be added to verify:cheap")
    // are covered by CHEAP_NEGATION above.
    const cells = line
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean);
    const hostCell = cells.find((cell) => /\bverify:cheap\b/.test(cell));
    if (!hostCell || hostCell.length > 80) continue;
    if (/\bverify:full\b/.test(hostCell)) continue;
    return true;
  }
  return false;
}

for (const file of COMPOSITION_GUARD_FILES) {
  const text = stripAllowlisted(file, readFileSync(file, "utf8"));
  for (const rule of COMPOSITION_FORBIDDEN) {
    if (rule.pattern.test(text)) {
      failures.push(`${file}: composition lie (${rule.id}) — ${rule.remediation}`);
    }
  }
  if (claimsCheapHostsStaticGate(text)) {
    failures.push(
      `${file}: composition lie (cheap-hosts-static-gate) — Static gates (runtime, sitemap, knip, brand, type/icon scale, …) belong to verify:full / CI, not verify:cheap.`,
    );
  }
}

if (failures.length > 0) {
  console.error(
    "Gate-manifest drift — a local verify:full gate is not enforced in CI, or operating docs mis-state gate composition:",
  );
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Gate-manifest OK: all ${localGates.length} verify:full gates are enforced in CI (static-pr + mapped jobs), ` +
    `the ${staticGateCount} static gates are documented consistently, ` +
    `and ${COMPOSITION_GUARD_FILES.length} operating docs pass the cheap≠static composition pin.`,
);
