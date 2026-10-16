import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseLocalAgentOptions, planLocalAgent } from "./lib/rag-local-agent-policy.mjs";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  readFileSync(resolve(root, "docs/superpowers/rag-upgrade/canonical/programme-manifest.json"), "utf8"),
);

function value(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function fail(message, code) {
  console.error(`[rag-phase-launch] ${code}: ${message}`);
  process.exit(1);
}

const mode = value("--mode");
if (mode === "local-smart") {
  try {
    const input = parseLocalAgentOptions(process.argv.slice(2), ["--mode"]);
    console.log(JSON.stringify(planLocalAgent(manifest, input), null, 2));
    process.exit(0);
  } catch (error) {
    fail(error.message, "BLOCKED_LOCAL_AGENT_POLICY");
  }
}
if (mode !== null && mode !== "cloud") fail("unknown launch mode", "BLOCKED_WRONG_LAUNCH_PROFILE");

const target = value("--target");
const selectedEffort = value("--effort");
if (!manifest.phases.some((phase) => phase.id === target))
  fail("target is not a Cloud P00-P17 phase", "BLOCKED_WRONG_PHASE");
const expectedEffort = manifest.adaptiveEffortPolicy.highLaunchPhases.includes(target) ? "high" : "xhigh";
if (selectedEffort !== expectedEffort) {
  fail(`Cloud effort must be ${expectedEffort} for ${target}`, "BLOCKED_WRONG_REASONING_EFFORT");
}

console.log(`[rag-phase-launch] PASS: ${target} requires ${expectedEffort}; launch profile matches.`);
