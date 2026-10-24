#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { childProcessExitCode } from "./child-process-result.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Launch Next without shell-specific environment assignment or path quoting. */
export function runNextBuild({ rootDir = projectRoot, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--max-old-space-size=8192", path.join(rootDir, "node_modules/next/dist/bin/next"), "build", "--webpack"],
      {
        cwd: rootDir,
        env: { ...env, NODE_OPTIONS: env.NODE_OPTIONS || "--max-old-space-size=8192" },
        stdio: "inherit",
        windowsHide: true,
      },
    );
    child.on("error", reject);
    child.on("close", (status, signal) => resolve(childProcessExitCode({ status, signal })));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runNextBuild();
  } catch (error) {
    console.error(`Next build could not start: ${error.message}`);
    process.exitCode = 1;
  }
}
