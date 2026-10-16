import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateActionReference } from "./github-action-pins.mjs";
import { yamlBlock } from "./yaml-contract.mjs";
import { prBatchWorkflowFailures } from "./pr-batch-policy.mjs";

const workflowDir = path.join(process.cwd(), ".github", "workflows");

const runsOnLatestPattern = /^\s*runs-on:\s*ubuntu-latest\s*(?:#.*)?$/;
const workflowBranchMutationPattern =
  /\bgithub\s*\.\s*rest\s*\.\s*pulls\s*\.\s*updateBranch\b|\/pulls\/[^\s"']+\/update-branch\b|\bgh\s+pr\s+update-branch\b|\bsync:pr-branches(?::apply|\s+--\s+--apply)\b|\bsync-open-pr-branches\.mjs\s+--apply\b/;
// ---------------------------------------------------------------------------
// Reindex reaper apply-path guard.
//
// The reaper's apply path calls a cleanup RPC that deletes generation-bearing
// artifact rows across seven tables (chunks, images, table facts, embedding
// fields, index units, memory cards, sections) for EVERY tenant — no owner
// scoping, no keep-newest fallback, and `p_limit` caps documents rather than
// rows. It must never become reachable from a workflow on one switch alone.
//
// The first version of this rule only checked that the two gate NAMES appeared
// somewhere in the file. A security review ran eight fixtures against it and got
// past it six ways: a trailing `#` comment on the apply line supplied both names;
// declaring the two env vars and then deleting unconditionally passed; `|| 'true'`
// defaults armed both gates while still naming them; and `--apply` moved behind a
// backslash continuation, an env variable, or a renamed npm alias made the rule
// stop firing at all.
//
// So this rule now answers a structural question rather than a textual one:
//   * WHICH LINES CAN REACH THE APPLY PATH — after stripping inline comments,
//     joining backslash continuations, expanding `env:`/shell variables, and
//     resolving npm script aliases (transitively) out of package.json.
//   * ARE THOSE LINES ACTUALLY GATED — the apply invocation must sit lexically
//     inside a shell conditional that tests BOTH apply gates, the enclosing job
//     must be gated on `vars.REINDEX_REAPER_ENABLED == 'true'`, and the file
//     must not carry a push/PR/manual trigger.
//
// A gate expression that can render "true" on its own (`|| 'true'`) is treated
// as a defeated gate, not a satisfied one. Every unknown shape fails closed.
//
// A later Codex review defeated the structural version two more ways, both now
// closed. A gate can be defeated by the SHELL around it rather than inside its
// `${{ }}`: `is_true "$A" && is_true "$B" || true` names and tests both gates and
// still always runs, so the guard SHAPE is now allowlisted — no top-level `||`,
// no always-true term — instead of only its gate expressions being read. And a
// forbidden trigger can be written in YAML shapes the denylist did not parse:
// quoted flow-sequence items kept their quotes (`on: ["…", "workflow_dispatch"]`)
// and flow mappings were not read at all, so both are normalized before the
// denylist sees them.
const REAPER_SCRIPT_FILE = /cleanup-abandoned-reindex-generations\.ts/;
// Floor, so deleting the npm alias from package.json cannot disable the rule.
const REAPER_BASELINE_COMMANDS = ["reindex:cleanup-staged"];
const REAPER_APPLY_FLAG = /--apply\b/;
const reaperApplyGates = [
  {
    name: "github.event.client_payload.apply",
    pattern: /github\s*\.\s*event\s*\.\s*client_payload\s*\.\s*apply/,
    role: "the per-run trusted-dispatch gate",
  },
  {
    name: "vars.REINDEX_REAPER_APPLY",
    pattern: /vars\s*\.\s*REINDEX_REAPER_APPLY/,
    role: "the standing repository-variable gate",
  },
];
const REAPER_ENABLE_GATE = /vars\s*\.\s*REINDEX_REAPER_ENABLED\s*==\s*['"]true['"]/;
const FORBIDDEN_REAPER_TRIGGERS = ["push", "pull_request", "pull_request_target", "workflow_dispatch"];
const GITHUB_EXPRESSION = /\$\{\{.*?\}\}/g;
const VARIABLE_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Removes a trailing `#` comment without cutting inside a quoted string. Both
// YAML and shell agree that a comment starts at a `#` preceded by whitespace or
// line start, so one pass serves the `run:` block scalars and the YAML around
// them. Whole-line comments fall out of the same rule.
function stripInlineComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      if (character === "\\" && quote === '"') {
        index += 1;
        continue;
      }
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "#" && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index);
  }
  return line;
}

// `--apply` split across a backslash continuation is still `--apply`.
function toLogicalLines(lines) {
  const logical = [];
  let pending = null;
  lines.forEach((line, index) => {
    const trimmedEnd = line.replace(/\s+$/, "");
    const continues = trimmedEnd.endsWith("\\");
    const body = continues ? trimmedEnd.slice(0, -1) : trimmedEnd;
    if (pending) pending.text += ` ${body.trim()}`;
    else pending = { text: body, index };
    if (!continues) {
      logical.push(pending);
      pending = null;
    }
  });
  if (pending) logical.push(pending);
  return logical;
}

// Both `env:` mappings and plain shell assignments, so a gate or a flag list
// laundered through a variable is still visible to the checks below. Every
// value seen for a name is kept: detection then fires on any of them, and a
// single defeated gate value poisons the gate rather than being outvoted.
function collectVariableValues(lines) {
  const values = new Map();
  const record = (name, value) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (!values.has(name)) values.set(name, []);
    const seen = values.get(name);
    if (!seen.includes(trimmed)) seen.push(trimmed);
  };
  for (const line of lines) {
    const mapping = /^\s*([A-Za-z_][A-Za-z0-9_]*):\s+(\S.*)$/.exec(line);
    if (mapping) record(mapping[1], mapping[2]);
    const assignment = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (assignment) record(assignment[1], assignment[2]);
  }
  return values;
}

function expandVariables(text, values) {
  let current = text;
  for (let pass = 0; pass < 4; pass += 1) {
    const next = current.replace(VARIABLE_REFERENCE, (match, braced, bare) => {
      const replacement = values.get(braced ?? bare);
      return replacement ? ` ${replacement.join(" ")} ` : match;
    });
    if (next === current) break;
    current = next;
  }
  return current;
}

function readPackageScripts(root) {
  const packagePath = path.join(root, "package.json");
  if (!existsSync(packagePath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(packagePath, "utf8"));
    return parsed && typeof parsed.scripts === "object" && parsed.scripts ? parsed.scripts : {};
  } catch {
    return {};
  }
}

// Renaming the npm script must not evade the rule, so the command set is
// derived from package.json rather than hardcoded: any script reaching the
// reaper's TypeScript entry point counts, and so does any script that runs one
// of those. A script that already carries `--apply` reaches the destructive
// path on its own, with no flag needed at the call site.
function resolveReaperCommands(root) {
  const scripts = readPackageScripts(root);
  const names = new Set(REAPER_BASELINE_COMMANDS);
  const applyNames = new Set();
  for (let pass = 0; pass < 16; pass += 1) {
    let changed = false;
    for (const [name, body] of Object.entries(scripts)) {
      const command = String(body ?? "");
      const invoked = [...names].filter((known) =>
        new RegExp(`(?:\\brun|\\byarn|\\bnpx)\\s+${escapeRegExp(known)}(?:\\s|$)`).test(command),
      );
      if (!REAPER_SCRIPT_FILE.test(command) && invoked.length === 0) continue;
      if (!names.has(name)) {
        names.add(name);
        changed = true;
      }
      const carriesApply = REAPER_APPLY_FLAG.test(command) || invoked.some((known) => applyNames.has(known));
      if (carriesApply && !applyNames.has(name)) {
        applyNames.add(name);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const alternation = (set) => [...set].map(escapeRegExp).join("|");
  return {
    command: new RegExp(`(?:${alternation(names)}|cleanup-abandoned-reindex-generations\\.ts)`),
    applyCommand: applyNames.size > 0 ? new RegExp(`(?:${alternation(applyNames)})`) : null,
  };
}

function reachesReaperApply(text, commands) {
  if (!commands.command.test(text)) return false;
  if (REAPER_APPLY_FLAG.test(text)) return true;
  return commands.applyCommand ? commands.applyCommand.test(text) : false;
}

// A gate counts only when a `${{ }}` expression naming it can NOT render the
// string "true" by itself. `${{ github.event.client_payload.apply || 'true' }}`
// names the gate and arms it in the same breath; that is a defeated gate.
function evaluateGate(text, gate) {
  const expressions = text.match(GITHUB_EXPRESSION) ?? [];
  const naming = expressions.filter((expression) => gate.pattern.test(expression));
  if (naming.length === 0) return { satisfied: false, defeated: null };
  const defeated = naming.find((expression) => /\btrue\b/i.test(expression));
  if (defeated) return { satisfied: false, defeated: defeated.trim() };
  return { satisfied: true, defeated: null };
}

// Tracks the shell `if`/`elif`/`else`/`fi` nesting so "is this line guarded?"
// is answered by structure rather than by the gate names appearing anywhere in
// the file. An `if` whose condition cannot be parsed contributes an empty
// condition, which satisfies no gate.
function annotateShellConditions(logical) {
  const stack = [];
  for (const entry of logical) {
    const text = entry.expanded.trim();
    const branch = /^(if|elif)\s+(.*?);\s*then\b/.exec(text);
    if (branch) {
      if (branch[1] === "if") stack.push(branch[2]);
      else if (stack.length > 0) stack[stack.length - 1] = branch[2];
      else stack.push(branch[2]);
      continue;
    }
    if (/^if\s/.test(text)) {
      stack.push("");
      continue;
    }
    if (/^elif\s/.test(text)) {
      if (stack.length > 0) stack[stack.length - 1] = "";
      else stack.push("");
      continue;
    }
    if (/^else\b/.test(text)) {
      if (stack.length > 0) stack[stack.length - 1] = "";
      continue;
    }
    if (/^fi\b/.test(text)) {
      stack.pop();
      continue;
    }
    entry.guards = [...stack];
  }
}

// `[ … ] && [ … ] && npm run … --apply` guards on one line.
function inlineGuard(text, commands) {
  const match = commands.command.exec(text);
  if (!match) return "";
  const prefix = text.slice(0, match.index);
  return prefix.includes("&&") ? prefix : "";
}

function collectJobs(lines) {
  const start = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (start < 0) return [];
  const jobs = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "") continue;
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) {
      if (jobs.length > 0) jobs[jobs.length - 1].end = index;
      jobs.push({ name: header[1], start: index, end: lines.length });
      continue;
    }
    if (/^\S/.test(line)) {
      if (jobs.length > 0) jobs[jobs.length - 1].end = index;
      break;
    }
  }
  for (const job of jobs) {
    const condition = [];
    for (let index = job.start + 1; index < job.end; index += 1) {
      const match = /^ {4}if:\s*(.*)$/.exec(lines[index]);
      if (!match) continue;
      condition.push(match[1]);
      for (let follow = index + 1; follow < job.end; follow += 1) {
        if (lines[follow].trim() === "") continue;
        if (/^ {0,4}\S/.test(lines[follow])) break;
        condition.push(lines[follow].trim());
      }
      break;
    }
    job.condition = condition.join(" ");
  }
  return jobs;
}

/**
 * Split `text` on `operator` at the TOP level only — never inside quotes, brackets or
 * braces. Used both to read `on:` flow collections and to take a shell guard apart, and in
 * both places a naive `String.split` is the bug: it cuts inside `[{ cron: "0 1 * * *" }]`
 * and inside a quoted shell argument.
 */
function splitOutsideGroups(text, operator) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if ("[{(".includes(character)) depth += 1;
    else if ("]})".includes(character)) depth -= 1;
    else if (depth === 0 && text.startsWith(operator, index)) {
      parts.push(text.slice(start, index));
      index += operator.length - 1;
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/**
 * The trigger name from one `on:` entry, in any of the shapes YAML allows for it: a bare
 * scalar, a sequence item (`- push`), a quoted scalar, and a mapping key with or without
 * quotes. The first version kept the quotes on flow-sequence items, so
 * `on: ["repository_dispatch", "workflow_dispatch"]` produced the name `"workflow_dispatch"`
 * — quotes included — and the denylist's `has("workflow_dispatch")` missed it. Flow mappings
 * were not read at all. Either shape let a secret-bearing destructive workflow declare a
 * branch-selectable trigger and still pass (Codex review).
 */
function normalizeTriggerName(item) {
  let value = item.trim().replace(/^-\s*/, "").trim();
  const colon = value.indexOf(":");
  if (colon >= 0) value = value.slice(0, colon);
  return value
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
}

function declaredTriggers(lines) {
  const triggers = new Set();
  const start = lines.findIndex((line) => /^["']?on["']?\s*:/.test(line));
  if (start < 0) return triggers;
  const inline = /^["']?on["']?\s*:\s*(\S.*)$/.exec(lines[start]);
  if (inline) {
    // One layer of flow collection, sequence or mapping: `[a, b]`, `{ a: …, b: … }`, or a
    // bare scalar. Splitting outside groups keeps `{ schedule: [{ cron: "0 1 * * *" }] }`
    // in one piece instead of cutting it at the cron expression's commas.
    const body = inline[1]
      .trim()
      .replace(/^[[{]/, "")
      .replace(/[\]}]$/, "");
    for (const item of splitOutsideGroups(body, ",")) {
      const trigger = normalizeTriggerName(item);
      if (trigger) triggers.add(trigger);
    }
  }
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "") continue;
    if (/^\S/.test(line)) break;
    // Block mapping keys (quoted or not) and block sequence items alike.
    const key = /^ {2}(["']?)([A-Za-z_][A-Za-z0-9_-]*)\1\s*:/.exec(line);
    if (key) {
      triggers.add(key[2]);
      continue;
    }
    const sequenceItem = /^ {2}-\s*(\S.*)$/.exec(line);
    if (sequenceItem) {
      const trigger = normalizeTriggerName(sequenceItem[1]);
      if (trigger) triggers.add(trigger);
    }
  }
  return triggers;
}

// A conjunct that is true whatever the gates say. `|| true` is the dangerous one, but a
// bare `true`, `:`, `1` or `[ 1 ]` term does the same job.
const ALWAYS_TRUE_TERM = /^(?:true|:|1|\[\s*1\s*\]|\[\[\s*1\s*\]\]|test\s+1)$/;

/**
 * Is the shell condition guarding the apply path a shape that can actually gate it?
 *
 * `evaluateGate` reads the `${{ }}` expressions and can therefore see a gate DEFEATED
 * inside GitHub-expression syntax, but it cannot see one defeated by the SHELL around it:
 * `if is_true "$APPLY_REQUESTED" && is_true "$APPLY_ALLOWED" || true; then` names both
 * gates, satisfies both checks, and always enters the destructive branch (Codex review).
 *
 * A gate has no need of `||` — a disjunction is only as strong as its weakest branch, which
 * is the opposite of gating — so the shape is allowlisted rather than pattern-matched, and
 * anything unfamiliar fails closed.
 */
function guardShapeFailure(condition) {
  const text = condition.trim();
  if (!text) return null;
  if (splitOutsideGroups(text, "||").length > 1) {
    return `its enclosing conditional is a disjunction, so it is entered whenever ANY branch holds: \`${text}\`. A gate cannot contain \`||\`; use \`&&\` between the gate tests.`;
  }
  for (const conjunct of splitOutsideGroups(text, "&&")) {
    const term = conjunct.trim().replace(/^\(+/, "").replace(/\)+$/, "").trim();
    if (ALWAYS_TRUE_TERM.test(term)) {
      return `its enclosing conditional contains the always-true term \`${term}\`, so the branch is entered regardless of the gates: \`${text}\`.`;
    }
  }
  return null;
}

function reaperApplyFailures(fileName, source, commands) {
  const rawLines = source.split(/\r?\n/);
  const lines = rawLines.map(stripInlineComment);
  const values = collectVariableValues(lines);
  const logical = toLogicalLines(lines).map((entry) => ({ ...entry, expanded: expandVariables(entry.text, values) }));
  const applyLines = logical.filter((entry) => reachesReaperApply(entry.expanded, commands));
  if (applyLines.length === 0) return [];

  const failures = [];
  const prefix = `${fileName}: the reindex reaper apply path deletes generation-bearing artifact rows across seven tables for every tenant`;
  annotateShellConditions(logical);

  for (const entry of applyLines) {
    const guard = [...(entry.guards ?? []), inlineGuard(entry.expanded, commands)].filter(Boolean).join(" && ");
    if (!guard) {
      failures.push(
        `${prefix}. Line ${entry.index + 1} reaches it with no enclosing shell conditional at all. Naming the gates in a comment, or declaring them in an env: block, is not gating on them.`,
      );
      continue;
    }
    const shapeFailure = guardShapeFailure(guard);
    if (shapeFailure) {
      // Reported instead of the per-gate results, not alongside them: when the condition
      // is a tautology the gates it names are irrelevant, and printing "gate satisfied"
      // beside "the branch always runs" is the confusion this check exists to remove.
      failures.push(`${prefix}. Line ${entry.index + 1} names its gates, but ${shapeFailure}`);
      continue;
    }
    for (const gate of reaperApplyGates) {
      const { satisfied, defeated } = evaluateGate(guard, gate);
      if (satisfied) continue;
      failures.push(
        defeated
          ? `${prefix}. Line ${entry.index + 1} is guarded by ${gate.name} (${gate.role}), but that gate is defeated: \`${defeated}\` renders "true" on its own. Default the expression to 'false' and do the "true" comparison in the shell.`
          : `${prefix}. Line ${entry.index + 1} is not guarded by ${gate.name} (${gate.role}); its enclosing conditional tests: ${guard.trim() || "(nothing)"}.`,
      );
    }
  }

  const jobs = collectJobs(lines);
  for (const entry of applyLines) {
    const job = jobs.find((candidate) => entry.index >= candidate.start && entry.index < candidate.end);
    if (!job) {
      failures.push(
        `${prefix}. Line ${entry.index + 1} is not inside a workflow job, so it cannot carry the job-level vars.REINDEX_REAPER_ENABLED == 'true' gate. Do not put the apply path in a composite action.`,
      );
      continue;
    }
    if (!REAPER_ENABLE_GATE.test(job.condition ?? "")) {
      failures.push(
        `${prefix}. Job "${job.name}" reaches it without the job-level gate \`if: vars.REINDEX_REAPER_ENABLED == 'true'\`.`,
      );
    }
  }

  const triggers = declaredTriggers(lines);
  const forbidden = FORBIDDEN_REAPER_TRIGGERS.filter((trigger) => triggers.has(trigger));
  if (forbidden.length > 0) {
    failures.push(
      `${prefix}. A workflow that can reach it must not be triggerable by ${forbidden.join(", ")} — those let a same-repository writer point a secret-bearing destructive workflow at their own definition. Use repository_dispatch.`,
    );
  }

  return [...new Set(failures)];
}

const failures = [];
const expectedSupabaseCliVersion = "2.108.0";
const expectedSupabaseCliVersionPattern = expectedSupabaseCliVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function discoverWorkflowFiles(root) {
  const workflowDir = path.join(root, ".github", "workflows");
  if (!existsSync(workflowDir)) return [];
  return readdirSync(workflowDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => path.join(workflowDir, entry.name));
}

function discoverCompositeActionFiles(root) {
  const actionsDir = path.join(root, ".github", "actions");
  if (!existsSync(actionsDir)) return [];
  const files = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (/^action\.ya?ml$/i.test(entry.name)) {
        files.push(fullPath);
      }
    }
  };
  visit(actionsDir);
  return files;
}

function discoverGitHubActionFiles(root) {
  return [...discoverWorkflowFiles(root), ...discoverCompositeActionFiles(root)];
}

function collectPinFailures(root) {
  const failures = prBatchWorkflowFailures(root);
  const reaperCommands = resolveReaperCommands(root);
  for (const filePath of discoverGitHubActionFiles(root)) {
    const fileName = path.relative(root, filePath).replaceAll("\\", "/");
    const source = readFileSync(filePath, "utf8");
    const lines = source.split(/\r?\n/);

    failures.push(...reaperApplyFailures(fileName, source, reaperCommands));

    if (workflowBranchMutationPattern.test(source)) {
      failures.push(
        `${fileName}: workflow-authored PR branch updates are prohibited because bot-authored heads leave required checks awaiting approval. Use npm run sync:pr-branches:apply with explicit human/operator auth.`,
      );
    }

    lines.forEach((line, index) => {
      if (runsOnLatestPattern.test(line)) {
        failures.push(
          `${fileName}:${index + 1}: runs-on uses ubuntu-latest. Pin GitHub-hosted Linux jobs to ubuntu-24.04 so CI is not tied to the moving ubuntu-latest alias.`,
        );
      }

      const actionFailure = validateActionReference(line);
      if (actionFailure) failures.push(`${fileName}:${index + 1}: ${actionFailure}`);
    });
  }
  return failures;
}

// Reaper fixtures A-M. Every one but H is a way some earlier version of this rule
// could be walked past: a security review copied that rule into a harness and
// found six of these passed or never fired. They are kept as executable
// counter-examples so a future simplification cannot quietly reopen any of them.
const reaperFixtures = [
  {
    // A. A trailing `#` comment on the apply line supplied both gate names, so a
    // whole-line comment strip left them in the "executable" text.
    file: "reaper-a-trailing-comment.yml",
    mustFail: "no enclosing shell conditional",
    yaml:
      "name: a\non:\n  repository_dispatch:\n    types: [reindex-reaper]\njobs:\n  reap:\n    if: vars.REINDEX_REAPER_ENABLED == 'true'\n    steps:\n" +
      "      - run: npm run reindex:cleanup-staged -- --apply --yes # gates: github.event.client_payload.apply and vars.REINDEX_REAPER_APPLY\n",
  },
  {
    // B. `--apply` on the next physical line via a backslash continuation. The
    // old single-line regex never fired at all.
    file: "reaper-b-line-continuation.yml",
    mustFail: "no enclosing shell conditional",
    yaml:
      "name: b\non:\n  repository_dispatch:\n    types: [reindex-reaper]\njobs:\n  reap:\n    if: vars.REINDEX_REAPER_ENABLED == 'true'\n    steps:\n" +
      "      - run: |\n          npm run reindex:cleanup-staged -- \\\n            --apply --yes\n",
  },
  {
    // C. The flags travel through an env variable, so neither the command line
    // nor the env line carries the whole invocation on its own.
    file: "reaper-c-env-indirection.yml",
    mustFail: "no enclosing shell conditional",
    yaml:
      "name: c\non:\n  repository_dispatch:\n    types: [reindex-reaper]\njobs:\n  reap:\n    if: vars.REINDEX_REAPER_ENABLED == 'true'\n    steps:\n" +
      "      - env:\n          FLAGS: --apply --yes\n        run: npm run reindex:cleanup-staged -- $FLAGS\n",
  },
  {
    // D. A renamed npm alias. `reindex:reap` is defined in the fixture
    // package.json as `npm run reindex:cleanup-staged -- --apply --yes`, so the
    // workflow line names neither the script file nor `--apply`.
    file: "reaper-d-npm-alias.yml",
    mustFail: "no enclosing shell conditional",
    yaml:
      "name: d\non:\n  repository_dispatch:\n    types: [reindex-reaper]\njobs:\n  reap:\n    if: vars.REINDEX_REAPER_ENABLED == 'true'\n    steps:\n" +
      "      - run: npm run reindex:reap\n",
  },
  {
    // E. Only the standing repository variable is declared.
    file: "reaper-e-single-gate.yml",
    mustFail: "not guarded by github.event.client_payload.apply",
    yaml:
      "name: e\non:\n  repository_dispatch:\n    types: [reindex-reaper]\njobs:\n  reap:\n    if: vars.REINDEX_REAPER_ENABLED == 'true'\n    steps:\n" +
      "      - env:\n          APPLY_ALLOWED: ${{ vars.REINDEX_REAPER_APPLY }}\n" +
      '        run: |\n          if [ "$APPLY_ALLOWED" = "true" ]; then\n            npm run reindex:cleanup-staged -- --apply --yes\n          fi\n',
  },
  {
    // F. Both gates declared as env vars and then ignored: the delete runs
    // unconditionally. The old rule's own self-test certified this as correct.
    file: "reaper-f-declared-not-gated.yml",
    mustFail: "no enclosing shell conditional",
    yaml:
      "name: f\non:\n  repository_dispatch:\n    types: [reindex-reaper]\njobs:\n  reap:\n    if: vars.REINDEX_REAPER_ENABLED == 'true'\n    steps:\n" +
      "      - env:\n          APPLY_REQUESTED: ${{ github.event.client_payload.apply || 'false' }}\n" +
      "          APPLY_ALLOWED: ${{ vars.REINDEX_REAPER_APPLY }}\n" +
      "        run: npm run reindex:cleanup-staged -- --apply --yes\n",
  },
  {
    // G. The motivating scenario: a real conditional on both gates, each of
    // which now defaults to 'true'. Fully armed, gate names intact.
    file: "reaper-g-true-default.yml",
    mustFail: 'renders "true" on its own',
    yaml:
      "name: g\non:\n  repository_dispatch:\n    types: [reindex-reaper]\njobs:\n  reap:\n    if: vars.REINDEX_REAPER_ENABLED == 'true'\n    steps:\n" +
      "      - env:\n          APPLY_REQUESTED: ${{ github.event.client_payload.apply || 'true' }}\n" +
      "          APPLY_ALLOWED: ${{ vars.REINDEX_REAPER_APPLY || 'true' }}\n" +
      '        run: |\n          if [ "$APPLY_REQUESTED" = "true" ] && [ "$APPLY_ALLOWED" = "true" ]; then\n' +
      "            npm run reindex:cleanup-staged -- --apply --yes\n          fi\n",
  },
  {
    // H. Both gates in one conditional, false defaults, job-level enable gate,
    // dispatch-only trigger. The only fixture that must pass.
    file: "reaper-h-correctly-gated.yml",
    mustFail: null,
    yaml:
      "name: h\non:\n  repository_dispatch:\n    types: [reindex-reaper]\n  schedule:\n    - cron: \"45 19 * * 0\"\njobs:\n  reap:\n    if: vars.REINDEX_REAPER_ENABLED == 'true'\n    steps:\n" +
      "      - env:\n          APPLY_REQUESTED: ${{ github.event.client_payload.apply || 'false' }}\n" +
      "          APPLY_ALLOWED: ${{ vars.REINDEX_REAPER_APPLY }}\n" +
      '        run: |\n          if [ "$GITHUB_EVENT_NAME" = "schedule" ]; then\n' +
      "            npm run reindex:cleanup-staged -- --alert-on-abandoned\n" +
      '          elif [ "$APPLY_REQUESTED" = "true" ] && [ "$APPLY_ALLOWED" = "true" ]; then\n' +
      "            npm run reindex:cleanup-staged -- --apply --yes\n" +
      "          else\n            npm run reindex:cleanup-staged\n          fi\n",
  },
  {
    // I. Correctly gated, but reachable from a branch-selectable manual trigger,
    // which would let a same-repository writer edit the workflow it runs.
    file: "reaper-i-manual-trigger.yml",
    mustFail: "must not be triggerable by workflow_dispatch",
    yaml:
      "name: i\non:\n  repository_dispatch:\n    types: [reindex-reaper]\n  workflow_dispatch:\njobs:\n  reap:\n    if: vars.REINDEX_REAPER_ENABLED == 'true'\n    steps:\n" +
      "      - env:\n          APPLY_REQUESTED: ${{ github.event.client_payload.apply || 'false' }}\n" +
      "          APPLY_ALLOWED: ${{ vars.REINDEX_REAPER_APPLY }}\n" +
      '        run: |\n          if [ "$APPLY_REQUESTED" = "true" ] && [ "$APPLY_ALLOWED" = "true" ]; then\n' +
      "            npm run reindex:cleanup-staged -- --apply --yes\n          fi\n",
  },
  {
    // The original comment-only fixture: the gate names live in a whole-line
    // header comment and nowhere else.
    file: "reaper-comment-only.yml",
    mustFail: "no enclosing shell conditional",
    yaml:
      "# Apply requires github.event.client_payload.apply and vars.REINDEX_REAPER_APPLY.\n" +
      "name: comment only\non:\n  repository_dispatch:\n    types: [reindex-reaper]\njobs:\n  reap:\n    if: vars.REINDEX_REAPER_ENABLED == 'true'\n    steps:\n" +
      "      - run: npm run reindex:cleanup-staged -- --apply --yes\n",
  },
  {
    // J. Both gates named and tested, then defeated by the shell around them. The
    // `${{ }}` expressions are impeccable; the branch still always runs.
    file: "reaper-j-tautology.yml",
    mustFail: "is a disjunction",
    yaml:
      "name: j\non:\n  repository_dispatch:\n    types: [reindex-reaper]\njobs:\n  reap:\n    if: vars.REINDEX_REAPER_ENABLED == 'true'\n    steps:\n" +
      "      - env:\n          APPLY_REQUESTED: ${{ github.event.client_payload.apply || 'false' }}\n" +
      "          APPLY_ALLOWED: ${{ vars.REINDEX_REAPER_APPLY }}\n" +
      '        run: |\n          if [ "$APPLY_REQUESTED" = "true" ] && [ "$APPLY_ALLOWED" = "true" ] || true; then\n' +
      "            npm run reindex:cleanup-staged -- --apply --yes\n          fi\n",
  },
  {
    // M. The second gate's test replaced by a constant while its env: declaration stays
    // in place, so the gate is still named everywhere a reader would look for it.
    file: "reaper-m-constant-term.yml",
    mustFail: "always-true term",
    yaml:
      "name: m\non:\n  repository_dispatch:\n    types: [reindex-reaper]\njobs:\n  reap:\n    if: vars.REINDEX_REAPER_ENABLED == 'true'\n    steps:\n" +
      "      - env:\n          APPLY_REQUESTED: ${{ github.event.client_payload.apply || 'false' }}\n" +
      "          APPLY_ALLOWED: ${{ vars.REINDEX_REAPER_APPLY }}\n" +
      '        run: |\n          if [ "$APPLY_REQUESTED" = "true" ] && [ 1 ]; then\n' +
      "            npm run reindex:cleanup-staged -- --apply --yes\n          fi\n",
  },
  {
    // K. The forbidden trigger written as a QUOTED flow-sequence item. Identical in
    // meaning to fixture I, and invisible to a denylist that never strips the quotes.
    file: "reaper-k-quoted-flow-trigger.yml",
    mustFail: "must not be triggerable by workflow_dispatch",
    yaml:
      'name: k\non: ["repository_dispatch", "workflow_dispatch"]\njobs:\n  reap:\n    if: vars.REINDEX_REAPER_ENABLED == \'true\'\n    steps:\n' +
      "      - env:\n          APPLY_REQUESTED: ${{ github.event.client_payload.apply || 'false' }}\n" +
      "          APPLY_ALLOWED: ${{ vars.REINDEX_REAPER_APPLY }}\n" +
      '        run: |\n          if [ "$APPLY_REQUESTED" = "true" ] && [ "$APPLY_ALLOWED" = "true" ]; then\n' +
      "            npm run reindex:cleanup-staged -- --apply --yes\n          fi\n",
  },
  {
    // L. The same trigger as a flow MAPPING, whose commas sit inside a nested cron
    // sequence — the case a naive comma split gets wrong even after quote stripping.
    file: "reaper-l-flow-mapping-trigger.yml",
    mustFail: "must not be triggerable by workflow_dispatch",
    yaml:
      "name: l\non: { schedule: [{ cron: \"45 19 * * 0\" }], workflow_dispatch: {} }\njobs:\n  reap:\n    if: vars.REINDEX_REAPER_ENABLED == 'true'\n    steps:\n" +
      "      - env:\n          APPLY_REQUESTED: ${{ github.event.client_payload.apply || 'false' }}\n" +
      "          APPLY_ALLOWED: ${{ vars.REINDEX_REAPER_APPLY }}\n" +
      '        run: |\n          if [ "$APPLY_REQUESTED" = "true" ] && [ "$APPLY_ALLOWED" = "true" ]; then\n' +
      "            npm run reindex:cleanup-staged -- --apply --yes\n          fi\n",
  },
  {
    // The job-level enable gate is required too, not just the two apply gates.
    file: "reaper-no-enable-gate.yml",
    mustFail: "without the job-level gate",
    yaml:
      "name: no enable gate\non:\n  repository_dispatch:\n    types: [reindex-reaper]\njobs:\n  reap:\n    steps:\n" +
      "      - env:\n          APPLY_REQUESTED: ${{ github.event.client_payload.apply || 'false' }}\n" +
      "          APPLY_ALLOWED: ${{ vars.REINDEX_REAPER_APPLY }}\n" +
      '        run: |\n          if [ "$APPLY_REQUESTED" = "true" ] && [ "$APPLY_ALLOWED" = "true" ]; then\n' +
      "            npm run reindex:cleanup-staged -- --apply --yes\n          fi\n",
  },
];

function selfTest() {
  const root = mkdtempSync(path.join(os.tmpdir(), "github-action-pin-check-"));
  try {
    const workflowDir = path.join(root, ".github", "workflows");
    const actionDir = path.join(root, ".github", "actions", "fixture");
    mkdirSync(workflowDir, { recursive: true });
    mkdirSync(actionDir, { recursive: true });
    // The reaper rule resolves its command set from package.json, so the fixture
    // root needs one — fixture D exists to prove a renamed alias is followed.
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify(
        {
          scripts: {
            "reindex:cleanup-staged": "node scripts/run-tsx.mjs scripts/cleanup-abandoned-reindex-generations.ts",
            "reindex:reap": "npm run reindex:cleanup-staged -- --apply --yes",
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(path.join(workflowDir, "ok.yml"), "name: ok\n", "utf8");
    writeFileSync(
      path.join(workflowDir, "unsafe-sync.yml"),
      "name: unsafe\njobs:\n  sync:\n    steps:\n      - run: github.rest.pulls.updateBranch({})\n",
      "utf8",
    );
    writeFileSync(
      path.join(workflowDir, "unsafe-helper-sync.yml"),
      "name: unsafe helper\njobs:\n  sync:\n    steps:\n      - run: npm run sync:pr-branches:apply\n",
      "utf8",
    );
    for (const fixture of reaperFixtures) {
      writeFileSync(path.join(workflowDir, fixture.file), fixture.yaml, "utf8");
    }
    writeFileSync(
      path.join(actionDir, "action.yml"),
      "name: fixture\nruns:\n  using: composite\n  steps:\n    - uses: actions/cache@v6\n",
      "utf8",
    );

    const failures = collectPinFailures(root);
    if (
      !failures.some(
        (failure) => failure.includes(".github/actions/fixture/action.yml") && failure.includes("actions/cache@v6"),
      )
    ) {
      throw new Error("self-test failed: composite action uses entries were not scanned");
    }
    if (!failures.some((failure) => failure.includes("unsafe-sync.yml") && failure.includes("branch updates"))) {
      throw new Error("self-test failed: workflow-authored PR branch mutation was not rejected");
    }
    if (!failures.some((failure) => failure.includes("unsafe-helper-sync.yml") && failure.includes("branch updates"))) {
      throw new Error("self-test failed: workflow invocation of the operator apply helper was not rejected");
    }
    // `--self-test --explain` prints the verdict for every reaper fixture, so the
    // rule's behaviour can be inspected without hand-building a harness.
    const explain = process.argv.includes("--explain");
    for (const fixture of reaperFixtures) {
      const matched = failures.filter((failure) => failure.includes(fixture.file));
      if (explain) {
        console.log(`${fixture.file}: ${matched.length > 0 ? matched.join("\n    ") : "(no failure — accepted)"}`);
      }
      if (fixture.mustFail === null) {
        if (matched.length > 0) {
          throw new Error(
            `self-test failed: correctly gated reaper fixture ${fixture.file} was rejected: ${matched[0]}`,
          );
        }
        continue;
      }
      if (!matched.some((failure) => failure.includes(fixture.mustFail))) {
        throw new Error(
          `self-test failed: reaper fixture ${fixture.file} was not rejected for "${fixture.mustFail}" (got: ${matched.join(" | ") || "no failure at all"})`,
        );
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv.includes("--self-test")) {
  selfTest();
  console.log("GitHub Actions pin check self-test passed.");
  process.exit(0);
}

selfTest();
failures.push(...collectPinFailures(process.cwd()));

const ciWorkflowPath = path.join(workflowDir, "ci.yml");
const ciWorkflow = readFileSync(ciWorkflowPath, "utf8");
const ciPullRequestTrigger = yamlBlock(ciWorkflow, "pull_request:", 2);
const migrationJob = yamlBlock(ciWorkflow, "db-reset-verify:", 2);
const setupSupabaseStep = yamlBlock(migrationJob, "- name: Setup Supabase CLI", 6);
const restoreSupabaseStep = yamlBlock(migrationJob, "- name: Restore Supabase Docker image cache", 6);
const saveSupabaseStep = yamlBlock(migrationJob, "- name: Save Supabase Docker images", 6);
if (!/^    types: \[opened, synchronize, reopened, ready_for_review\]$/m.test(ciPullRequestTrigger)) {
  failures.push(
    "ci.yml: pull_request events must retain opened/synchronize/reopened and include ready_for_review so undrafting starts required CI.",
  );
}
if (!new RegExp(`^  SUPABASE_CLI_VERSION: ${expectedSupabaseCliVersionPattern}$`, "m").test(ciWorkflow)) {
  failures.push(`ci.yml: global SUPABASE_CLI_VERSION must remain pinned to ${expectedSupabaseCliVersion}.`);
}
if (!/^          version: \$\{\{ env\.SUPABASE_CLI_VERSION \}\}$/m.test(setupSupabaseStep)) {
  failures.push("ci.yml: db-reset-verify Setup Supabase CLI must use the pinned env version.");
}
if (
  !/^        id: supabase-docker-cache$/m.test(restoreSupabaseStep) ||
  !restoreSupabaseStep.includes("supabase-docker-${{ runner.os }}-cli-${{ env.SUPABASE_CLI_VERSION }}-")
) {
  failures.push("ci.yml: db-reset-verify cache step must own the pinned Supabase cache id/key.");
}
if (
  !/^        if: success\(\) && steps\.supabase-docker-cache\.outputs\.cache-hit != 'true'$/m.test(saveSupabaseStep)
) {
  failures.push("ci.yml: db-reset-verify save step must be gated by its own cache-hit output.");
}

if (/\bversion:\s*latest\b/.test(ciWorkflow)) {
  failures.push("ci.yml: required workflow tooling must not use version: latest.");
}

const sastWorkflowPath = path.join(workflowDir, "sast.yml");
const sastWorkflow = readFileSync(sastWorkflowPath, "utf8");
const semgrepJob = yamlBlock(sastWorkflow, "semgrep:", 2);
const semgrepScanStep = yamlBlock(semgrepJob, "- name: Semgrep scan", 6);
if (/^    continue-on-error:\s*true\s*$/m.test(semgrepJob)) {
  failures.push("sast.yml: only the Semgrep scan step may be advisory; job setup failures must block.");
}
if (!/^        continue-on-error:\s*true\s*$/m.test(semgrepScanStep)) {
  failures.push("sast.yml: the Semgrep scan step must remain advisory while registry rules are mutable.");
}
if (!/^          src worker scripts eslint-rules supabase\/functions\s*$/m.test(semgrepScanStep)) {
  failures.push(
    "sast.yml: the Semgrep scan command must target src, worker, scripts, eslint-rules, and supabase/functions.",
  );
}

// Maturity X4: the untrusted-document parsing surface has a BLOCKING Semgrep
// gate — the inverse policy of the advisory repo-wide job above. yamlBlock
// returns "" when the job is missing, so every assertion below fails closed.
const semgrepGateJob = yamlBlock(ciWorkflow, "ingestion-sast:", 2);
const semgrepGateStep = yamlBlock(semgrepGateJob, "- name: Semgrep scan (blocking)", 6);
if (!semgrepGateJob) {
  failures.push("ci.yml: the ingestion-sast job must exist (maturity X4).");
}
if (/^\s*continue-on-error\s*:/m.test(semgrepGateJob)) {
  failures.push("ci.yml: the Semgrep ingestion gate must block — no continue-on-error anywhere in the job.");
}
for (const target of [
  "worker",
  "src/lib/ingestion*.ts",
  "src/lib/extractors",
  "src/app/api/ingestion",
  "src/app/api/upload",
]) {
  if (!semgrepGateStep.includes(target)) {
    failures.push(`ci.yml: the ingestion gate must keep scanning ${target}.`);
  }
}
if (!semgrepGateStep.includes("--config p/python")) {
  failures.push("ci.yml: the ingestion gate must include p/python for the worker OCR stack.");
}
if (!/^      image: semgrep\/semgrep@sha256:[0-9a-f]{64}\s*$/m.test(semgrepGateJob)) {
  failures.push("ci.yml: the blocking ingestion gate container must be digest-pinned (semgrep/semgrep@sha256:...).");
}

// One SHA per action across every workflow AND composite action. Dependabot bumps
// one file at a time, so a laggard can sit on an old major indefinitely; because
// the per-line validation above only covers workflows, a composite skew (e.g.
// setup-node v5 vs v7) was previously invisible. Assert each action name resolves
// to a single SHA everywhere it is used.
const actionPinPattern = /uses:\s*([^@\s]+)@([0-9a-f]{40})(?:\s*#\s*(\S+))?/;
const shasByAction = new Map();
for (const filePath of discoverGitHubActionFiles(process.cwd())) {
  const fileName = path.relative(process.cwd(), filePath).replaceAll("\\", "/");
  // Workflow lines are already run through validateActionReference in the first
  // pass; composite files are not, so validate them here. Without this, a
  // non-SHA composite reference (e.g. vendor/action@v1) matches neither the
  // 40-hex actionPinPattern below nor the first pass, so it would slip through
  // unpinned. Local `./` refs are correctly ignored by validateActionReference.
  const isComposite = fileName.startsWith(".github/actions/");
  readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .forEach((line, index) => {
      if (isComposite) {
        const actionFailure = validateActionReference(line);
        if (actionFailure) failures.push(`${fileName}:${index + 1}: ${actionFailure}`);
      }
      const match = actionPinPattern.exec(line);
      if (!match) return;
      const [, name, sha, version] = match;
      if (!shasByAction.has(name)) shasByAction.set(name, new Map());
      const bySha = shasByAction.get(name);
      if (!bySha.has(sha)) bySha.set(sha, { version: version ?? "(no version)", locations: [] });
      bySha.get(sha).locations.push(`${fileName}:${index + 1}`);
    });
}
for (const [name, bySha] of shasByAction) {
  if (bySha.size <= 1) continue;
  const detail = [...bySha.values()]
    .map(({ version, locations }) => `${version} (${locations.join(", ")})`)
    .join(" vs ");
  failures.push(
    `${name} is pinned to ${bySha.size} different SHAs across workflows/composites — standardize on one: ${detail}`,
  );
}

if (failures.length > 0) {
  console.error("GitHub Actions pin check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("GitHub Actions pin check passed.");
