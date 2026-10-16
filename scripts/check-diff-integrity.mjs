#!/usr/bin/env node
/**
 * check-diff-integrity — refuse a diff that silently destroys committed content.
 *
 * Written after `#Y30AXB`. On 2026-08-31, commit d1485d6e8 on PR #2481 carried the message
 * "test(ui): compare answer status surfaces" and changed exactly one file with 4 insertions
 * and 4,924 deletions: `tests/ui-smoke.spec.ts` fell from 6,001 lines / 89 test cases to
 * 1,081 lines / 9. The four "insertions" were not code at all — they were a file-reading
 * tool's own truncation banner written back to disk as file content, one of them carrying a
 * literal "N tokens truncated" marker inside what should have been TypeScript. A tool had
 * regenerated the whole file from a truncated read instead of editing a region of it.
 *
 * A gutted Playwright suite goes green trivially, squash auto-merge was armed on the PR, and
 * nothing in CI asserts a floor on the number of tests. The only thing that stopped the
 * deletion reaching `main` was an unrelated merge conflict — luck, not a gate.
 *
 * Two rules, both answering the same question: did a tool destroy committed content here?
 *
 *   1. TEST-CASE FLOOR — measured two ways, because either one alone misfires.
 *      AGGREGATE: the total number of test cases across every changed test file may not
 *      fall by more than `maxRemovedFraction`. This is the honest question — did the diff
 *      destroy coverage — and it stays quiet for the ordinary refactor that deletes one
 *      spec while adding its replacement, which a per-file rule flags every time (measured:
 *      3 such commits in the last 150 that touched `tests/`).
 *      PER FILE: a file that still exists afterwards may not lose more than
 *      `perFileMaxRemovedFraction` of its cases. This catches a single suite being gutted
 *      inside a large PR whose aggregate additions would otherwise absorb it — the
 *      #Y30AXB shape exactly. Deleted files are exempt here and answer to the aggregate.
 *      Either way, an exact reduction recorded in `diff-integrity.json` passes; an approval
 *      pins BOTH the before and after counts, so a reviewed reduction cannot silently
 *      cover a later, larger one.
 *
 *   2. TRUNCATION ARTEFACT — no added line in any changed file may carry a tool's
 *      truncation banner. This is the actual signature of the incident and, unlike rule 1,
 *      it also covers the case where the same tool failure lands in `src/` instead.
 *
 * Test cases are counted from the TypeScript AST, not by grepping for `test(`. A regex
 * counts `/pattern/.test(x)` as a test and — far worse — keeps counting a block of tests
 * after someone comments it out, which is exactly the evasion this gate must not have.
 *
 * Known limitation: a `test()` inside a `for (const viewport of …)` loop counts once, not once
 * per iteration, so shrinking that array loses real cases without moving the count. Inherent to
 * any static count; the aggregate and rule 2 are unaffected.
 *
 * The comparison base is the merge base with `origin/main` (or local `main` when the
 * remote-tracking ref is absent), never the previous commit, so
 * a branch that removes tests across several small commits is still measured against the
 * whole drop rather than sliding under the threshold one commit at a time.
 *
 * The gate fails CLOSED: an unresolvable base or an unreadable blob is a failure, never a
 * pass, because the failure mode being guarded is precisely a weak signal read as consent.
 *
 * Usage:
 *   node scripts/check-diff-integrity.mjs [--base <ref>]   # default: merge-base origin/main (local main if absent)
 *   node scripts/check-diff-integrity.mjs --json
 *   node scripts/check-diff-integrity.mjs --self-test
 *
 * Exit 0 = clean. Exit 1 = at least one violation, or the gate could not reach a verdict.
 * Exit 2 = CLI misuse.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = dirname(dirname(SCRIPT_PATH));
const CONFIG_PATH = resolve(REPOSITORY_ROOT, "diff-integrity.json");

const CLI_USAGE = "usage: node scripts/check-diff-integrity.mjs [--base <ref>] [--json] | --self-test";

/** Files that legitimately contain truncation-marker literals: this gate and its own proof. */
export const TRUNCATION_RULE_EXEMPT_PATHS = Object.freeze([
  "scripts/check-diff-integrity.mjs",
  "tests/diff-integrity.test.ts",
  "diff-integrity.json",
]);

const TEST_FILE_PATTERN = /\.(spec|test)\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const PYTHON_TEST_FILE_PATTERN = /(?:^|\/)(?:test_[^/]+\.py|[^/]+_test\.py)$/;

/**
 * `test`/`it` members that are not themselves a test case. `describe` opens a suite;
 * the rest are hooks, annotations, or sub-steps that would inflate the count.
 */
const NON_CASE_MEMBERS = new Set([
  "describe",
  "step",
  "use",
  "extend",
  "expect",
  "configure",
  "setTimeout",
  "slow",
  "info",
  "beforeEach",
  "afterEach",
  "beforeAll",
  "afterAll",
]);

const HOOK_OR_STEP_MEMBERS = new Set([
  "step",
  "use",
  "extend",
  "expect",
  "configure",
  "setTimeout",
  "slow",
  "info",
  "beforeEach",
  "afterEach",
  "beforeAll",
  "afterAll",
]);

const CASE_ROOTS = new Set(["test", "it"]);
const SKIP_ROOTS = new Set(["test", "it", "describe"]);
const SKIP_MEMBERS = new Set(["skip", "fixme"]);

/**
 * Members that return a function which is then called with the title: `test.each(table)(…)`,
 * `it.runIf(cond)(…)`, `test.for(table)(…)`. The declaration is counted at the INNER call —
 * the outer one has a call expression for a callee, which `calleeChain` deliberately refuses.
 * Missing these is not academic: `it.runIf(...)` is the only test in
 * `tests/guard-push-no-merge-base.test.ts`, and counting it as zero would let that whole file
 * be regenerated away with no signal at all.
 */
const CURRIED_MEMBERS = new Set(["each", "runIf", "skipIf", "for"]);

/**
 * Assembled from fragments so this file never contains a whole marker literal and so
 * cannot flag itself if the exemption list above is ever mis-edited.
 *
 * @returns {RegExp[]}
 */
export function truncationMarkers() {
  const tokens = "tokens";
  const truncated = "truncated";
  return [
    new RegExp(`${truncated}\\s+output\\s*\\(\\s*original\\s+${tokens}?\\s+count`, "i"),
    new RegExp(`[…]\\s*[\\d,]+\\s+${tokens}\\s+${truncated}\\s*[…]`, "i"),
    new RegExp(`\\.{3}\\s*[\\d,]+\\s+${tokens}\\s+${truncated}\\s*\\.{3}`, "i"),
    new RegExp("^Total output lines:\\s*\\d+\\s*$"),
    new RegExp("<response\\s+clipped>", "i"),
  ];
}

/** @typedef {(args: string[]) => string} GitRunner */

/** @type {GitRunner} */
const NODE_GIT = (args) =>
  execFileSync("git", args, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  }).trim();

const firstLine = (error) => (error instanceof Error ? error.message.split(/\r?\n/, 1)[0] : String(error));

/**
 * True when a changed path is a test file this gate counts cases in.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isTestFile(path) {
  return TEST_FILE_PATTERN.test(path) || PYTHON_TEST_FILE_PATTERN.test(path);
}

/**
 * Strip `#` comments and string literal contents (including triple-quoted docstrings)
 * from Python source while preserving line breaks and structural punctuation.
 *
 * @param {string} source
 * @returns {string}
 */
function scrubPythonSource(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    if (source[i] === "#") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (source.startsWith('"""', i) || source.startsWith("'''", i)) {
      const quote = source.slice(i, i + 3);
      out += '""';
      i += 3;
      while (i < source.length && !source.startsWith(quote, i)) {
        if (source[i] === "\\") {
          if (source[i + 1] === "\n") out += "\n";
          i += 2;
        } else {
          if (source[i] === "\n") out += "\n";
          i += 1;
        }
      }
      if (source.startsWith(quote, i)) i += 3;
      continue;
    }
    if (source[i] === '"' || source[i] === "'") {
      const quote = source[i];
      out += '""';
      i += 1;
      while (i < source.length && source[i] !== quote && source[i] !== "\n") {
        if (source[i] === "\\") i += 2;
        else i += 1;
      }
      if (source[i] === quote) i += 1;
      continue;
    }
    out += source[i];
    i += 1;
  }
  return out;
}

/**
 * Count top-level items in the second argument of `@pytest.mark.parametrize("...", [row1, row2, ...])`.
 *
 * @param {string} decorator
 * @returns {number}
 */
function countPythonParametrizeItems(decorator) {
  const match = /@(?:pytest\.mark\.)?parametrize\s*\(/.exec(decorator);
  if (!match) return 1;
  let index = match.index + match[0].length;
  let depth = 0;
  let commaIndex = -1;
  for (; index < decorator.length; index += 1) {
    const ch = decorator[index];
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) break;
      depth -= 1;
    } else if (ch === "," && depth === 0) {
      commaIndex = index;
      break;
    }
  }
  if (commaIndex === -1) return 1;
  let listStart = commaIndex + 1;
  while (listStart < decorator.length && /\s/.test(decorator[listStart])) listStart += 1;
  const openChar = decorator[listStart];
  if (openChar !== "[" && openChar !== "(") return 1;
  const closeChar = openChar === "[" ? "]" : ")";
  let listDepth = 0;
  let listEnd = -1;
  for (let i = listStart; i < decorator.length; i += 1) {
    const ch = decorator[i];
    if (ch === "(" || ch === "[" || ch === "{") listDepth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") {
      listDepth -= 1;
      if (listDepth === 0 && ch === closeChar) {
        listEnd = i;
        break;
      }
    }
  }
  if (listEnd === -1) return 1;
  const interior = decorator.slice(listStart + 1, listEnd);
  let itemDepth = 0;
  let current = "";
  const items = [];
  for (let i = 0; i < interior.length; i += 1) {
    const ch = interior[i];
    if (ch === "(" || ch === "[" || ch === "{") {
      itemDepth += 1;
      current += ch;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      itemDepth = Math.max(0, itemDepth - 1);
      current += ch;
    } else if (ch === "," && itemDepth === 0) {
      if (current.trim().length > 0) items.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim().length > 0) items.push(current.trim());
  return Math.max(1, items.length);
}

/**
 * Count brackets/parens delta on a scrubbed Python line.
 *
 * @param {string} text
 * @returns {number}
 */
function bracketDelta(text) {
  let delta = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "(" || ch === "[" || ch === "{") delta += 1;
    else if (ch === ")" || ch === "]" || ch === "}") delta -= 1;
  }
  return delta;
}

/**
 * Scan scrubbed Python source for `def test_...` declarations, `@pytest.mark.parametrize`
 * row counts, and `@pytest.mark.skip` decorators.
 *
 * @param {string} source
 * @returns {{ cases: number, skipped: number }}
 */
function scanPythonTests(source) {
  const scrubbed = scrubPythonSource(source);
  const lines = scrubbed.split(/\r?\n/);
  let cases = 0;
  let skipped = 0;
  let pendingMultiplier = 1;
  let pendingSkip = false;
  let skippedClassIndent = null;
  let currentDecorator = "";
  let decoratorDepth = 0;

  const finalizeDecorator = (decorator) => {
    if (/^\s*@(?:pytest\.mark\.)?parametrize\s*\(/.test(decorator)) {
      pendingMultiplier *= countPythonParametrizeItems(decorator);
    }
    if (/^\s*@(?:pytest\.mark\.|unittest\.)?skip\b/.test(decorator)) {
      pendingSkip = true;
    }
  };

  for (const line of lines) {
    if (decoratorDepth > 0) {
      currentDecorator += ` ${line}`;
      decoratorDepth += bracketDelta(line);
      if (decoratorDepth <= 0) {
        decoratorDepth = 0;
        finalizeDecorator(currentDecorator);
        currentDecorator = "";
      }
      continue;
    }
    if (/^\s*@/.test(line)) {
      currentDecorator = line;
      decoratorDepth = bracketDelta(line);
      if (decoratorDepth <= 0) {
        decoratorDepth = 0;
        finalizeDecorator(currentDecorator);
        currentDecorator = "";
      }
      continue;
    }
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (skippedClassIndent !== null && line.trim() !== "" && indent <= skippedClassIndent) {
      skippedClassIndent = null;
    }
    if (/^\s*(?:async\s+)?def\s+test_[A-Za-z0-9_]*\s*\(/.test(line)) {
      cases += pendingMultiplier;
      if (pendingSkip || (skippedClassIndent !== null && indent > skippedClassIndent)) {
        skipped += pendingMultiplier;
      }
      pendingMultiplier = 1;
      pendingSkip = false;
      continue;
    }
    if (/^\s*(?:async\s+)?def\s+/.test(line) || /^\s*class\s+/.test(line)) {
      if (pendingSkip) {
        if (/^\s*class\s+/.test(line)) skippedClassIndent = indent;
        else skipped += 1;
      }
      pendingMultiplier = 1;
      pendingSkip = false;
      continue;
    }
    if (line.trim() !== "") {
      if (pendingSkip) skipped += 1;
      pendingMultiplier = 1;
      pendingSkip = false;
    }
  }
  if (pendingSkip) skipped += 1;
  return { cases, skipped };
}

/**
 * The dotted callee chain of a call expression, or null when the callee is not a plain
 * identifier/property chain (for example `test.each([...])(...)`, whose callee is itself a
 * call — deliberately not counted a second time).
 *
 * @param {ts.Expression} expression
 * @returns {string[] | null}
 */
function calleeChain(expression) {
  /** @type {string[]} */
  const chain = [];
  let current = expression;
  while (ts.isPropertyAccessExpression(current)) {
    chain.unshift(current.name.text);
    current = current.expression;
  }
  if (!ts.isIdentifier(current)) return null;
  chain.unshift(current.text);
  return chain;
}

/**
 * True when the first argument names a case (a string or template literal). `test.skip()`
 * with no arguments is an in-body annotation, not a declaration, and must not be counted.
 *
 * @param {ts.NodeArray<ts.Expression>} args
 * @returns {boolean}
 */
function namesACase(args) {
  const first = args[0];
  if (!first) return false;
  return ts.isStringLiteralLike(first) || ts.isTemplateExpression(first) || ts.isNoSubstitutionTemplateLiteral(first);
}

/**
 * Weight a curried `each`/`for` call by its inline array literal length when non-empty,
 * or 1 otherwise.
 *
 * @param {string[]} members
 * @param {ts.NodeArray<ts.Expression>} args
 * @returns {number}
 */
function curriedCaseWeight(members, args) {
  const isParameterized = members.some((member) => member === "each" || member === "for");
  const firstArg = args[0];
  if (isParameterized && firstArg && ts.isArrayLiteralExpression(firstArg) && firstArg.elements.length > 0) {
    return firstArg.elements.length;
  }
  return 1;
}

/** @param {ts.CallExpression} node @returns {ts.ArrowFunction | ts.FunctionExpression | null} */
function skippedSuiteCallback(node) {
  const chain = calleeChain(node.expression);
  if (
    chain &&
    (chain[0] === "describe" || chain.includes("describe")) &&
    chain.slice(1).some((member) => member === "skip" || member === "fixme")
  ) {
    const callback = node.arguments[1];
    return callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) ? callback : null;
  }
  if (ts.isCallExpression(node.expression)) {
    const curriedChain = calleeChain(node.expression.expression);
    if (curriedChain && curriedChain.includes("describe") && curriedChain.includes("skipIf")) {
      const callback = node.arguments[1];
      return callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) ? callback : null;
    }
  }
  return null;
}

/**
 * Count declared test cases in a TypeScript/JavaScript or Python source string.
 *
 * Counted (TS/JS): `test("…")`, `it("…")`, `test.skip/only/fixme/fails("…")`, and each
 * `test.each(...)` / `it.each(...)` / `test.for(...)` declaration (weighted by element
 * count when passed a non-empty inline array literal, or 1 for a table identifier).
 * Counted (Python): `def test_...(` declarations (outside comments/docstrings), weighted
 * by `@pytest.mark.parametrize` inline list length when present.
 *
 * Not counted: `describe`, hooks, `test.step`, in-body annotations such as `test.skip()`,
 * and anything inside a comment or string.
 *
 * @param {string} source
 * @param {string} [fileName]
 * @returns {number}
 */
export function countTestCases(source, fileName = "spec.ts") {
  if (fileName.endsWith(".py")) {
    return scanPythonTests(source).cases;
  }
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let cases = 0;
  /** @param {ts.Node} node */
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const chain = calleeChain(node.expression);
      if (chain && CASE_ROOTS.has(chain[0]) && chain.length <= 3) {
        const members = chain.slice(1);
        const isSuiteOrHook = members.some((member) => NON_CASE_MEMBERS.has(member));
        const isCurried = members.some((member) => CURRIED_MEMBERS.has(member));
        if (!isSuiteOrHook && (isCurried || namesACase(node.arguments))) {
          cases += curriedCaseWeight(members, node.arguments);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return cases;
}

/**
 * Count skipped or fixme test/suite declarations (`.skip` / `.fixme` in TS/JS,
 * `@pytest.mark.skip` in Python).
 *
 * @param {string} source
 * @param {string} [fileName]
 * @returns {number}
 */
export function countSkippedCases(source, fileName = "spec.ts") {
  if (fileName.endsWith(".py")) {
    return scanPythonTests(source).skipped;
  }
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let skipped = 0;
  /** @param {ts.Node} node */
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const suiteCallback = skippedSuiteCallback(node);
      if (suiteCallback) {
        skipped += Math.max(1, countTestCases(suiteCallback.getText(sourceFile), fileName));
        return;
      }
      const chain = calleeChain(node.expression);
      if (chain && SKIP_ROOTS.has(chain[0]) && chain.length <= 3) {
        const members = chain.slice(1);
        const hasSkipOrFixme = members.some((member) => SKIP_MEMBERS.has(member));
        const isHookOrStep = members.some((member) => HOOK_OR_STEP_MEMBERS.has(member));
        const isCurried = members.some((member) => CURRIED_MEMBERS.has(member));
        if (hasSkipOrFixme && !isHookOrStep && (isCurried || namesACase(node.arguments))) {
          skipped += curriedCaseWeight(members, node.arguments);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return skipped;
}

/**
 * Count assertion calls in a TypeScript/JavaScript or Python source string.
 *
 * Counted (TS/JS): `expect(...)`, `expect.soft(...)`, `expect.poll(...)`.
 * Counted (Python): `assert ...`, `self.assert*(...)`, `pytest.raises(...)`.
 * Not counted: assertions in comments, strings, or property names.
 *
 * @param {string} source
 * @param {string} [fileName]
 * @returns {number}
 */
export function countAssertions(source, fileName = "spec.ts") {
  if (fileName.endsWith(".py")) {
    const scrubbed = scrubPythonSource(source);
    const assertStatements = scrubbed.match(/\bassert(?:\s+|\s*\()/g)?.length ?? 0;
    const unittestAsserts = scrubbed.match(/\bself\.assert[A-Za-z0-9_]*\s*\(/g)?.length ?? 0;
    const pytestRaises = scrubbed.match(/\bpytest\.raises\s*\(/g)?.length ?? 0;
    return assertStatements + unittestAsserts + pytestRaises;
  }
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let assertions = 0;
  /** @param {ts.Node} node */
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const chain = calleeChain(node.expression);
      if (chain && chain[0] === "expect" && chain.length <= 2) {
        assertions += 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return assertions;
}

/**
 * @typedef {object} DiffIntegrityConfig
 * @property {number} maxRemovedFraction
 * @property {number} minRemovedCases
 * @property {number} perFileMaxRemovedFraction
 * @property {number} perFileMinRemovedCases
 * @property {{ path: string, before: number, after: number, reason: string, approvedOn: string }[]} approvedReductions
 */

/**
 * @param {string} raw
 * @returns {DiffIntegrityConfig}
 */
export function parseConfig(raw) {
  const parsed = JSON.parse(raw);
  /** @type {Record<string, number>} */
  const numbers = {};
  for (const key of ["maxRemovedFraction", "perFileMaxRemovedFraction"]) {
    const value = Number(parsed[key]);
    if (!Number.isFinite(value) || value <= 0 || value >= 1) {
      throw new Error(`${key} must be strictly between 0 and 1: ${parsed[key]}`);
    }
    numbers[key] = value;
  }
  for (const key of ["minRemovedCases", "perFileMinRemovedCases"]) {
    const value = parsed[key];
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${key} must be a positive integer: ${value}`);
    }
    numbers[key] = value;
  }
  const approvals = parsed.approvedReductions;
  if (!Array.isArray(approvals)) throw new Error("approvedReductions must be an array");
  for (const approval of approvals) {
    if (
      typeof approval?.path !== "string" ||
      !Number.isInteger(approval?.before) ||
      !Number.isInteger(approval?.after) ||
      typeof approval?.reason !== "string" ||
      approval.reason.trim().length < 12
    ) {
      throw new Error(
        `each approvedReductions entry needs path, integer before/after, and a reason of at least 12 characters: ${JSON.stringify(approval)}`,
      );
    }
  }
  return { .../** @type {any} */ (numbers), approvedReductions: approvals };
}

/**
 * @param {DiffIntegrityConfig} config
 * @param {string} path
 * @param {number} before
 * @param {number} after
 * @returns {boolean}
 */
function isApproved(config, path, before, after) {
  return config.approvedReductions.some(
    (entry) => entry.path === path && entry.before === before && entry.after === after,
  );
}

const approvalHint = (path, before, after) =>
  `If the reduction is intended, add {"path":"${path}","before":${before},"after":${after},"reason":"…","approvedOn":"…"} to diff-integrity.json so a reviewer sees it.`;

/**
 * Decide one surviving test file against the per-file catastrophic ceiling. Pure, so the
 * thresholds are testable without git. A deleted file (`exists: false`) never fails here —
 * it is judged by the aggregate, so that deleting a spec while adding its replacement in
 * the same commit is not treated as lost coverage.
 *
 * @param {{ path: string, before: number, after: number, exists?: boolean, config: DiffIntegrityConfig, assertionsBefore?: number, assertionsAfter?: number, skippedBefore?: number, skippedAfter?: number }} input
 * @returns {{ path: string, before: number, after: number, removed: number, fraction: number, exists: boolean, ok: boolean, approved: boolean, message?: string }}
 */
export function assessTestFile({
  path,
  before,
  after,
  exists = true,
  config,
  assertionsBefore = 0,
  assertionsAfter = 0,
  skippedBefore = 0,
  skippedAfter = 0,
}) {
  const removed = before - after;
  const fraction = before === 0 ? 0 : removed / before;
  const assertions = {
    before: assertionsBefore,
    after: assertionsAfter,
    removed: assertionsBefore - assertionsAfter,
  };
  const skipped = {
    before: skippedBefore,
    after: skippedAfter,
    added: skippedAfter - skippedBefore,
  };
  const base = { path, before, after, removed, fraction, exists, assertions, skipped };
  if (!exists) return { ...base, ok: true, approved: false };
  if (removed >= config.perFileMinRemovedCases && fraction > config.perFileMaxRemovedFraction) {
    if (isApproved(config, path, before, after)) return { ...base, ok: true, approved: true };
    return {
      ...base,
      ok: false,
      approved: false,
      message:
        `lost ${removed} of ${before} test case(s) (${(fraction * 100).toFixed(1)}%), over the per-file ${(config.perFileMaxRemovedFraction * 100).toFixed(0)}% ceiling. ` +
        approvalHint(path, before, after),
    };
  }
  const activeBefore = Math.max(0, before - skippedBefore);
  const activeAfter = Math.max(0, after - skippedAfter);
  const activeRemoved = activeBefore - activeAfter;
  const activeFraction = activeBefore === 0 ? 0 : activeRemoved / activeBefore;
  if (
    skippedAfter > skippedBefore &&
    activeRemoved >= config.perFileMinRemovedCases &&
    activeFraction > config.perFileMaxRemovedFraction
  ) {
    if (isApproved(config, path, before, after) || isApproved(config, path, activeBefore, activeAfter)) {
      return { ...base, ok: true, approved: true };
    }
    return {
      ...base,
      ok: false,
      approved: false,
      message:
        `newly skipped/fixme cases reduced active test coverage by ${activeRemoved} of ${activeBefore} active test case(s) (${(activeFraction * 100).toFixed(1)}%, skipped ${skippedBefore} -> ${skippedAfter}), over the per-file ${(config.perFileMaxRemovedFraction * 100).toFixed(0)}% ceiling. ` +
        approvalHint(path, activeBefore, activeAfter),
    };
  }
  return { ...base, ok: true, approved: false };
}

/**
 * Decide the diff as a whole: did the changed test files, taken together, lose coverage?
 *
 * @param {{ verdicts: { path: string, before: number, after: number }[], config: DiffIntegrityConfig }} input
 * @returns {{ before: number, after: number, removed: number, fraction: number, ok: boolean, approved: boolean, message?: string }}
 */
export function assessAggregate({ verdicts, config }) {
  const before = verdicts.reduce((sum, verdict) => sum + verdict.before, 0);
  const after = verdicts.reduce((sum, verdict) => sum + verdict.after, 0);
  const removed = before - after;
  const fraction = before === 0 ? 0 : removed / before;
  const base = { before, after, removed, fraction };
  if (removed < config.minRemovedCases) return { ...base, ok: true, approved: false };
  if (fraction <= config.maxRemovedFraction) return { ...base, ok: true, approved: false };
  // An aggregate drop is excused only when every file that shrank is individually approved.
  const shrunk = verdicts.filter((verdict) => verdict.before > verdict.after);
  const allApproved =
    shrunk.length > 0 && shrunk.every((verdict) => isApproved(config, verdict.path, verdict.before, verdict.after));
  if (allApproved) return { ...base, ok: true, approved: true };
  return {
    ...base,
    ok: false,
    approved: false,
    message:
      `changed test files lost ${removed} of ${before} test case(s) (${(fraction * 100).toFixed(1)}%), over the ${(config.maxRemovedFraction * 100).toFixed(0)}% ceiling. ` +
      "Record each intended reduction in diff-integrity.json so a reviewer sees it.",
  };
}

/**
 * Added lines carrying a tool's truncation banner.
 *
 * @param {string} unifiedDiff
 * @returns {{ path: string, line: string }[]}
 */
export function truncationArtefacts(unifiedDiff) {
  const markers = truncationMarkers();
  /** @type {{ path: string, line: string }[]} */
  const found = [];
  let path = "";
  for (const raw of unifiedDiff.split(/\r?\n/)) {
    if (raw.startsWith("+++ b/")) {
      path = raw.slice("+++ b/".length);
      continue;
    }
    if (raw.startsWith("+++ ") || raw.startsWith("--- ")) continue;
    if (!raw.startsWith("+") || !path) continue;
    if (TRUNCATION_RULE_EXEMPT_PATHS.includes(path)) continue;
    const line = raw.slice(1);
    if (markers.some((marker) => marker.test(line))) {
      found.push({ path, line: line.length > 160 ? `${line.slice(0, 157)}…` : line });
    }
  }
  return found;
}

/**
 * Resolve the comparison base, failing closed rather than guessing.
 *
 * @param {{ requested?: string, env?: Record<string, string | undefined>, git?: GitRunner }} [options]
 * @returns {string}
 */
export function resolveBase({ requested = "", env = process.env, git = NODE_GIT } = {}) {
  const supplied = requested || env.DIFF_INTEGRITY_BASE_SHA || "";
  // A push event for a new branch reports an all-zero "before" SHA; that is "no base
  // supplied", not a base to resolve, so fall through to the merge base instead of failing.
  const explicit = /^0{40}$/.test(supplied) ? "" : supplied;
  if (explicit) {
    try {
      return git(["rev-parse", "--verify", "--end-of-options", `${explicit}^{commit}`]);
    } catch (error) {
      throw new Error(`cannot resolve --base ${explicit}: ${firstLine(error)}`);
    }
  }
  try {
    let comparisonRef = "refs/remotes/origin/main";
    try {
      git(["rev-parse", "--verify", "--end-of-options", `${comparisonRef}^{commit}`]);
    } catch {
      // Only a missing remote ref permits the local branch fallback. If the remote
      // exists but its ancestry is shallow/unrelated, merge-base must still fail closed.
      comparisonRef = "refs/heads/main";
      git(["rev-parse", "--verify", "--end-of-options", `${comparisonRef}^{commit}`]);
    }
    return git(["merge-base", "HEAD", comparisonRef]);
  } catch (error) {
    throw new Error(
      `cannot resolve a comparison base (${firstLine(error)}). Pass --base <commit>, set DIFF_INTEGRITY_BASE_SHA, ` +
        "or restore local main/fetch refs/remotes/origin/main — on a shallow clone run `git fetch --deepen=2000` first.",
    );
  }
}

/**
 * Changed paths between the base and the working tree, following renames.
 *
 * @param {string} base
 * @param {GitRunner} git
 * @returns {{ status: string, before: string | null, after: string | null }[]}
 */
export function changedPaths(base, git = NODE_GIT) {
  const raw = git(["diff", "--name-status", "--find-renames", "--no-color", "--no-ext-diff", "-z", base]);
  const fields = raw.split("\0").filter((field) => field !== "");
  /** @type {{ status: string, before: string | null, after: string | null }[]} */
  const changes = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (status.startsWith("R") || status.startsWith("C")) {
      const before = fields[index++];
      const after = fields[index++];
      changes.push({ status, before, after });
    } else if (status.startsWith("D")) {
      changes.push({ status, before: fields[index++], after: null });
    } else if (status.startsWith("A")) {
      changes.push({ status, before: null, after: fields[index++] });
    } else {
      const path = fields[index++];
      changes.push({ status, before: path, after: path });
    }
  }
  return changes;
}

/**
 * Untracked test files in the working tree. Invisible to `git diff`, but they are real
 * added coverage, so the aggregate must see them. Empty in CI, where nothing is untracked.
 *
 * @param {GitRunner} git
 * @returns {string[]}
 */
export function untrackedTestFiles(git = NODE_GIT) {
  let raw = "";
  try {
    raw = git(["ls-files", "--others", "--exclude-standard", "-z"]);
  } catch {
    return [];
  }
  return raw.split("\0").filter((path) => path !== "" && isTestFile(path));
}

/**
 * Run both rules against a resolved base.
 *
 * @param {{ base: string, git?: GitRunner, config: DiffIntegrityConfig, readWorkingFile?: (path: string) => string | null }} input
 */
export function evaluate({ base, git = NODE_GIT, config, readWorkingFile }) {
  const readAfter =
    readWorkingFile ??
    ((path) => {
      const absolute = resolve(REPOSITORY_ROOT, path);
      return existsSync(absolute) ? readFileSync(absolute, "utf8") : null;
    });

  const changes = changedPaths(base, git);
  /** @type {ReturnType<typeof assessTestFile>[]} */
  const verdicts = [];

  for (const change of changes) {
    const beforePath = change.before;
    const afterPath = change.after;
    const relevant = (beforePath && isTestFile(beforePath)) || (afterPath && isTestFile(afterPath));
    if (!relevant || !beforePath) continue;

    let beforeSource;
    try {
      beforeSource = git(["show", `${base}:${beforePath}`]);
    } catch (error) {
      // Fail closed: an unreadable base blob is the shallow-clone case the header warns about.
      verdicts.push({
        path: beforePath,
        before: Number.NaN,
        after: Number.NaN,
        removed: Number.NaN,
        fraction: Number.NaN,
        exists: true,
        ok: false,
        approved: false,
        message: `cannot read ${beforePath} at ${base.slice(0, 9)} (${firstLine(error)}) — refusing to pass without the before-state.`,
      });
      continue;
    }

    // A rename OUT of a test filename (tests/a.test.ts -> src/a.ts) leaves the bodies intact
    // but the runner no longer discovers any of them, so the after-state is zero however many
    // `test(...)` calls the destination still contains. Counting the destination would report
    // 20 -> 20 and pass on a diff that silently removed twenty cases from the suite.
    const afterIsTestFile = afterPath !== null && isTestFile(afterPath);
    const afterSource = afterIsTestFile ? readAfter(/** @type {string} */ (afterPath)) : null;
    const before = countTestCases(beforeSource, beforePath);
    const after = afterSource === null ? 0 : countTestCases(afterSource, afterPath ?? beforePath);
    const assertionsBefore = countAssertions(beforeSource, beforePath);
    const assertionsAfter = afterSource === null ? 0 : countAssertions(afterSource, afterPath ?? beforePath);
    const skippedBefore = countSkippedCases(beforeSource, beforePath);
    const skippedAfter = afterSource === null ? 0 : countSkippedCases(afterSource, afterPath ?? beforePath);
    verdicts.push(
      assessTestFile({
        path: afterPath ?? beforePath,
        before,
        after,
        assertionsBefore,
        assertionsAfter,
        skippedBefore,
        skippedAfter,
        exists: afterSource !== null,
        config,
      }),
    );
  }

  // Files added by this diff carry no before-state above, but their cases must count
  // towards the aggregate — otherwise a spec split into replacements always reads as loss.
  // Untracked files are included too: `git diff` cannot see them, so a locally-run gate
  // would otherwise score a not-yet-added replacement spec as pure loss.
  const addedPaths = changes
    .filter((change) => !change.before && change.after && isTestFile(change.after))
    .map((change) => /** @type {string} */ (change.after));
  for (const path of [...addedPaths, ...untrackedTestFiles(git)]) {
    const addedSource = readAfter(path);
    if (addedSource === null) continue;
    const addedCases = countTestCases(addedSource, path);
    const addedAssertions = countAssertions(addedSource, path);
    const addedSkipped = countSkippedCases(addedSource, path);
    verdicts.push({
      path,
      before: 0,
      after: addedCases,
      removed: 0,
      fraction: 0,
      assertions: {
        before: 0,
        after: addedAssertions,
        removed: -addedAssertions,
      },
      skipped: {
        before: 0,
        after: addedSkipped,
        added: addedSkipped,
      },
      exists: true,
      ok: true,
      approved: false,
    });
  }

  const aggregate = assessAggregate({ verdicts, config });

  const unifiedDiff = git([
    "diff",
    "--unified=0",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    base,
  ]);
  const artefacts = truncationArtefacts(unifiedDiff);

  return { verdicts, aggregate, artefacts };
}

/* ------------------------------------------------------------------------------------- */

/**
 * @param {string[]} argv
 * @returns {{ mode: "check" | "self-test", base: string, json: boolean }}
 */
export function parseArguments(argv) {
  if (argv.includes("--self-test")) {
    if (argv.length !== 1) throw new Error(`--self-test must be used alone. ${CLI_USAGE}`);
    return { mode: "self-test", base: "", json: false };
  }
  let base = "";
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--base") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) throw new Error(`--base needs a value. ${CLI_USAGE}`);
      if (base) throw new Error(`--base given twice. ${CLI_USAGE}`);
      base = value;
      index += 1;
    } else {
      throw new Error(`unknown argument ${arg}. ${CLI_USAGE}`);
    }
  }
  return { mode: "check", base, json };
}

const SELF_TEST_SPEC = [
  'import { test, expect } from "@playwright/test";',
  'test.describe("suite", () => {',
  '  test("alpha", async ({ page }) => { await expect(page).toBeTruthy(); });',
  '  test.skip("beta", async () => {});',
  '  test.fixme("gamma", async () => {});',
  '  test("delta", async () => { await test.step("inner", async () => {}); });',
  "});",
].join("\n");

/** @returns {boolean} */
export function selfTest(log = console.log) {
  /** @type {{ label: string, ok: boolean }[]} */
  const results = [];
  const check = (label, ok) => results.push({ label, ok });

  check("counts four cases and ignores describe/step", countTestCases(SELF_TEST_SPEC) === 4);
  check("counts two skipped/fixme declarations in SELF_TEST_SPEC", countSkippedCases(SELF_TEST_SPEC) === 2);
  check(
    "ignores commented-out tests",
    countTestCases(`// test("ghost", () => {});\n/* test("ghost2", () => {}); */\ntest("real", () => {});`) === 1,
  );
  check("ignores the regex .test() method", countTestCases(`const ok = /a/.test("a");`) === 0);
  check(
    "weights inline test.each array literals by element count and table refs once",
    countTestCases(`test.each([1, 2, 3])("case %i", () => {});`) === 3 &&
      countTestCases(`test.each(table)("case %i", () => {});`) === 1,
  );
  check("ignores in-body test.skip()", countTestCases(`test("a", () => { test.skip(); });`) === 1);
  check("counts vitest it()", countTestCases(`it("a", () => {});\nit.only("b", () => {});`) === 2);
  check(
    "counts Python test_ functions and @pytest.mark.parametrize items",
    countTestCases(
      `# def test_comment():\n@pytest.mark.parametrize("x", [1, 2, 3])\ndef test_p(x):\n    assert x > 0\ndef test_plain():\n    assert True\n`,
      "worker/python/test_extract.py",
    ) === 4,
  );
  check(
    "counts expect assertions via AST",
    countAssertions('expect(1).toBe(1);\nexpect.soft(2).toBe(2);\n// expect(3).toBe(3);\nconst s = "expect(4)";') === 2,
  );

  const config = parseConfig(readFileSync(CONFIG_PATH, "utf8"));
  const approve = (path, before, after) => ({
    ...config,
    approvedReductions: [{ path, before, after, reason: "suite retired with its feature", approvedOn: "2026-09-02" }],
  });

  // Per-file ceiling.
  check(
    "the #Y30AXB per-file drop fails",
    assessTestFile({ path: "tests/ui-smoke.spec.ts", before: 89, after: 9, config }).ok === false,
  );
  check(
    "mass-skipping active tests fails",
    assessTestFile({ path: "tests/x.spec.ts", before: 20, after: 20, skippedBefore: 0, skippedAfter: 15, config })
      .ok === false,
  );
  check(
    "a one-test trim on a small file passes",
    assessTestFile({ path: "tests/x.spec.ts", before: 4, after: 3, config }).ok === true,
  );
  check(
    "a 20% cut on a large file passes",
    assessTestFile({ path: "tests/x.spec.ts", before: 100, after: 80, config }).ok === true,
  );
  check(
    "a deleted file defers to the aggregate",
    assessTestFile({ path: "tests/x.spec.ts", before: 40, after: 0, exists: false, config }).ok === true,
  );
  check(
    "a surviving file gutted to zero fails",
    assessTestFile({ path: "tests/x.spec.ts", before: 40, after: 0, config }).ok === false,
  );
  check(
    "an exactly-pinned approval passes",
    assessTestFile({ path: "tests/x.spec.ts", before: 40, after: 0, config: approve("tests/x.spec.ts", 40, 0) }).ok ===
      true,
  );
  check(
    "an approval does not cover a larger later cut",
    assessTestFile({ path: "tests/x.spec.ts", before: 60, after: 0, config: approve("tests/x.spec.ts", 40, 0) }).ok ===
      false,
  );

  // Aggregate ceiling.
  check(
    "the #Y30AXB aggregate fails",
    assessAggregate({ verdicts: [{ path: "tests/ui-smoke.spec.ts", before: 89, after: 9 }], config }).ok === false,
  );
  check(
    "a spec replaced by its successor nets out and passes",
    assessAggregate({
      verdicts: [
        { path: "tests/settings-search.dom.test.tsx", before: 17, after: 0 },
        { path: "tests/settings-surface.dom.test.tsx", before: 0, after: 19 },
      ],
      config,
    }).ok === true,
  );
  check(
    "a bare mass deletion with no replacement fails",
    assessAggregate({ verdicts: [{ path: "tests/a.spec.ts", before: 40, after: 0 }], config }).ok === false,
  );
  check(
    "unrelated additions cannot excuse a gutted file",
    (() => {
      const verdicts = [
        { path: "tests/ui-smoke.spec.ts", before: 89, after: 9 },
        { path: "tests/new.spec.ts", before: 0, after: 200 },
      ];
      // The aggregate is absorbed, so the per-file rule is what must still catch it.
      return (
        assessAggregate({ verdicts, config }).ok === true &&
        assessTestFile({ path: "tests/ui-smoke.spec.ts", before: 89, after: 9, config }).ok === false
      );
    })(),
  );

  const bannerDiff = [
    "--- a/tests/ui-smoke.spec.ts",
    "+++ b/tests/ui-smoke.spec.ts",
    "@@ -1,0 +1,2 @@",
    `+Warning: ${"truncated"} output (original ${"token"} count: 77866)`,
    "+Total output lines: 6009",
  ].join("\n");
  check("detects the committed truncation banner", truncationArtefacts(bannerDiff).length === 2);
  check(
    "does not flag this gate's own files",
    truncationArtefacts(
      ["--- a/diff-integrity.json", "+++ b/diff-integrity.json", "@@ -1,0 +1,1 @@", "+Total output lines: 1"].join(
        "\n",
      ),
    ).length === 0,
  );
  check("leaves an ordinary diff alone", truncationArtefacts("+++ b/src/a.ts\n+const a = 1;").length === 0);

  check(
    "config rejects an out-of-range fraction",
    (() => {
      try {
        parseConfig('{"maxRemovedFraction":1.5,"minRemovedCases":3,"approvedReductions":[]}');
        return false;
      } catch {
        return true;
      }
    })(),
  );
  check(
    "config rejects an unreasoned approval",
    (() => {
      try {
        parseConfig(
          '{"maxRemovedFraction":0.25,"minRemovedCases":3,"approvedReductions":[{"path":"a","before":1,"after":0,"reason":"x","approvedOn":"y"}]}',
        );
        return false;
      } catch {
        return true;
      }
    })(),
  );
  check(
    "the committed config parses",
    (() => {
      try {
        parseConfig(readFileSync(CONFIG_PATH, "utf8"));
        return true;
      } catch {
        return false;
      }
    })(),
  );

  for (const result of results) log(`  ${result.ok ? "ok  " : "FAIL"}  ${result.label}`);
  const failed = results.filter((result) => !result.ok).length;
  log(`[diff-integrity] self-test: ${results.length - failed}/${results.length} passed.`);
  return failed === 0;
}

/**
 * @param {string[]} argv
 * @returns {number}
 */
export function main(argv = process.argv.slice(2)) {
  /** @type {ReturnType<typeof parseArguments>} */
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    console.error(`[diff-integrity] ${firstLine(error)}`);
    return 2;
  }

  if (options.mode === "self-test") return selfTest() ? 0 : 1;

  /** @type {DiffIntegrityConfig} */
  let config;
  let base;
  let result;
  try {
    config = parseConfig(readFileSync(CONFIG_PATH, "utf8"));
    base = resolveBase({ requested: options.base });
    result = evaluate({ base, config });
  } catch (error) {
    console.error(`[diff-integrity] FAIL — ${firstLine(error)}`);
    return 1;
  }

  const failures = result.verdicts.filter((verdict) => !verdict.ok);

  if (options.json) {
    console.log(JSON.stringify({ base, ...result }, null, 2));
  } else {
    for (const verdict of result.verdicts) {
      if (verdict.ok && verdict.removed <= 0) continue;
      const mark = verdict.ok ? (verdict.approved ? "APPROVED" : "OK      ") : "FAIL    ";
      console.log(`  ${mark}  ${verdict.path}  ${verdict.before} -> ${verdict.after} test case(s)`);
      if (verdict.message) console.log(`      x ${verdict.message}`);
    }
    if (!result.aggregate.ok) {
      console.log(
        `  FAIL      (all changed test files)  ${result.aggregate.before} -> ${result.aggregate.after} test case(s)`,
      );
      console.log(`      x ${result.aggregate.message}`);
    }
    for (const artefact of result.artefacts) {
      console.log(`  FAIL      ${artefact.path}`);
      console.log(`      x committed a tool truncation banner as file content: ${artefact.line}`);
    }
  }

  const total = failures.length + (result.aggregate.ok ? 0 : 1) + result.artefacts.length;
  if (total > 0) {
    console.error(
      `[diff-integrity] FAIL — ${failures.length} test file(s) below the per-file floor, ` +
        `${result.aggregate.ok ? "aggregate ok" : "aggregate below floor"}, ` +
        `${result.artefacts.length} truncation artefact(s), against base ${base.slice(0, 9)}.`,
    );
    return 1;
  }
  console.log(
    `[diff-integrity] PASS — ${result.verdicts.length} changed test file(s), ` +
      `${result.aggregate.before} -> ${result.aggregate.after} test case(s), against base ${base.slice(0, 9)}.`,
  );
  return 0;
}

const sameScriptPath = (a, b) => {
  try {
    return realpathSync(resolve(a)) === realpathSync(resolve(b));
  } catch {
    return resolve(a) === resolve(b);
  }
};
const invokedAsScript = process.argv[1] !== undefined && sameScriptPath(process.argv[1], SCRIPT_PATH);
if (invokedAsScript) process.exit(main());
