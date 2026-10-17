#!/usr/bin/env node
/** Run SessionStart dependents sequentially and emit one context envelope. */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = process.env.CLAUDE_PROJECT_DIR || resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = process.argv[2];
const payload = readFileSync(join(scratch, "payload"), "utf8");
const contexts = [];
function collect(output, cloudSetup = false) {
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    try {
      const parsed = JSON.parse(line);
      const context = parsed.hookSpecificOutput?.additionalContext;
      if (typeof context === "string") {
        contexts.push(context);
        continue;
      }
    } catch {
      /* Bootstrap/setup progress is diagnostic output, never a second JSON envelope. */
    }
    const background = cloudSetup && line.match(/^\[claude-cloud\] ([a-z ]+) provisioning in the background;/);
    if (background)
      contexts.push(
        `Cloud tools are still provisioning: ${background[1]}. Before trusting their checks, confirm completion with: bash scripts/setup-claude-cloud.sh ${background[1]}`,
      );
    process.stderr.write(`${line}\n`);
  }
}
collect(readFileSync(join(scratch, "bootstrap-output"), "utf8"));
let bootstrapReady = false;
try {
  const status = readFileSync(join(scratch, "bootstrap-status"), "utf8").trim();
  bootstrapReady = status === "0";
  if (!bootstrapReady)
    contexts.push(
      `SessionStart bootstrap ${/^\d+$/.test(status) ? `failed (exit ${status})` : "status was invalid"}; cloud provisioning was skipped. Review hook diagnostics before trusting dependency checks.`,
    );
} catch {
  contexts.push(
    "SessionStart bootstrap status was unavailable; cloud provisioning was skipped. Review hook diagnostics before trusting dependency checks.",
  );
}
const steps = [
  ["cloud setup", "bash", ["scripts/setup-claude-cloud.sh", "--session"], 300_000],
  ["base freshness", process.execPath, ["scripts/check-base-freshness.mjs", "--hook"], 30_000],
  ["issues", "bash", [".claude/hooks/issues-surface.sh"], 30_000],
  ["testing policy", "bash", [".claude/hooks/testing-policy.sh"], 15_000],
  ["organisation", "bash", [".claude/hooks/organisation-session-line.sh"], 20_000],
];
for (const [label, command, args, timeout] of steps) {
  if (label === "cloud setup" && !bootstrapReady) continue;
  const result = spawnSync(command, args, { cwd: repoRoot, input: payload, encoding: "utf8", timeout });
  collect(result.stdout || "", label === "cloud setup");
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0 || result.error)
    contexts.push(`SessionStart ${label} did not complete; check its diagnostics before trusting related checks.`);
}
if (contexts.length)
  console.log(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: contexts.join("\n\n") } }),
  );
