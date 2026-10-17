import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findRuleConsistencyProblems,
  readRuleConsistencyFiles,
  semgrepCommands,
  SEMGREP_ROOT,
} from "../scripts/organisation/check-rule-consistency.mjs";

const root = path.resolve(__dirname, "..");
const checker = path.join(root, "scripts/organisation/check-rule-consistency.mjs");
const sources = readRuleConsistencyFiles(root);
const workflow = `${SEMGREP_ROOT}workflows/scan-workflow.md`;
const temporary: string[] = [];
const rulesFor = (files: Record<string, string>) => findRuleConsistencyProblems(files).map((problem) => problem.rule);

afterEach(() => {
  for (const directory of temporary.splice(0))
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("active client rule consistency", () => {
  it("accepts the current routes and seed contracts", () => {
    expect(findRuleConsistencyProblems(sources)).toEqual([]);
  });

  it.each(["CLAUDE.md", ".claude/agents/verification-router.md", ".cursor/skills/release-readiness-review/SKILL.md"])(
    "rejects regression from structural readiness to release-only routing in %s",
    (file) => {
      expect(
        rulesFor({
          ...sources,
          [file]: sources[file].replaceAll("check:production-readiness:ci", "check:production-readiness"),
        }),
      ).toContain("routine-readiness");
    },
  );

  it("retains both focused UI proof and required broad gates", () => {
    const file = ".claude/agents/frontend-ui-reviewer.md";
    expect(
      rulesFor({
        ...sources,
        [file]: sources[file].replace("changed owner or journey first", "complete Chromium suite first"),
      }),
    ).toContain("focused-ui-first");
    expect(
      rulesFor({ ...sources, [file]: sources[file].replace("shared UI foundations", "small components") }),
    ).toContain("required-broad-ui");
  });

  it("rejects the obsolete VM prohibition and exclusive shortcut exception", () => {
    const worker = ".claude/agents/ingestion-worker-reviewer.md";
    const gates = ".claude/skills/gates/SKILL.md";
    expect(rulesFor({ ...sources, [worker]: sources[worker] + "\nThe worker does not run in this VM." })).toContain(
      "obsolete-worker-prohibition",
    );
    expect(rulesFor({ ...sources, [gates]: sources[gates] + "\nThe only standing exception is Run PR." })).toContain(
      "exclusive-shortcut-list",
    );
  });

  it("keeps emitted hook policy current and its wait mechanism capability based", () => {
    const file = ".claude/hooks/pr-handoff-stop.sh";
    expect(
      rulesFor({
        ...sources,
        [file]: sources[file].replace("current host's supported wait", "ScheduleWakeup or Monitor"),
      }),
    ).toContain("hook-wait-capability");
    expect(
      rulesFor({ ...sources, [file]: sources[file] + '\ncontext="See Babysit the pull request, then stop"' }),
    ).toContain("stale-hook-guidance");
  });

  it("keeps the two intentional prompt defaults and the copied seed distinct", () => {
    const file = ".agents/skills/prompt-perfector/SKILL.md";
    expect(
      rulesFor({
        ...sources,
        [file]: sources[file]
          .replace("**Default for this skill:** refine only", "**Default for this skill:** execute")
          .replace("Refine only unless evaluation or execution is explicit.", "Execute by default."),
      }),
    ).toContain("perfector-refinement-default");
    const seed = ".claude/cloud-profile/skills/prompt/SKILL.md";
    expect(rulesFor({ ...sources, [seed]: sources[seed] + "\nDifferent default" })).toContain("prompt-seed-drift");
  });

  it("checks newly added Semgrep command examples and inline/continued commands", () => {
    const file = `${SEMGREP_ROOT}references/new-example.md`;
    expect(rulesFor({ ...sources, [file]: "```bash\nsemgrep scan --config ./local-rules.yml\n```" })).toContain(
      "semgrep-metrics",
    );
    expect(semgrepCommands("`semgrep --version` then `semgrep --metrics=off --version`")).toHaveLength(2);
    expect(semgrepCommands("semgrep scan \\\n  --config ./local.yml \\\n  --metrics=off")[0].text).toContain(
      "--metrics=off",
    );
    expect(semgrepCommands("command -v semgrep\nSemgrep rules catalog\n")).toEqual([]);
  });

  it("checks raw commands beside backticks without borrowing another command's flags or environment", () => {
    const file = `${SEMGREP_ROOT}references/mixed-example.md`;
    expect(rulesFor({ ...sources, [file]: "semgrep --config ./local.yml # see `reference`" })).toContain(
      "semgrep-metrics",
    );
    expect(rulesFor({ ...sources, [file]: "`semgrep --metrics=off --version`; semgrep --version" })).toContain(
      "semgrep-metrics",
    );
    const commands = semgrepCommands(
      "SEMGREP_ENABLE_VERSION_CHECK=0 semgrep --metrics=off --version && semgrep --metrics=off --version",
    );
    expect(commands).toHaveLength(2);
    expect(commands[1].source).not.toContain("SEMGREP_ENABLE_VERSION_CHECK=0");
    expect(
      rulesFor({
        ...sources,
        [workflow]: sources[workflow].replace(
          "SEMGREP_ENABLE_VERSION_CHECK=0 semgrep --metrics=off --version",
          "semgrep --metrics=off --pro --validate --config p/default # see `reference`",
        ),
      }),
    ).toContain("network-preflight");
  });

  it("rejects registry or Pro discovery before approval even with telemetry disabled", () => {
    const localVersion = "SEMGREP_ENABLE_VERSION_CHECK=0 semgrep --metrics=off --version";
    const registryProbe = "SEMGREP_ENABLE_VERSION_CHECK=0 semgrep --metrics=off --pro --validate --config p/default";
    expect(rulesFor({ ...sources, [workflow]: sources[workflow].replace(localVersion, registryProbe) })).toContain(
      "network-preflight",
    );
    expect(
      rulesFor({ ...sources, [workflow]: sources[workflow].replace(localVersion, "semgrep --metrics=off --version") }),
    ).toContain("version-network-preflight");
    const skill = `${SEMGREP_ROOT}SKILL.md`;
    expect(rulesFor({ ...sources, [skill]: sources[skill].replace(localVersion, registryProbe) })).toContain(
      "network-preflight",
    );
    const rulesets = `${SEMGREP_ROOT}references/rulesets.md`;
    expect(rulesFor({ ...sources, [rulesets]: registryProbe + "\n" + sources[rulesets] })).toContain(
      "network-preflight",
    );
  });

  it("fails unresolved exact-agent dependencies and resolves genuinely bundled agents", () => {
    const file = `${SEMGREP_ROOT}references/new-worker.md`;
    const unresolved = { ...sources, [file]: "Use subagent_type: static-analysis:semgrep-scanner" };
    expect(rulesFor(unresolved)).toContain("unresolved-scanner-agent");
    expect(
      rulesFor({
        ...unresolved,
        ".claude/agents/test-scanner.md": "---\nname: static-analysis:semgrep-scanner\n---\nBounded scanner",
      }),
    ).not.toContain("unresolved-scanner-agent");
    expect(
      rulesFor({
        ...unresolved,
        ".claude/agents/example.md":
          "---\nname: existing-agent\n---\nExample metadata:\nname: static-analysis:semgrep-scanner\n",
      }),
    ).toContain("unresolved-scanner-agent");
    expect(
      rulesFor({
        ...sources,
        [file]:
          "If the current host exposes subagent_type: static-analysis:semgrep-scanner, use it when authorized; otherwise use direct execution of the approved task.",
      }),
    ).not.toContain("unresolved-scanner-agent");
  });

  it("does not allow a scanner template to replace status/artifact admission with bare wait", () => {
    const file = `${SEMGREP_ROOT}references/scanner-task-prompt.md`;
    expect(
      rulesFor({
        ...sources,
        [file]: sources[file].replaceAll("wait_semgrep_scans [APPROVED_SCAN_COUNT] || exit 1", "wait"),
      }),
    ).toContain("scanner-bare-wait");
  });

  it("does not treat archives or unrelated specialist floors as current Semgrep commands", () => {
    expect(
      findRuleConsistencyProblems({
        ...sources,
        "docs/archive/old-semgrep-example.md": "semgrep --pro --config p/default\nUse subagent_type: retired:scanner",
        ".claude/agents/scoped-programme.md":
          "---\nname: scoped-programme\n---\nMandatory specialist review and Extra High effort for the scoped programme.",
      }),
    ).toEqual([]);
  });

  it("supports --root, detects a missing active file, and rejects unknown CLI arguments", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rule-consistency-"));
    temporary.push(directory);
    for (const [file, text] of Object.entries(sources)) {
      const target = path.join(directory, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, text);
    }
    const run = (...args: string[]) => spawnSync(process.execPath, [checker, ...args], { encoding: "utf8" });
    expect(run("--root", directory).status).toBe(0);
    fs.rmSync(path.join(directory, ".claude/skills/gates/SKILL.md"));
    const missing = run("--root", directory);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("missing-active-source");
    expect(run("--base", "HEAD").status).toBe(2);
  });
});

describe.skipIf(process.platform === "win32")("approved scan batch completion", () => {
  function runBatch(modes: string[], staleSecondOutput = false, expectedCount = modes.length) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "semgrep-status-"));
    temporary.push(directory);
    const stub = path.join(directory, "synthetic-scan.cjs");
    fs.writeFileSync(
      stub,
      `
const fs = require('node:fs');
const [json, sarif, mode] = process.argv.slice(2);
const errors = {
  'reported-error': [{level: 'error', message: 'synthetic scan error'}],
  'missing-level': [{message: 'unclassified synthetic scan error'}],
  'unknown-level': [{level: 'other', message: 'unknown synthetic scan diagnostic'}],
  'warning': [{level: 'warn', message: 'synthetic warning'}],
};
fs.writeFileSync(json, mode === 'invalid' ? '{invalid' : JSON.stringify({results: [], errors: errors[mode] || []}));
const run = mode === 'optional-sarif'
  ? {tool: {driver: {name: 'synthetic-semgrep'}}}
  : {tool: {driver: {name: 'synthetic-semgrep', rules: []}}, results: []};
if (mode === 'bad-sarif-rules') run.tool.driver.rules = {};
if (mode === 'bad-sarif-results') run.results = {};
if (mode !== 'missing') fs.writeFileSync(sarif, JSON.stringify({version: '2.1.0', runs: [run]}));
process.exit(mode === 'failed-child' ? 7 : 0);
`,
    );
    if (staleSecondOutput) fs.writeFileSync(path.join(directory, "job-1.json"), "preserve stale output");
    const result = spawnSync(
      "bash",
      [
        "-c",
        `
source "$1"
node_binary="$2"
stub="$3"
directory="$4"
expected="$5"
shift 5
index=0
for mode in "$@"; do
  json="$directory/job-$index.json"
  sarif="$directory/job-$index.sarif"
  start_semgrep_scan "$json" "$sarif" "$node_binary" "$stub" "$json" "$sarif" "$mode" || SEMGREP_SCAN_LAUNCH_FAILED=1
  index=$((index + 1))
done
wait_semgrep_scans "$expected"
`,
        "_",
        path.join(root, SEMGREP_ROOT, "scripts/scan-status.sh"),
        process.execPath,
        stub,
        directory,
        String(expectedCount),
        ...modes,
      ],
      { encoding: "utf8" },
    );
    return { ...result, directory };
  }

  it("admits only a complete batch with valid JSON/SARIF for every PID", () => {
    const result = runBatch(["good", "good"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("2 approved scans completed with valid JSON/SARIF pairs");
  });

  it.each([
    "failed-child",
    "missing",
    "invalid",
    "reported-error",
    "missing-level",
    "unknown-level",
    "bad-sarif-rules",
    "bad-sarif-results",
  ])("rejects %s even when another scan succeeds", (mode) => {
    const result = runBatch([mode, "good"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("incomplete scan batch");
    expect(result.stdout).not.toContain("approved scans completed");
  });

  it("reports explicit warnings without rejecting an otherwise complete batch", () => {
    const result = runBatch(["warning", "good"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain("1 warning-level scan diagnostics");
    expect(result.stdout).toContain("2 approved scans completed");
  });

  it("accepts valid empty SARIF runs with optional rules and results omitted", () => {
    const result = runBatch(["optional-sarif"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("1 approved scans completed");
  });

  it("rejects an unlaunched stale-output job and preserves its prior result", () => {
    const result = runBatch(["good", "good"], true);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("result already exists");
    expect(result.stdout).not.toContain("approved scans completed");
    expect(fs.readFileSync(path.join(result.directory, "job-1.json"), "utf8")).toBe("preserve stale output");
  });

  it("does not call an empty batch complete", () => {
    const result = runBatch([]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no approved scans were launched");
  });

  it("rejects a successful subset when an approved job was never launched", () => {
    const result = runBatch(["good"], false, 2);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("scan count differs from the exact approved plan");
    expect(result.stdout).not.toContain("approved scans completed");
  });
});
