import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

const target = value("--target");
const selectedEffort = value("--effort");
if (!manifest.phases.some((phase) => phase.id === target))
  fail("target is not a Cloud P00-P17 phase", "BLOCKED_WRONG_PHASE");
const expectedEffort = manifest.adaptiveEffortPolicy.highLaunchPhases.includes(target) ? "high" : "xhigh";
if (selectedEffort !== expectedEffort) {
  fail(`Cloud effort must be ${expectedEffort} for ${target}`, "BLOCKED_WRONG_REASONING_EFFORT");
}
const xhighConfirmed = process.argv.includes("--xhigh-confirmed");
if (expectedEffort === "xhigh" && !xhighConfirmed) {
  fail("xhigh target lacks the user confirmation marker", "BLOCKED_XHIGH_CONFIRMATION_MISSING");
}
if (expectedEffort === "high" && xhighConfirmed) {
  fail("high target must use the high launch prompt", "BLOCKED_WRONG_LAUNCH_PROFILE");
}

console.log(`[rag-phase-launch] PASS: ${target} requires ${expectedEffort}; launch profile matches.`);
