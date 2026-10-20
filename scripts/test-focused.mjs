#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { childProcessExitCode } from "./child-process-result.mjs";
import { selectFocusedTests } from "./focused-test-selection.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const unsafeSelectionPattern =
  /^(?:tests\/|scripts\/|\.github\/|package(?:-lock)?\.json$|tsconfig|vitest\.config|next\.config|eslint)/i;

function git(args) {
  return execFileSync("git", args, { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

function lines(value) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function defaultSelection() {
  let base = "HEAD";
  try {
    base = git(["merge-base", "HEAD", "origin/main"]).trim();
  } catch {
    // A local-only checkout can still select working-tree changes from HEAD.
  }
  const changed = lines(git(["diff", "--name-only", base]));
  const untracked = lines(git(["ls-files", "--others", "--exclude-standard"]));
  const deleted = new Set(lines(git(["diff", "--name-only", "--diff-filter=D", base])));
  return { files: [...new Set([...changed, ...untracked])], deleted };
}

function failClosed(reason) {
  console.error(`Focused test selection is unsafe: ${reason}`);
  console.error("Run the full unit suite with: npm run test");
  process.exit(2);
}

const args = process.argv.slice(2);
const filesIndex = args.indexOf("--files");
const explicitFiles = filesIndex >= 0 ? lines((args[filesIndex + 1] ?? "").replaceAll(",", "\n")) : null;
if (filesIndex >= 0 && explicitFiles?.length === 0) failClosed("--files did not contain a path");

const selection = explicitFiles ? { files: explicitFiles, deleted: new Set() } : defaultSelection();
if (selection.files.length === 0) failClosed("no changed files were found");
const missing = selection.files.filter((file) => !existsSync(path.resolve(projectRoot, file)));
if (missing.length > 0) failClosed(`deleted or missing paths require the full suite (${missing.join(", ")})`);
if (selection.deleted.size > 0)
  failClosed(`deleted paths require the full suite (${[...selection.deleted].join(", ")})`);
const unsafe = selection.files.filter((file) => unsafeSelectionPattern.test(file.replaceAll("\\", "/")));
if (unsafe.length > 0) failClosed(`test or configuration paths changed (${unsafe.join(", ")})`);

const selectionArgs = new Set();
if (filesIndex >= 0) {
  selectionArgs.add(filesIndex);
  selectionArgs.add(filesIndex + 1);
}
const forwarded = args.filter((argument, index) => !selectionArgs.has(index) && argument !== "--dry-run");
if (forwarded.length) failClosed("additional Vitest selectors/options require an explicit test command");
let plan;
try {
  plan = selectFocusedTests({ root: projectRoot, files: selection.files });
} catch (error) {
  failClosed(error.message);
}
console.log(`Focused test inputs: ${plan.inputs.join(", ")}`);
console.log(`Selected ${plan.tests.length} test files, including filesystem and subprocess consumers.`);
if (args.includes("--dry-run")) {
  console.log(`Command: vitest run ${plan.tests.join(" ")}`);
  process.exit(0);
}

const runnerPath = path.join(projectRoot, "scripts", "run-vitest.mjs");
const result = spawnSync(process.execPath, [runnerPath, "run", ...plan.tests], {
  cwd: projectRoot,
  stdio: "inherit",
});
process.exit(childProcessExitCode(result));
