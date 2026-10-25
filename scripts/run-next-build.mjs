#!/usr/bin/env node
/**
 * run-next-build — the cross-platform `next build --webpack` step of `build:internal`.
 *
 * `build:internal` used to set the heap default inline as
 * `NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}" node ...`. That is POSIX
 * shell syntax: cmd.exe and PowerShell do not expand it, so `npm run build` failed on
 * Windows (#NM9S1V). This script does the same job in Node so every shell behaves alike.
 *
 * Behaviour is unchanged on Linux/CI:
 * - The next binary still runs under `node --max-old-space-size=8192`.
 * - Child processes (notably Next's TypeScript check) inherit `NODE_OPTIONS`. An existing,
 *   non-empty value is kept exactly as given (CI sets 6144 on purpose); only when it is
 *   unset or empty does the 8192 default apply — the same rule as `${NODE_OPTIONS:-...}`.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { childProcessExitCode } from "./child-process-result.mjs";

export const DEFAULT_NODE_OPTIONS = "--max-old-space-size=8192";

/**
 * @param {{ readonly [key: string]: string | undefined }} [env]
 * @returns {{ [key: string]: string | undefined }}
 */
export function nextBuildEnvironment(env = process.env) {
  return { ...env, NODE_OPTIONS: env.NODE_OPTIONS || DEFAULT_NODE_OPTIONS };
}

/** @param {string} projectRoot */
export function nextBuildArguments(projectRoot) {
  const nextBin = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
  return [DEFAULT_NODE_OPTIONS, nextBin, "build", "--webpack"];
}

function main() {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = spawnSync(process.execPath, nextBuildArguments(projectRoot), {
    cwd: projectRoot,
    env: nextBuildEnvironment(),
    stdio: "inherit",
  });
  if (result.error) console.error(`[run-next-build] could not start next build: ${result.error.message}`);
  process.exit(childProcessExitCode(result));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
