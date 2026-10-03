#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const allowed = new Set(["run", "status", "verify", "deps", "clean-state", "export", "handoff"]);

export function workflowRootCandidates(cwd = process.cwd(), gitCommonDir = "", env = process.env) {
  const candidates = [];
  if (env.CODEX_LOCAL_WORKFLOW_ROOT) candidates.push(path.resolve(env.CODEX_LOCAL_WORKFLOW_ROOT));
  candidates.push(path.resolve(cwd, "..", ".local-dev"));
  if (gitCommonDir) {
    const common = path.isAbsolute(gitCommonDir) ? gitCommonDir : path.resolve(cwd, gitCommonDir);
    candidates.push(path.join(path.dirname(path.dirname(common)), ".local-dev"));
  }
  return [...new Set(candidates.map((candidate) => path.normalize(candidate)))];
}

export function resolveExternalWorkflow(name, cwd = process.cwd(), gitCommonDir = "", env = process.env) {
  if (!allowed.has(name)) throw new Error(`Unknown external workflow: ${name}`);
  const filename = `workflow-${name}.mjs`;
  for (const root of workflowRootCandidates(cwd, gitCommonDir, env)) {
    const candidate = path.join(root, filename);
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Could not locate ${filename}. Set CODEX_LOCAL_WORKFLOW_ROOT or install the shared .local-dev workflows.`,
  );
}

function main() {
  const [name, ...args] = process.argv.slice(2);
  if (!allowed.has(name)) {
    console.error(`Usage: node scripts/external-workflow.mjs <${[...allowed].join("|")}> [args]`);
    process.exit(1);
  }
  let gitCommonDir = "";
  try {
    gitCommonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // The direct parent candidate and explicit environment override still work outside Git.
  }
  const target = resolveExternalWorkflow(name, process.cwd(), gitCommonDir);
  const result = spawnSync(process.execPath, [target, ...args], {
    cwd: process.cwd(),
    stdio: "inherit",
    windowsHide: true,
  });
  process.exit(result.status ?? 1);
}

if (isDirectEntrypoint(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[external-workflow] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
