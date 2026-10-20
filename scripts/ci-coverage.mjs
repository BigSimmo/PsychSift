#!/usr/bin/env node
/**
 * ci-coverage.mjs — does `.github/workflows/ci.yml` actually re-run a named gate
 * for a given change scope?
 *
 * Extracted from the retired `gate-arbiter.mjs` (owner-approved governance cut,
 * 2026-09-17) because `scripts/browser-test-plan.mjs` depends on `deriveCiCoverage`
 * to report, honestly, whether GitHub will repeat the browser gate it is about to
 * narrow locally. The arbiter's deferral logic did not survive the cut; this
 * derivation did, because it answers a question with no other source of truth:
 * a step's presence in the YAML is not coverage — its guard, and its job's guard,
 * must actually be satisfied by the current change scope.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The `npm run <script>` invoked by a real YAML `run:` step.
 *
 * Anchored the same way `check-gate-manifest.mjs` anchors it, so a comment
 * mentioning `run: npm run X` cannot masquerade as an executed step.
 */
const npmRunScript = (line) =>
  line.match(
    /^\s*(?:-\s*)?run:\s+npm run ([\w:.-]+)(?:\s+--\s+(?:--merge-reports=[\w./-]+(?:\s+--reporter=default)?|--concurrency=\d+))?\s*(?:#.*)?$/,
  )?.[1];

/** A `run: |` or `run: >` block opener; its body is the following more-indented lines. */
const isRunBlockOpener = (line) => /^\s*(?:-\s*)?run:\s*[|>][-+]?\s*$/.test(line);

/** Whether one shell line inside a `run:` block invokes `npm run <name>` as a command (not a comment). */
const shellLineRunsScript = (line, name) =>
  !/^\s*#/.test(line) &&
  line
    .split(/[\s;&|()]+/)
    .some((token, index, tokens) => token === "npm" && tokens[index + 1] === "run" && tokens[index + 2] === name);

/**
 * Local gate name -> the CI script that covers it under a different name.
 * e.g. locally `npm run test` is the plain Vitest run, and CI enforces it as
 * `test:coverage` in the dedicated coverage job.
 */
export const CI_EQUIVALENT = new Map([
  ["test", "test:coverage"],
  ["vitest", "test:coverage"],
  ["lint:internal", "lint"],
  ["typecheck:internal", "typecheck"],
  ["typecheck:source:internal", "typecheck"],
]);

/**
 * Every `needs.changes.outputs.<flag> == 'true'` reference in a guard expression.
 * @param {string} guard
 * @returns {string[]}
 */
export function scopeFlagsInGuard(guard) {
  return [...String(guard ?? "").matchAll(/needs\.changes\.outputs\.([a-z_0-9]+)\s*==\s*'true'/g)].map((m) => m[1]);
}

/**
 * Parse a deliberately small Actions expression grammar, without executing JavaScript.
 * Unknown runtime terms remain explicit assumptions. Unknown scope and unsupported syntax
 * cannot establish coverage; boolean short-circuiting can still prove an independent arm.
 */
function evaluateGuard(guard, scope) {
  const source = String(guard)
    .trim()
    .replace(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/, "$1");
  const tokens = [];
  const token = /\s*('(?:''|[^'])*'|&&|\|\||==|!=|[!(),]|[a-zA-Z_][\w.*-]*)/y;
  let offset = 0;
  while (offset < source.length) {
    if (!source.slice(offset).trim()) break;
    token.lastIndex = offset;
    const match = token.exec(source);
    if (!match) return { value: null, missingScope: true, assumed: [] };
    tokens.push(match[1]);
    offset = token.lastIndex;
  }
  let index = 0;
  const known = (value) => ({ value, missingScope: false, assumed: [] });
  const unknown = (term, missingScope = false) => ({ value: null, missingScope, assumed: [term] });
  const truth = (result) => ({ ...result, value: result.value === null ? null : Boolean(result.value) });
  const combine = (left, right, operator) => {
    left = truth(left);
    right = truth(right);
    const decisive = operator === "&&" ? false : true;
    if (left.value === decisive) return left;
    if (right.value === decisive) return right;
    return {
      value: left.value === null || right.value === null ? null : !decisive,
      missingScope: left.missingScope || right.missingScope,
      assumed: [...left.assumed, ...right.assumed],
    };
  };
  const primary = () => {
    const start = index;
    const current = tokens[index++];
    if (current === "(") {
      const result = expression();
      if (tokens[index++] !== ")") throw new Error("unclosed group");
      return result;
    }
    if (!current || !/^(?:'|[a-zA-Z_])/.test(current)) throw new Error("expected value");
    if (current.startsWith("'")) return known(current.slice(1, -1).replace(/''/g, "'"));
    if (current === "true" || current === "false") return known(current === "true");
    // Functions are runtime-dependent atoms. Never hide a scope reference in an opaque call.
    if (tokens[index] === "(") {
      let depth = 0;
      do {
        const part = tokens[index++];
        if (part === "(") depth += 1;
        if (part === ")") depth -= 1;
        if (index > tokens.length) throw new Error("unclosed call");
      } while (depth > 0);
      const term = tokens.slice(start, index).join(" ");
      return unknown(term, /needs\.changes\.outputs\./.test(term));
    }
    const flag = current.match(/^needs\.changes\.outputs\.([a-z_0-9]+)$/)?.[1];
    if (flag && !flag.startsWith("tree_proven_")) {
      return scope && Object.hasOwn(scope, flag) && typeof scope[flag] === "boolean"
        ? known(scope[flag] ? "true" : "false")
        : unknown(current, true);
    }
    return unknown(current);
  };
  const unary = () => {
    if (tokens[index] !== "!") return primary();
    const start = index;
    index += 1;
    const result = truth(unary());
    return result.value === null
      ? { ...result, assumed: [tokens.slice(start, index).join(" ")] }
      : known(!result.value);
  };
  const equality = () => {
    const start = index;
    let left = unary();
    while (tokens[index] === "==" || tokens[index] === "!=") {
      const operator = tokens[index++];
      const right = unary();
      if (left.value === null || right.value === null) {
        left = unknown(tokens.slice(start, index).join(" "), left.missingScope || right.missingScope);
      } else if (typeof left.value !== typeof right.value) {
        // Actions coerces unlike types numerically; keep that outside this grammar.
        left = unknown(tokens.slice(start, index).join(" "), true);
      } else {
        const equal =
          typeof left.value === "string"
            ? left.value.toLowerCase() === right.value.toLowerCase()
            : left.value === right.value;
        left = known(operator === "==" ? equal : !equal);
      }
    }
    return left;
  };
  const conjunction = () => {
    let left = equality();
    while (tokens[index] === "&&") {
      index += 1;
      left = combine(left, equality(), "&&");
    }
    return left;
  };
  const expression = () => {
    let left = conjunction();
    while (tokens[index] === "||") {
      index += 1;
      left = combine(left, conjunction(), "||");
    }
    return left;
  };
  try {
    const result = truth(expression());
    if (index !== tokens.length) throw new Error("unsupported expression");
    return result;
  } catch {
    return { value: null, missingScope: true, assumed: [] };
  }
}

/**
 * The guard expressions protecting the CI step at `lineIndex`: the step's own
 * `if:` and the enclosing job's `if:` (which may be a folded `if: >` block).
 *
 * @param {string[]} lines
 * @param {number} lineIndex
 * @returns {{ guards: string[], job: string | null }}
 */
export function guardsForStep(lines, lineIndex) {
  const guards = [];
  let job = null;
  const readGuard = (index, value) => {
    if (!/^[>|][-+]?$/.test(value.trim())) return value.trim();
    const indent = lines[index].search(/\S/);
    const block = [];
    for (let next = index + 1; next < lines.length; next += 1) {
      if (!lines[next].trim()) continue;
      if (lines[next].search(/\S/) <= indent) break;
      block.push(lines[next].trim());
    }
    return block.join(" ");
  };

  // The step's own `if:`, searching back to the start of this step ("- name:" or "- run:").
  for (let i = lineIndex; i >= 0; i -= 1) {
    const line = lines[i];
    if (/^\s*-\s/.test(line) && i !== lineIndex) {
      // Reached the previous step's first line without finding this step's start.
      if (!/^\s*-\s*(name|run|uses):/.test(line)) break;
    }
    const stepIf = line.match(/^\s*(?:-\s*)?if:\s*(.+?)\s*$/);
    if (stepIf) guards.push(readGuard(i, stepIf[1]));
    if (/^\s*-\s*name:/.test(line)) break; // start of this step
  }

  // The enclosing job and its job-level `if:`.
  for (let i = lineIndex; i >= 0; i -= 1) {
    if (!/^  \S.*:\s*$/.test(lines[i])) continue;
    job = lines[i].trim().replace(/:$/, "");
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^  \S/.test(lines[j])) break; // next top-level job
      const jobIf = lines[j].match(/^    if:\s*(.*)$/);
      if (!jobIf) continue;
      guards.push(readGuard(j, jobIf[1]));
      break;
    }
    break;
  }

  return { guards, job };
}

/**
 * Does CI re-run `gate` on push, **for this change**?
 *
 * Resolved through three routes, in order: the gate's own name appearing in a CI
 * `run:` step, its declared CI equivalent, or a CI-invoked aggregate script whose
 * package.json body contains the gate.
 *
 * A step's presence in the YAML is not coverage: `lint` and `typecheck` are
 * step-conditional on `static_heavy_changed`, and `test:coverage` is job-conditional
 * on `coverage_changed`, so a docs-only change is covered by none of them. Every
 * guard on the step and its job is evaluated against the current change scope, and
 * an unsatisfied guard means not covered.
 *
 * Conditions that are not change-scope flags (draft state, event name) cannot be
 * evaluated from a local worktree. They are returned in `assumed` and printed with
 * the decision rather than silently treated as true.
 *
 * @param {string} projectRoot
 * @param {string} gate
 * @param {{ scope?: Record<string, boolean> | null, readFile?: typeof readFileSync }} [options]
 * @returns {{ covered: boolean, via: string | null, reason: string, assumed: string[] }}
 */
export function deriveCiCoverage(projectRoot, gate, { scope = null, readFile = readFileSync } = {}) {
  let ci;
  let scripts;
  try {
    ci = String(readFile(path.join(projectRoot, ".github", "workflows", "ci.yml"), "utf8"));
    scripts = JSON.parse(String(readFile(path.join(projectRoot, "package.json"), "utf8"))).scripts ?? {};
  } catch (error) {
    // Cannot read CI: assume it covers nothing, which makes every gate run locally.
    return {
      covered: false,
      via: null,
      assumed: [],
      reason: `could not read CI definition (${String(error?.message ?? error)})`,
    };
  }

  const lines = ci.split(/\r?\n/);
  const equivalent = CI_EQUIVALENT.get(gate);

  /**
   * Every CI line index whose `run:` invokes `name`: a single-line `run: npm run <name>`, or a
   * `run: |` block with `npm run <name>` on any body line (reported at the `run:` line, so the
   * step's guards are found the same way).
   */
  const stepsRunning = (name) =>
    lines.flatMap((line, index) => {
      if (npmRunScript(line) === name) return [index];
      if (!isRunBlockOpener(line)) return [];
      const indent = line.search(/\S/);
      for (let next = index + 1; next < lines.length; next += 1) {
        if (lines[next].trim() === "") continue;
        if (lines[next].search(/\S/) <= indent) break;
        if (shellLineRunsScript(lines[next], name)) return [index];
      }
      return [];
    });

  /** Aggregate CI scripts whose package.json body invokes `name`. */
  const aggregatesRunning = (name) =>
    Object.keys(scripts).filter((script) => {
      if (typeof scripts[script] !== "string") return false;
      return [...scripts[script].matchAll(/npm run ([\w:.-]+)/g)].some((match) => match[1] === name);
    });

  const candidates = [];
  for (const name of [gate, ...(equivalent ? [equivalent] : [])]) {
    for (const index of stepsRunning(name)) candidates.push({ name, index });
    for (const aggregate of aggregatesRunning(name)) {
      for (const index of stepsRunning(aggregate)) candidates.push({ name: `${aggregate} → ${name}`, index });
    }
  }

  if (candidates.length === 0) {
    return { covered: false, via: null, assumed: [], reason: `no CI step runs ${gate} — local is the only gate` };
  }

  // One satisfied invocation is enough; report the first, and the reason the last
  // candidate failed when none is satisfied.
  let lastUnsatisfied = null;
  for (const candidate of candidates) {
    const { guards, job } = guardsForStep(lines, candidate.index);
    const evaluated = guards.map((guard) => evaluateGuard(guard, scope));
    if (evaluated.some((result) => result.value === false || result.missingScope)) {
      lastUnsatisfied = scope
        ? `CI runs ${candidate.name} in "${job}" only when ${guards.join(" and ")}, which this change does not satisfy or cannot evaluate`
        : `CI runs ${candidate.name} in "${job}" under conditions that could not be evaluated`;
      continue;
    }
    const assumed = [...new Set(evaluated.flatMap((result) => result.assumed))];
    return {
      covered: true,
      via: candidate.name,
      assumed,
      reason:
        `ci.yml runs "${candidate.name}" in job "${job}"` +
        (guards.length > 0 ? `, subject to ${guards.join(" and ")}` : ""),
    };
  }

  return {
    covered: false,
    via: null,
    assumed: [],
    reason: lastUnsatisfied ?? `no CI step runs ${gate} for this change`,
  };
}
