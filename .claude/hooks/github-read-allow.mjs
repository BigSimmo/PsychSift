#!/usr/bin/env node
// PreToolUse (Bash) — let read-only GitHub lookups run without a permission prompt.
//
// Why: `gh api` used to sit in the settings `ask` list, so every thread that checked
// CI or review state (`gh api repos/BigSimmo/PsychSift/pulls/N`, check-runs, job
// logs, review comments) stopped on a prompt. A prefix rule cannot tell
// `gh api repos/…/pulls/1` from `gh api repos/…/pulls/1/merge -X PUT`, so the ask
// rule is replaced by this hook, which parses the command and decides:
//
//   "allow" — every segment is a proven read: a read-only `gh` subcommand, a
//             GET-only `gh api` call on this repository, `cd <dir>`, or a pure
//             stdout filter (jq, head, tail, grep, wc, cut, tr, true).
//   "ask"   — the command mentions `gh api` but is not proven read-only. This is
//             what the removed ask rule did, and a hook "ask" prompts even in
//             auto mode. Writes (-X POST, -f, -F, --field, --raw-field, --input,
//             graphql) always land here.
//   nothing — any other command goes through the normal permission flow, so
//             `gh pr merge`, `gh pr create` (still an ask rule), pushes, and
//             workflow dispatch are untouched.
//
// Anything the parser does not understand (substitution, redirection to a file,
// backgrounding, env-var prefixes, unquoted brace expansion) is not proven, so it
// can never be allowed. Contract: a parse failure never fails the tool call.

import { pathToFileURL } from "node:url";

const REPO_PATH = /^\/?repos\/(?:bigsimmo\/psychsift|\{owner\}\/\{repo\})(?:[/?#]|$)/i;

const GH_READ_SUBCOMMANDS = {
  pr: new Set(["view", "list", "diff", "checks", "status"]),
  run: new Set(["view", "list", "watch"]),
  issue: new Set(["view", "list", "status"]),
  workflow: new Set(["view", "list"]),
  repo: new Set(["view"]),
  release: new Set(["view", "list"]),
  search: new Set(["prs", "issues", "commits"]),
  auth: new Set(["status"]),
};

const FILTERS = new Set(["jq", "head", "tail", "grep", "wc", "cut", "tr", "true"]);
const HARMLESS_REDIRECTS = new Set(["2>&1", "2>/dev/null", ">/dev/null"]);

/**
 * Minimal POSIX-shell lexer. Returns segments (arrays of words) split on `|`, `||`,
 * `&&` and `;`, or null when the command uses anything this hook will not reason
 * about. Each word carries `text` (quotes removed) and `bare` (the characters that
 * appeared unquoted), so glob and brace characters can be judged by position.
 */
export function lex(command) {
  const segments = [];
  let words = [];
  let word = null;
  const flushWord = () => {
    if (word) words.push(word);
    word = null;
  };
  const flushSegment = () => {
    flushWord();
    if (words.length === 0) return false;
    segments.push(words);
    words = [];
    return true;
  };
  const ensureWord = () => {
    if (!word) word = { text: "", bare: "" };
    return word;
  };

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (ch === "'") {
      const end = command.indexOf("'", i + 1);
      if (end === -1) return null;
      ensureWord().text += command.slice(i + 1, end);
      i = end;
    } else if (ch === '"') {
      let j = i + 1;
      let text = "";
      for (; j < command.length && command[j] !== '"'; j += 1) {
        const c = command[j];
        if (c === "$" || c === "`") return null;
        if (c === "\\" && j + 1 < command.length && '"\\$`'.includes(command[j + 1])) {
          text += command[j + 1];
          j += 1;
        } else if (c === "\\" && command[j + 1] === "\n") {
          j += 1;
        } else {
          text += c;
        }
      }
      if (j >= command.length) return null;
      ensureWord().text += text;
      i = j;
    } else if (ch === "\\") {
      if (i + 1 >= command.length) return null;
      if (command[i + 1] === "\n") {
        i += 1;
        continue;
      }
      ensureWord().text += command[i + 1];
      i += 1;
    } else if (ch === " " || ch === "\t") {
      flushWord();
    } else if (ch === "|" || ch === ";" || ch === "\n") {
      if (ch === "|" && command[i + 1] === "|") i += 1;
      if (ch === "|" && command[i + 1] === "&") return null;
      if (!flushSegment()) return null;
    } else if (ch === "&") {
      if (command[i + 1] !== "&") {
        // Only the `2>&1` redirect may carry a lone `&`.
        if (word && word.text === "2>" && command[i + 1] === "1") {
          word.text += "&1";
          word.bare += "&1";
          i += 1;
          continue;
        }
        return null;
      }
      i += 1;
      if (!flushSegment()) return null;
    } else if ("$`()<>{}!#~".includes(ch)) {
      if (ch === ">" || ch === "{" || ch === "}") {
        // Judged later: harmless redirects and `{owner}`/`{repo}` placeholders.
        const w = ensureWord();
        w.text += ch;
        w.bare += ch;
        continue;
      }
      if (ch === "#" && word) {
        // Mid-word `#` is literal (URL fragments); only a word-initial `#` comments.
        word.text += ch;
        continue;
      }
      return null;
    } else {
      const w = ensureWord();
      w.text += ch;
      if ("*?[]".includes(ch)) w.bare += ch;
    }
  }
  if (!flushSegment() && segments.length > 0) return null;
  return segments.length > 0 ? segments : null;
}

/** True when a word carries no unquoted glob, brace, or redirect characters. */
function plain(word) {
  return word.bare === "";
}

function stripRedirects(segment) {
  const kept = [];
  for (const word of segment) {
    if (word.bare.includes(">")) {
      if (!HARMLESS_REDIRECTS.has(word.text) || word.bare.replace(/[0-9&]/g, "") !== ">") return null;
      continue;
    }
    kept.push(word);
  }
  return kept;
}

function endpointIsReadable(word) {
  if (!REPO_PATH.test(word.text)) return false;
  // Unquoted braces are allowed only as gh's own {owner}/{repo}/{branch} placeholders,
  // which bash leaves literal. Unquoted globs are allowed only after the fixed repo
  // prefix, so no expansion can turn the endpoint into a flag.
  const bare = word.bare.replace(/[{}]/g, "");
  if (/[{}]/.test(word.text.replace(/\{(?:owner|repo|branch)\}/g, ""))) return false;
  return /^[*?[\]]*$/.test(bare) && !word.text.startsWith("-");
}

const API_VALUE_FLAGS = new Set(["--jq", "-q", "--template", "-t", "--cache"]);
const API_BARE_FLAGS = new Set(["--paginate", "--slurp", "--include", "-i", "--silent", "--verbose"]);

function headerIsSafe(value) {
  return /^(accept|x-github-api-version)\s*:/i.test(value);
}

export function ghApiIsRead(args) {
  let endpoint = null;
  for (let i = 0; i < args.length; i += 1) {
    const word = args[i];
    const text = word.text;
    if (!text.startsWith("-")) {
      if (endpoint) return false;
      endpoint = word;
      continue;
    }
    if (!plain(word)) return false;
    const eq = text.indexOf("=");
    const name = text.startsWith("--") && eq !== -1 ? text.slice(0, eq) : text;
    const inline = text.startsWith("--") && eq !== -1 ? text.slice(eq + 1) : null;
    const takeValue = () => {
      if (inline !== null) return inline;
      i += 1;
      return i < args.length ? args[i].text : null;
    };
    if (name === "-X" || name === "--method") {
      if (takeValue()?.toUpperCase() !== "GET") return false;
    } else if (/^-X./.test(name)) {
      if (name.slice(2).toUpperCase() !== "GET") return false;
    } else if (name === "-H" || name === "--header") {
      const value = takeValue();
      if (value === null || !headerIsSafe(value)) return false;
    } else if (API_VALUE_FLAGS.has(name)) {
      if (takeValue() === null) return false;
    } else if (/^-[qt]./.test(name)) {
      // -q'.expr' / -t'{{...}}' written without a space.
    } else if (API_BARE_FLAGS.has(name) && inline === null) {
      // no value
    } else {
      // -f, -F, --field, --raw-field, --input, --hostname, --preview and anything unknown.
      return false;
    }
  }
  return endpoint !== null && endpointIsReadable(endpoint);
}

function segmentIsRead(segment) {
  const words = stripRedirects(segment);
  if (!words || words.length === 0) return { ok: false };
  const [head, ...rest] = words;
  if (!plain(head)) return { ok: false };
  if (head.text === "cd") return { ok: rest.length <= 1 && rest.every(plain), gh: false };
  if (FILTERS.has(head.text)) return { ok: rest.every(plain), gh: false };
  if (head.text !== "gh") return { ok: false };
  const [sub, action, ...args] = rest;
  if (!sub || !plain(sub)) return { ok: false };
  if (sub.text === "api") {
    return { ok: ghApiIsRead(rest.slice(1)), gh: true };
  }
  const actions = GH_READ_SUBCOMMANDS[sub.text];
  if (!actions || !action || !plain(action) || !actions.has(action.text)) return { ok: false };
  return { ok: args.every(plain), gh: true };
}

const GH_API_TEXT = /(^|[\s;&|(`"'])gh\s+api\b/;

/**
 * Does the command reach `gh api` anywhere: as a segment head, behind a wrapper
 * (`timeout 30 gh api`, `xargs gh api`), or inside a string a shell may run
 * (`bash -c "gh api …"`)? Over-matching only costs a prompt, which is what the
 * removed ask rule did for every `gh api` call.
 */
function mentionsGhApi(command, segments) {
  if (!segments) return GH_API_TEXT.test(command);
  return segments.some((words) =>
    words.some((w, i) => (w.text === "gh" && words[i + 1]?.text === "api") || GH_API_TEXT.test(w.text)),
  );
}

/** "allow", "ask", or null (no decision). */
export function decide(command) {
  if (typeof command !== "string" || !/\bgh\b/.test(command)) return null;
  const segments = lex(command);
  if (segments) {
    const results = segments.map(segmentIsRead);
    if (results.every((r) => r.ok) && results.some((r) => r.gh)) return "allow";
  }
  return mentionsGhApi(command, segments) ? "ask" : null;
}

function main(raw) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }
  if (payload?.tool_name && payload.tool_name !== "Bash") return;
  const decision = decide(payload?.tool_input?.command);
  if (!decision) return;
  const reason =
    decision === "allow"
      ? "Read-only GitHub lookup (github-read-allow hook)"
      : "gh api call not proven read-only; confirm before running (github-read-allow hook)";
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    }),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (raw += chunk));
  process.stdin.on("end", () => {
    try {
      main(raw);
    } catch {
      // Never fail a tool call by accident: no decision.
    }
  });
}
