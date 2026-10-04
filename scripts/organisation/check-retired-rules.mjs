#!/usr/bin/env node
// Retired-rules check (organisation framework, suggestion 1). When the owner drops a rule, its key
// phrase goes on docs/organisation/retired-rules.json. This check flags any live instruction file
// (AGENTS.md, CLAUDE.md, the agent guides, skills and agent definitions) that still states one of
// those rules as current, so agents stop following instructions that no longer apply.
//
// A line hits a rule when it matches the rule's `pattern` and does not match its `allowedContext`
// (wording that records the retirement, such as "there is no ... gate" or "no longer"). Matching is
// case-insensitive and line by line, so a statement wrapped across two lines is not seen.
//
// Limits, stated plainly: it catches each rule's key phrases only. A paraphrase that avoids them
// passes, and so does any line that also contains one of the rule's excuse words, even when the
// line restates the rule. It is a tripwire for copied wording, not a reader of meaning.
//
// Modes:
//   (no arguments)              every in-scope file in the working tree, tracked or new (local use)
//   --base <sha> --head <sha>   only the lines the change adds to in-scope files (CI); rules the
//                               change itself adds or edits are also checked across the whole head
//   INSTRUCTIONS_CHECK_MODE=ci  the same, reading BASE_SHA and HEAD_SHA from the environment
//   --paths <file|folder...>    any files, in or out of scope (for example the coordinator's notes)
// Options: --root <repo>, --rules <file> (default docs/organisation/retired-rules.json).
// Exit: 0 no hits, 1 a hit (file:line, rule id and summary are printed), 2 bad input.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BadInput,
  git,
  gitText,
  looksBinary,
  normalisedText,
  parseInstructionArgs,
  readAtCommit,
  readManyAtCommit,
  resolveRange,
} from "./instruction-checks-shared.mjs";

export const RULES_FILE = "docs/organisation/retired-rules.json";

/** The live instruction files: exact files, and folders (ending in "/") whose files all count. */
export const INSTRUCTION_SCOPE = Object.freeze([
  "AGENTS.md",
  "CLAUDE.md",
  "docs/agents-guide.md",
  "docs/codex-review-protocol.md",
  ".github/pull_request_template.md",
  ".agents/README.md",
  "docs/agents/",
  ".claude/skills/",
  ".claude/agents/",
  ".claude/cloud-profile/",
  ".agents/skills/",
  ".cursor/agents/",
  ".cursor/skills/",
]);

const PATHSPECS = INSTRUCTION_SCOPE.map((entry) => `:(literal)${entry.replace(/\/$/, "")}`);
const RULE_KEYS = new Set(["id", "retired", "summary", "pattern", "allowedContext", "record"]);
const REQUIRED_RULE_KEYS = ["id", "retired", "summary", "pattern", "allowedContext"];
const EXCERPT_MAX = 160;

export function isInstructionFile(file) {
  const normal = file.replaceAll("\\", "/");
  return INSTRUCTION_SCOPE.some((entry) => (entry.endsWith("/") ? normal.startsWith(entry) : normal === entry));
}

function compile(source, where, field) {
  if (typeof source !== "string" || source.trim() === "") throw new BadInput(`${where}: "${field}" must be a regex`);
  let regex;
  try {
    regex = new RegExp(source, "i");
  } catch (error) {
    throw new BadInput(`${where}: "${field}" is not a valid regex: ${error.message}`);
  }
  // A regex that matches an empty line would hit (or excuse) every line in every file.
  if (regex.test("")) throw new BadInput(`${where}: "${field}" matches an empty line, so it would match everything`);
  return regex;
}

function validDate(text) {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, d] = text.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Validate and compile the retired-rules list. Throws BadInput on anything malformed. */
export function loadRetiredRules(text, source = RULES_FILE) {
  if (text === null || text === undefined) throw new BadInput(`${source} is missing`);
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new BadInput(`${source} is not valid JSON: ${error.message}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new BadInput(`${source} must be a JSON object`);
  for (const key of Object.keys(data)) {
    if (key !== "version" && key !== "rules") throw new BadInput(`${source}: unknown key "${key}"`);
  }
  if (data.version !== 1) throw new BadInput(`${source}: version ${JSON.stringify(data.version)} is not supported`);
  if (!Array.isArray(data.rules)) throw new BadInput(`${source}: "rules" must be a list`);
  const seen = new Set();
  return data.rules.map((rule, index) => {
    const where = `${source} rule ${index + 1}`;
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) throw new BadInput(`${where} must be an object`);
    for (const key of Object.keys(rule)) {
      if (!RULE_KEYS.has(key)) throw new BadInput(`${where}: unknown key "${key}"`);
    }
    for (const key of REQUIRED_RULE_KEYS) {
      if (!(key in rule)) throw new BadInput(`${where}: "${key}" is required`);
    }
    if (typeof rule.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(rule.id)) {
      throw new BadInput(`${where}: "id" must be lower-case words joined by hyphens`);
    }
    if (seen.has(rule.id)) throw new BadInput(`${where}: duplicate id "${rule.id}"`);
    seen.add(rule.id);
    if (!validDate(rule.retired)) throw new BadInput(`${where}: "retired" must be a real date written YYYY-MM-DD`);
    if (typeof rule.summary !== "string" || rule.summary.trim() === "") {
      throw new BadInput(`${where}: "summary" must say what was retired`);
    }
    if ("record" in rule && (typeof rule.record !== "string" || rule.record.trim() === "")) {
      throw new BadInput(`${where}: "record", when present, must say where the repo records the retirement`);
    }
    return {
      id: rule.id,
      retired: rule.retired,
      summary: rule.summary,
      record: rule.record ?? null,
      pattern: rule.pattern,
      allowedContext: rule.allowedContext,
      regex: compile(rule.pattern, where, "pattern"),
      allowed: compile(rule.allowedContext, where, "allowedContext"),
    };
  });
}

/** Split a file's text into numbered lines. */
export function textLines(file, text) {
  return text.split(/\r?\n/).map((line, index) => ({ file, line: index + 1, text: line }));
}

/**
 * Sentences on one line. An excuse in a later sentence must not pardon a
 * restatement of the retired rule in an earlier sentence on that same line.
 */
export function lineSentences(line) {
  const sentences = String(line)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  return sentences.length > 0 ? sentences : [String(line)];
}

/** Every line that states a retired rule as current. */
export function findRetiredRuleHits(lines, rules) {
  const hits = [];
  for (const entry of lines) {
    const sentences = lineSentences(entry.text);
    for (const rule of rules) {
      const hit = sentences.some((sentence) => rule.regex.test(sentence) && !rule.allowed.test(sentence));
      if (!hit) continue;
      const trimmed = entry.text.trim();
      hits.push({
        file: entry.file,
        line: entry.line,
        ruleId: rule.id,
        summary: rule.summary,
        retired: rule.retired,
        excerpt: trimmed.length > EXCERPT_MAX ? `${trimmed.slice(0, EXCERPT_MAX - 1)}…` : trimmed,
      });
    }
  }
  return hits;
}

function unquoteGitPath(text) {
  if (!text.startsWith('"')) return text;
  const bytes = [];
  const escapes = { n: 10, t: 9, r: 13, b: 8, f: 12, a: 7, v: 11, '"': 34, "\\": 92 };
  for (let i = 1; i < text.length - 1; i++) {
    const char = text[i];
    if (char !== "\\") {
      bytes.push(...Buffer.from(char, "utf8"));
      continue;
    }
    const next = text[i + 1];
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(text.slice(i + 1, i + 4), 8));
      i += 3;
    } else {
      bytes.push(escapes[next] ?? next.charCodeAt(0));
      i += 1;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

/**
 * The lines a unified diff adds, with their line numbers in the new file. Expects
 * `git diff --unified=0 --src-prefix=a/ --dst-prefix=b/` output; deleted files add nothing.
 */
export function parseAddedLines(diffText) {
  const added = [];
  let file = null;
  let oldLeft = 0;
  let newLeft = 0;
  let lineNo = 0;
  for (const raw of diffText.split("\n")) {
    if (oldLeft > 0 || newLeft > 0) {
      if (raw.startsWith("\\")) continue; // "\ No newline at end of file"
      if (raw.startsWith("+")) {
        if (file) added.push({ file, line: lineNo, text: raw.slice(1).replace(/\r$/, "") });
        lineNo++;
        newLeft--;
      } else if (raw.startsWith("-")) oldLeft--;
      else {
        lineNo++;
        oldLeft--;
        newLeft--;
      }
      continue;
    }
    if (raw.startsWith("diff --git ")) file = null;
    else if (raw.startsWith("+++ ")) {
      const target = unquoteGitPath(raw.slice(4).replace(/\t$/, ""));
      file = target === "/dev/null" ? null : target.replace(/^b\//, "");
    } else if (raw.startsWith("@@")) {
      const match = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
      if (!match) throw new BadInput(`unreadable diff hunk header: ${raw.slice(0, 80)}`);
      oldLeft = match[1] === undefined ? 1 : Number(match[1]);
      lineNo = Number(match[2]);
      newLeft = match[3] === undefined ? 1 : Number(match[3]);
    }
  }
  return added;
}

function linesOfBuffers(entries) {
  const lines = [];
  let files = 0;
  for (const [file, buffer] of entries) {
    if (looksBinary(buffer)) continue;
    files++;
    lines.push(...textLines(file, normalisedText(buffer)));
  }
  return { lines, files };
}

function workingTreeLines(root) {
  const listed = gitText(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...PATHSPECS]);
  const files = [...new Set(listed.split("\0").filter(Boolean))].filter(isInstructionFile).sort();
  const entries = [];
  for (const file of files) {
    const full = path.join(root, file);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue; // tracked but deleted in the working tree
    }
    if (stat.isFile()) entries.push([file, fs.readFileSync(full)]);
  }
  return linesOfBuffers(entries);
}

function commitLines(root, commit) {
  const listed = gitText(root, ["ls-tree", "-r", "-z", "--name-only", commit, "--", ...PATHSPECS]);
  const files = listed.split("\0").filter(Boolean).filter(isInstructionFile).sort();
  return linesOfBuffers(readManyAtCommit(root, commit, files));
}

function collectPath(target, display, entries) {
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    throw new BadInput(`${display} does not exist`);
  }
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(target).sort()) {
      if (name === ".git" || name === "node_modules") continue;
      collectPath(path.join(target, name), path.join(display, name), entries);
    }
  } else if (stat.isFile()) entries.push([display.replaceAll("\\", "/"), fs.readFileSync(target)]);
}

function ruleKey(rule) {
  return JSON.stringify([rule.pattern, rule.allowedContext]);
}

/**
 * Run the check. Options: { root, mode: "tree"|"range"|"paths", base, head, paths, rulesPath, cwd }.
 * Returns { exitCode, scope, hits, files, lines, rules, error }.
 */
export function runRetiredRulesCheck(options) {
  const { root, mode, cwd = process.cwd() } = options;
  const result = { exitCode: 0, scope: "", hits: [], files: 0, lines: 0, rules: 0, error: null };
  try {
    const customRules = options.rulesPath ? path.resolve(cwd, options.rulesPath) : null;
    const readRulesFile = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);
    let rules;
    let lines;
    if (mode === "range") {
      const { head, mergeBase } = resolveRange(root, options.base, options.head);
      // A branch older than this check has no rules file at its head: judge it by the checkout's
      // copy (in CI, the merge with the base), so an open PR is never failed for predating the list.
      const headRules = customRules ? null : readAtCommit(root, head, RULES_FILE);
      const rulesFromCheckout = !customRules && headRules === null;
      rules = customRules
        ? loadRetiredRules(readRulesFile(customRules), options.rulesPath)
        : rulesFromCheckout
          ? loadRetiredRules(readAtCommit(root, "HEAD", RULES_FILE), `${RULES_FILE} in the checkout`)
          : loadRetiredRules(headRules, `${RULES_FILE} at ${head.slice(0, 9)}`);
      if (mergeBase === null) {
        const whole = commitLines(root, head);
        result.scope = `every in-scope file at ${head.slice(0, 9)} (new branch: no base to compare with)`;
        result.files = whole.files;
        lines = whole.lines;
        result.hits = findRetiredRuleHits(lines, rules);
      } else {
        const diff = gitText(root, [
          "diff",
          "--unified=0",
          "--no-color",
          "--no-ext-diff",
          "--find-renames",
          "--src-prefix=a/",
          "--dst-prefix=b/",
          mergeBase,
          head,
          "--",
          ...PATHSPECS,
        ]);
        lines = parseAddedLines(diff).filter((entry) => isInstructionFile(entry.file));
        result.files = new Set(lines.map((entry) => entry.file)).size;
        result.scope = `lines added to instruction files since ${mergeBase.slice(0, 9)} (head ${head.slice(0, 9)})`;
        result.hits = findRetiredRuleHits(lines, rules);
        // A rule this change adds or edits is the change's own doing: check it everywhere, so the
        // PR that retires a rule also clears the places that still state it.
        let baseKeys = new Set();
        if (!customRules) {
          try {
            baseKeys = new Set(loadRetiredRules(readAtCommit(root, mergeBase, RULES_FILE)).map(ruleKey));
          } catch {
            baseKeys = new Set();
          }
        }
        // The sweep is for the change that edits the list; a branch without the list edits nothing.
        const changed = customRules || rulesFromCheckout ? [] : rules.filter((rule) => !baseKeys.has(ruleKey(rule)));
        if (changed.length > 0) {
          const whole = commitLines(root, head);
          const known = new Set(result.hits.map((hit) => `${hit.file}:${hit.line}:${hit.ruleId}`));
          for (const hit of findRetiredRuleHits(whole.lines, changed)) {
            if (!known.has(`${hit.file}:${hit.line}:${hit.ruleId}`)) result.hits.push(hit);
          }
          result.scope += `; new or edited rules (${changed.map((rule) => rule.id).join(", ")}) across all ${whole.files} in-scope files at the head`;
        }
      }
    } else if (mode === "paths") {
      rules = loadRetiredRules(
        readRulesFile(customRules ?? path.join(root, RULES_FILE)),
        options.rulesPath ?? RULES_FILE,
      );
      const entries = [];
      for (const given of options.paths) collectPath(path.resolve(cwd, given), given, entries);
      const collected = linesOfBuffers(entries);
      lines = collected.lines;
      result.files = collected.files;
      result.scope = `${options.paths.length} given path(s)`;
      result.hits = findRetiredRuleHits(lines, rules);
    } else {
      rules = loadRetiredRules(
        readRulesFile(customRules ?? path.join(root, RULES_FILE)),
        options.rulesPath ?? RULES_FILE,
      );
      git(root, ["rev-parse", "--is-inside-work-tree"]);
      const whole = workingTreeLines(root);
      lines = whole.lines;
      result.files = whole.files;
      result.scope = "every in-scope file in the working tree";
      result.hits = findRetiredRuleHits(lines, rules);
    }
    result.lines = lines.length;
    result.rules = rules.length;
    result.hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.ruleId.localeCompare(b.ruleId));
    result.exitCode = result.hits.length > 0 ? 1 : 0;
  } catch (error) {
    if (!(error instanceof BadInput)) throw error;
    result.error = error.message;
    result.exitCode = 2;
  }
  return result;
}

/** Human-readable report lines (and GitHub annotations when asked). */
export function formatRetiredRulesReport(result, { annotate = false } = {}) {
  const out = [];
  if (result.exitCode === 2) {
    out.push(`retired-rules: exit 2 (could not check) — ${result.error}`);
    return out;
  }
  if (result.hits.length === 0) {
    out.push(
      `retired-rules: pass — ${result.lines} line(s) in ${result.files} file(s) checked against ${result.rules} retired rule(s); ${result.scope}`,
    );
    return out;
  }
  out.push(
    `retired-rules: exit 1 — ${result.hits.length} line(s) still state a retired rule as current; ${result.scope}`,
  );
  for (const hit of result.hits) {
    out.push(`  ${hit.file}:${hit.line} [${hit.ruleId}] ${hit.summary} (retired ${hit.retired})`);
    out.push(`      > ${hit.excerpt}`);
    if (annotate) {
      const message = `${hit.summary} (retired ${hit.retired}). Reword the line or say the rule was retired.`;
      out.push(`::error file=${hit.file},line=${hit.line},title=Retired rule ${hit.ruleId}::${message}`);
    }
  }
  out.push(
    `  Fix: reword each line so it no longer states the rule as current, or say plainly that it was retired (that wording is what each rule's allowedContext accepts). The list is ${RULES_FILE}.`,
  );
  return out;
}

export function defaultRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function main(argv = process.argv.slice(2), env = process.env) {
  let args;
  try {
    args = parseInstructionArgs(argv, env, { allow: ["rules", "paths"] });
  } catch (error) {
    if (!(error instanceof BadInput)) throw error;
    console.log(`retired-rules: exit 2 (could not check) — ${error.message}`);
    return 2;
  }
  const root = args.root ? path.resolve(args.root) : defaultRoot();
  const result = runRetiredRulesCheck({ ...args, root, rulesPath: args.rules });
  const annotate = env.GITHUB_ACTIONS === "true" && args.mode !== "paths";
  for (const line of formatRetiredRulesReport(result, { annotate })) console.log(line);
  return result.exitCode;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`retired-rules: checker crashed: ${error?.stack ?? error}`);
    process.exitCode = 2;
  }
}
