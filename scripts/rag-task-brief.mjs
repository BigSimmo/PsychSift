import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function value(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const next = process.argv[index + 1];
  if (!next || next.startsWith("--")) fail(`${name} requires a value`);
  return next;
}

function fail(message) {
  console.error(`[rag-task-brief] FAIL: ${message}`);
  process.exit(1);
}

const variant = value("--variant", "cloud");
const phaseId = value("--phase");
const requestedTask = value("--task");
const outputPath = value("--out");
if (!["cloud", "local"].includes(variant)) fail("--variant must be cloud or local");
if (!phaseId || requestedTask === null) fail("--phase and --task are required");

const packageRoot = join(root, "docs", "superpowers", "rag-upgrade", variant);
const manifest = JSON.parse(readFileSync(join(packageRoot, "programme-manifest.json"), "utf8"));
const phase = manifest.phases.find((candidate) => candidate.id === phaseId);
if (!phase) fail(`unknown Cloud implementation phase ${phaseId}`);
const taskNumber = Number(requestedTask);
if (!Number.isInteger(taskNumber) || !phase.tasks.includes(taskNumber)) {
  fail(`task ${requestedTask} is not scheduled in ${phaseId}`);
}

const planRelative = manifest.plans[phase.plan];
if (!planRelative) fail(`${phaseId} has no executable plan`);
const planPath = join(packageRoot, ...planRelative.split("/"));
const markdown = readFileSync(planPath, "utf8");
const headings = [...markdown.matchAll(/^### Task (\d+):[^\n]*$/gm)];
const headingIndex = headings.findIndex((heading) => Number(heading[1]) === taskNumber);
if (headingIndex === -1) fail(`Task ${taskNumber} was not found in ${planRelative}`);
const taskBody = markdown
  .slice(headings[headingIndex].index, headings[headingIndex + 1]?.index ?? markdown.length)
  .trim();

const header = [
  `# Exact task brief: ${phaseId}/${phase.plan}/task-${taskNumber}`,
  "",
  `Package variant: ${variant}`,
  `Plan: ${planRelative}`,
  `Execution predecessor: ${phase.executionPredecessor ?? "none"}`,
  `Implementation route: ${phase.implementationModel} / ${phase.implementationReasoning}`,
  `Skill profiles: ${(manifest.phaseSkillProfiles?.[phaseId] ?? []).join(", ")}`,
  "",
  "The body below is copied verbatim from the committed generated package.",
  "",
].join("\n");
const brief = `${header}${taskBody}\n`;

if (outputPath) {
  const absoluteOutput = resolve(root, outputPath);
  mkdirSync(dirname(absoluteOutput), { recursive: true });
  writeFileSync(absoluteOutput, brief, "utf8");
  console.log(`[rag-task-brief] PASS: wrote ${outputPath}`);
} else {
  process.stdout.write(brief);
}
