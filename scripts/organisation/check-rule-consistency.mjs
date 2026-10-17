#!/usr/bin/env node
// Focused contracts for reviewed active client routes and the installed Semgrep seed.
// This is not a semantic policy audit or proof that a hosted client loaded these files.
// Archives and unrelated specialist programmes are deliberately outside this inventory.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SEMGREP_ROOT = ".claude/cloud-profile/skills/semgrep/";
export const RULE_CONSISTENCY_FILES = Object.freeze([
  "CLAUDE.md",
  ".claude/agents/verification-router.md",
  ".claude/agents/frontend-ui-reviewer.md",
  ".claude/agents/ingestion-worker-reviewer.md",
  ".claude/skills/gates/SKILL.md",
  ".cursor/skills/release-readiness-review/SKILL.md",
  ".claude/hooks/pr-handoff-stop.sh",
  ".claude/skills/prompt/SKILL.md",
  ".claude/cloud-profile/skills/prompt/SKILL.md",
  ".agents/skills/prompt-perfector/SKILL.md",
  `${SEMGREP_ROOT}SKILL.md`,
  `${SEMGREP_ROOT}workflows/scan-workflow.md`,
  `${SEMGREP_ROOT}references/rulesets.md`,
  `${SEMGREP_ROOT}references/scanner-task-prompt.md`,
  `${SEMGREP_ROOT}scripts/scan-status.sh`,
]);

function markdownFiles(root, directory) {
  const full = path.join(root, directory);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    const file = `${directory.replace(/\/$/, "")}/${entry.name}`;
    if (entry.isDirectory()) return markdownFiles(root, file);
    return entry.isFile() && file.endsWith(".md") ? [file] : [];
  });
}

/** @param {string} root @returns {Record<string, string>} */
export function readRuleConsistencyFiles(root) {
  const names = new Set([
    ...RULE_CONSISTENCY_FILES,
    ...markdownFiles(root, SEMGREP_ROOT),
    ...markdownFiles(root, ".claude/agents"),
  ]);
  return Object.fromEntries(
    [...names].sort().flatMap((file) => {
      const full = path.join(root, file);
      return fs.existsSync(full) ? [[file, fs.readFileSync(full, "utf8")]] : [];
    }),
  );
}

// Include raw shell examples and inline commands, joining shell continuations first.
// Mere prose, `command -v semgrep`, and catalog names are not invocations.
export function semgrepCommands(text) {
  const commands = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = index + 1;
    let source = lines[index];
    while (/\\\s*$/.test(source) && index + 1 < lines.length) {
      source = source.replace(/\\\s*$/, " ") + lines[++index].trim();
    }
    // Inline code fragments are separate commands; one fragment's flag cannot
    // pardon a different command on the same prose line.
    const fragments = source.includes("`") ? source.split("`").filter((_, part) => part % 2 === 1) : [source];
    for (const fragment of fragments) {
      const pattern = /\bsemgrep\s+(?=--|\[--|scan\b|ci\b)/g;
      const matches = [...fragment.matchAll(pattern)];
      for (const [position, match] of matches.entries()) {
        commands.push({
          line,
          text: fragment.slice(match.index, matches[position + 1]?.index).trim(),
          source: fragment,
        });
      }
    }
  }
  return commands;
}

export function findRuleConsistencyProblems(files) {
  const problems = [];
  const add = (file, rule, message, line = 1) => problems.push({ file, line, rule, message });
  const requireText = (file, pattern, rule, message) => {
    if (files[file] !== undefined && !pattern.test(files[file])) add(file, rule, message);
  };
  for (const file of RULE_CONSISTENCY_FILES) {
    if (files[file] === undefined) add(file, "missing-active-source", "Required active instruction source is missing");
  }
  for (const file of [
    "CLAUDE.md",
    ".claude/agents/verification-router.md",
    ".cursor/skills/release-readiness-review/SKILL.md",
  ]) {
    requireText(
      file,
      /verification-gates\.md#gate-selection/,
      "canonical-gate-route",
      "Link the canonical gate selector",
    );
    requireText(
      file,
      /check:production-readiness:ci/,
      "routine-readiness",
      "Routine readiness/configuration proof must use the structural :ci route",
    );
    requireText(
      file,
      /production release or\s+activation/,
      "release-approvals",
      "Retain the strict release/activation boundary",
    );
  }
  const frontend = ".claude/agents/frontend-ui-reviewer.md";
  requireText(
    frontend,
    /verification-gates\.md#gate-selection/,
    "canonical-ui-route",
    "Link the canonical UI selector",
  );
  requireText(
    frontend,
    /changed owner or journey first/,
    "focused-ui-first",
    "Prove the changed owner or journey first",
  );
  requireText(
    frontend,
    /shared UI foundations.*PR\/handoff policy/,
    "required-broad-ui",
    "Retain shared-foundation and required handoff gates",
  );
  const worker = ".claude/agents/ingestion-worker-reviewer.md";
  requireText(
    worker,
    /current-host capabilities/,
    "worker-capabilities",
    "Inspect current-host capabilities before worker checks",
  );
  if (/does not run in this VM/.test(files[worker] ?? ""))
    add(worker, "obsolete-worker-prohibition", "Remove the obsolete universal VM prohibition");
  const gates = ".claude/skills/gates/SKILL.md";
  requireText(
    gates,
    /AGENTS\.md#api-and-provider-confirmation-boundary/,
    "canonical-authorization",
    "Use the canonical provider/shortcut authorization boundary",
  );
  if (/only standing exception/i.test(files[gates] ?? ""))
    add(gates, "exclusive-shortcut-list", "Do not replace the canonical shortcut scopes with an exclusive copied list");
  const hook = ".claude/hooks/pr-handoff-stop.sh";
  requireText(hook, /pull-request-workflow\.md#follow-ci/, "current-hook-policy", "Link the current follow-CI policy");
  requireText(
    hook,
    /current host's supported wait/,
    "hook-wait-capability",
    "Resolve a currently supported bounded wait capability",
  );
  if (/Babysit the pull request, then stop|Use ScheduleWakeup or Monitor/.test(files[hook] ?? ""))
    add(hook, "stale-hook-guidance", "Remove obsolete policy headings and assumed wait tools");

  const prompt = ".claude/skills/prompt/SKILL.md";
  const seed = ".claude/cloud-profile/skills/prompt/SKILL.md";
  const perfector = ".agents/skills/prompt-perfector/SKILL.md";
  requireText(
    prompt,
    /Default for this skill:\*\* refine, show the perfected prompt, then execute/,
    "prompt-execution-default",
    "Preserve and label prompt's refine-and-execute default",
  );
  requireText(
    perfector,
    /^(?:\*\*Default for this skill:\*\* )?[Rr]efine only(?:[.;]|\s+unless)/m,
    "perfector-refinement-default",
    "Preserve and label prompt-perfector's refinement-only default",
  );
  if (files[prompt] !== undefined && files[seed] !== undefined && files[prompt] !== files[seed])
    add(seed, "prompt-seed-drift", "The copied prompt seed must match its repository source");

  const workflow = `${SEMGREP_ROOT}workflows/scan-workflow.md`;
  const scan = files[workflow] ?? "";
  requireText(workflow, /^## Step 3:.*GATE/m, "scan-approval-gate", "Keep the explicit Step 3 scan-plan approval gate");
  requireText(
    workflow,
    /workers are unavailable or delegation is not authorized/,
    "scanner-execution-fallback",
    "Provide bounded direct execution when delegation is unavailable or unauthorized",
  );
  requireText(
    workflow,
    /Network\/provider actions/,
    "scan-network-plan",
    "List registry/Pro/network actions in the exact plan",
  );
  // These active entry/selection sections run before approval. Scanner templates
  // and the explicitly authorized ruleset-verification section run afterwards.
  // Keep this phase inventory explicit; do not infer execution from archived examples.
  const rulesets = `${SEMGREP_ROOT}references/rulesets.md`;
  const skill = `${SEMGREP_ROOT}SKILL.md`;
  const localDiscovery = [
    [workflow, scan.split(/^## Step 3\b/m)[0]],
    [skill, (files[skill] ?? "").split(/^## Scan Modes\b/m)[0]],
    [rulesets, (files[rulesets] ?? "").split(/^### Step 5:/m)[0]],
  ];
  for (const [file, section] of localDiscovery) {
    for (const command of semgrepCommands(section)) {
      if (!/--version\b/.test(command.text) || /--(?:pro|config|validate)\b/.test(command.text))
        add(
          file,
          "network-preflight",
          "Before approval, Semgrep discovery must be local version/installation metadata only",
          command.line,
        );
      if (!/SEMGREP_ENABLE_VERSION_CHECK=0/.test(command.source))
        add(file, "version-network-preflight", "Disable online version checks during local discovery", command.line);
    }
  }
  requireText(
    rulesets,
    /only after authorization/,
    "registry-approval",
    "Registry verification must follow Step 3 network authorization",
  );
  const scanner = `${SEMGREP_ROOT}references/scanner-task-prompt.md`;
  requireText(
    scanner,
    /source \{baseDir\}\/scripts\/scan-status\.sh/,
    "scanner-status-helper",
    "Load the installed scan-status helper before launching jobs",
  );
  requireText(
    scanner,
    /wait_semgrep_scans \[APPROVED_SCAN_COUNT\] \|\| exit 1/,
    "scanner-status-gate",
    "Require every process status and expected result pair before success",
  );
  if (/^\s*wait\s*$/m.test(files[scanner] ?? ""))
    add(scanner, "scanner-bare-wait", "Bare wait discards child failures; use the status/artifact gate");

  const bundledAgents = new Set(
    Object.entries(files)
      .filter(([file]) => file.startsWith(".claude/agents/"))
      .flatMap(([, text]) => {
        const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1] ?? "";
        const names = [...frontmatter.matchAll(/^name:[ \t]*(["']?)([a-z][a-z0-9:-]*)\1[ \t]*$/gm)];
        return names.length === 1 ? [names[0][2]] : [];
      }),
  );
  for (const [file, text] of Object.entries(files)) {
    if (!file.startsWith(SEMGREP_ROOT) || !file.endsWith(".md")) continue;
    for (const command of semgrepCommands(text)) {
      if (!/--metrics=off\b/.test(command.text))
        add(file, "semgrep-metrics", "Every Semgrep command example must disable telemetry", command.line);
    }
    for (const match of text.matchAll(/subagent_type:\s*([a-z][a-z0-9:-]+)/g)) {
      // An optional host-provided specialist with an explicit local fallback is
      // different from an unconditional dependency on an uninstalled plugin.
      const before = text.lastIndexOf("\n\n", match.index);
      const after = text.indexOf("\n\n", match.index);
      const paragraph = text.slice(before < 0 ? 0 : before, after < 0 ? text.length : after);
      const runtimeFallback =
        /\b(?:if|when)\b/i.test(paragraph) &&
        /\bhost\b.*\b(?:exposes|supports|provides)\b/i.test(paragraph) &&
        /\b(?:otherwise|fallback)\b.*\b(?:direct|general-purpose)\b/i.test(paragraph);
      if (!bundledAgents.has(match[1]) && !runtimeFallback)
        add(
          file,
          "unresolved-scanner-agent",
          `Exact agent dependency ${match[1]} is not bundled; use a capability-checked worker/direct fallback`,
          text.slice(0, match.index).split("\n").length,
        );
    }
  }
  return problems;
}

export function main(argv = process.argv.slice(2)) {
  if (argv.length && (argv.length !== 2 || argv[0] !== "--root")) {
    console.error("Usage: check-rule-consistency.mjs [--root <repository>]");
    return 2;
  }
  const root = path.resolve(argv[1] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "../.."));
  const files = readRuleConsistencyFiles(root);
  const problems = findRuleConsistencyProblems(files);
  for (const problem of problems)
    console.error(`${problem.file}:${problem.line}: [${problem.rule}] ${problem.message}`);
  console.log(
    `rule-consistency: ${problems.length ? "FAIL" : "pass"} — ${Object.keys(files).length} active source(s), ${problems.length} problem(s); source contracts only`,
  );
  return problems.length ? 1 : 0;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`rule-consistency: could not check — ${error.message}`);
    process.exitCode = 2;
  }
}
