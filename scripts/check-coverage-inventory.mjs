#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { COVERAGE_INVENTORY_ROOTS, COVERAGE_REQUIRED_SOURCE_FILES } from "./coverage-contract.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export function lcovSourceFiles(source) {
  return source
    .split(/\r?\n/)
    .filter((line) => line.startsWith("SF:"))
    .map((line) => line.slice(3).replaceAll("\\", "/").replace(/^\.\//, ""))
    .map((file) => {
      const rootPrefix = `${root.replaceAll("\\", "/")}/`;
      return file.startsWith(rootPrefix) ? file.slice(rootPrefix.length) : file;
    });
}

export function missingCoverageRoots(sourceFiles, expectedRoots = COVERAGE_INVENTORY_ROOTS) {
  return expectedRoots.filter((expectedRoot) => !sourceFiles.some((file) => file.startsWith(expectedRoot)));
}

export function checkCoverageInventory(
  lcovSource,
  expectedRoots = COVERAGE_INVENTORY_ROOTS,
  requiredFiles = COVERAGE_REQUIRED_SOURCE_FILES,
) {
  const sourceFiles = lcovSourceFiles(lcovSource);
  return {
    sourceFiles,
    missing: missingCoverageRoots(sourceFiles, expectedRoots),
    missingFiles: requiredFiles.filter((file) => !sourceFiles.includes(file)),
  };
}

function main(argv = process.argv.slice(2)) {
  const lcovIndex = argv.indexOf("--lcov");
  const lcovPath = path.resolve(
    root,
    lcovIndex >= 0 ? (argv[lcovIndex + 1] ?? "coverage/lcov.info") : "coverage/lcov.info",
  );
  if (!existsSync(lcovPath)) {
    console.error(`[coverage-inventory] FAIL — LCOV report not found at ${path.relative(root, lcovPath)}.`);
    return 1;
  }

  const result = checkCoverageInventory(readFileSync(lcovPath, "utf8"));
  if (result.sourceFiles.length === 0) {
    console.error("[coverage-inventory] FAIL — LCOV contains no source-file records.");
    return 1;
  }
  if (result.missing.length > 0) {
    console.error(
      `[coverage-inventory] FAIL — declared coverage root(s) are absent from LCOV: ${result.missing.join(", ")}.`,
    );
    return 1;
  }
  if (result.missingFiles.length > 0) {
    console.error(
      `[coverage-inventory] FAIL — required production controls are absent from LCOV: ${result.missingFiles.join(", ")}.`,
    );
    return 1;
  }

  console.log(
    `[coverage-inventory] PASS — ${result.sourceFiles.length} source files cover ${COVERAGE_INVENTORY_ROOTS.join(", ")}.`,
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("check-coverage-inventory.mjs")) {
  process.exitCode = main();
}
