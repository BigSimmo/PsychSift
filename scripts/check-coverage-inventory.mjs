#!/usr/bin/env node
import { existsSync, globSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { COVERAGE_EXCLUDE_GLOBS, COVERAGE_INCLUDE_GLOBS, COVERAGE_INVENTORY_ROOTS } from "./coverage-contract.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export function lcovSourceFiles(source, rootDirectory = root) {
  return source
    .split(/\r?\n/)
    .filter((line) => line.startsWith("SF:"))
    .map((line) => line.slice(3).replaceAll("\\", "/").replace(/^\.\//, ""))
    .map((file) => {
      const rootPrefix = `${path.resolve(rootDirectory).replaceAll("\\", "/")}/`;
      return file.startsWith(rootPrefix) ? file.slice(rootPrefix.length) : file;
    });
}

export function missingCoverageRoots(sourceFiles, expectedRoots = COVERAGE_INVENTORY_ROOTS) {
  return expectedRoots.filter((expectedRoot) => !sourceFiles.some((file) => file.startsWith(expectedRoot)));
}

export function coverageSourceFiles(rootDirectory = root) {
  return globSync(COVERAGE_INCLUDE_GLOBS, { cwd: rootDirectory, exclude: COVERAGE_EXCLUDE_GLOBS })
    .map((file) => file.replaceAll("\\", "/"))
    .sort();
}

export function checkCoverageInventory(
  lcovSource,
  { rootDirectory = root, expectedFiles = coverageSourceFiles(rootDirectory) } = {},
) {
  const sourceFiles = lcovSourceFiles(lcovSource, rootDirectory);
  const actualFiles = new Set(sourceFiles);
  return {
    sourceFiles,
    missing: missingCoverageRoots(sourceFiles),
    missingFiles: expectedFiles.filter((file) => !actualFiles.has(file)),
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
      `[coverage-inventory] FAIL — ${result.missingFiles.length} executable source file(s) are absent from LCOV: ${result.missingFiles.slice(0, 20).join(", ")}${result.missingFiles.length > 20 ? ", …" : ""}.`,
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
