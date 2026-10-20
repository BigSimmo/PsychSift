import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { normalizeFocusedInput, selectFocusedTests } from "../scripts/focused-test-selection.mjs";

const fixtures: string[] = [];
function fixture(files: Record<string, string>) {
  const root = mkdtempSync(path.join(os.tmpdir(), "focused-ownership-"));
  fixtures.push(root);
  for (const [name, source] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), source);
  }
  return root;
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("focused test ownership", () => {
  it("adds file-reading contracts even when another test imports the changed module", () => {
    const root = fixture({
      "src/arithmetic.ts": "export const value = 1;",
      "tests/arithmetic.test.ts": 'import {value} from "../src/arithmetic";',
      "tests/policy.test.ts": 'import {readFileSync} from "node:fs"; readFileSync("src/arithmetic.ts");',
      "tests/unrelated.test.ts": "const value = 2;",
    });
    expect(selectFocusedTests({ root, files: ["src/arithmetic.ts"] }).tests).toEqual([
      "tests/arithmetic.test.ts",
      "tests/policy.test.ts",
    ]);
  });

  it("refuses mixed module and filesystem-only JSON inputs rather than dropping one", () => {
    const root = fixture({
      "src/arithmetic.ts": "export const value = 1;",
      "src/policy.json": '{"allowed":false}',
      "tests/arithmetic.test.ts": 'import "../src/arithmetic";',
      "tests/policy.test.ts": 'import {readFileSync} from "node:fs"; readFileSync("src/policy.json");',
    });
    expect(() => selectFocusedTests({ root, files: ["src/arithmetic.ts", "src/policy.json"] })).toThrow(/full suite/);
  });

  it("requires import ownership for every input, including a module without tests", () => {
    const root = fixture({
      "src/owned.ts": "export const value = 1;",
      "src/unmapped.ts": "export const value = 2;",
      "tests/owned.test.ts": 'import "../src/owned";',
      "tests/fs.test.ts": 'import "node:fs/promises";',
    });
    expect(() => selectFocusedTests({ root, files: ["src/owned.ts", "src/unmapped.ts"] })).toThrow(/unmapped/);
  });

  it("finds transitive, aliased and dynamic import owners and opaque runtime consumers", () => {
    const root = fixture({
      "tsconfig.json": '{"compilerOptions":{"moduleResolution":"bundler","paths":{"@/*":["./src/*"]}}}',
      "src/owned.ts": "export const value = 1;",
      "src/barrel.ts": 'export * from "./owned";',
      "src/launcher.ts": 'import {spawnSync} from "node:child_process";',
      "tests/alias.test.ts": 'import "@/barrel";',
      "tests/dynamic.test.ts": 'await import("../src/owned");',
      "tests/opaque.test.ts": 'import "../src/launcher";',
      "tests/unresolved.test.ts": 'const source = "x"; await import(source);',
    });
    expect(selectFocusedTests({ root, files: ["src/owned.ts"] }).tests).toEqual([
      "tests/alias.test.ts",
      "tests/dynamic.test.ts",
      "tests/opaque.test.ts",
      "tests/unresolved.test.ts",
    ]);
  });

  it("normalizes separators and rejects traversal, config aliases and nonexistent files", () => {
    const root = fixture({
      "src/owned.ts": "export {};",
      "scripts/config.ts": "export {};",
      "tests/a.test.ts": 'import "../src/owned";',
    });
    expect(normalizeFocusedInput(root, "src\\owned.ts").relative).toBe("src/owned.ts");
    expect(() => normalizeFocusedInput(root, "../outside.ts")).toThrow(/outside/);
    expect(() => normalizeFocusedInput(root, "src/missing.ts")).toThrow(/missing/);
    expect(() => selectFocusedTests({ root, files: ["src/../scripts/config.ts"] })).toThrow(/configuration/);
  });

  it.skipIf(process.platform === "win32")("checks the canonical ownership of an in-repository symlink", () => {
    const root = fixture({
      "src/owned.ts": "export {};",
      "scripts/config.ts": "export {};",
      "tests/config.test.ts": 'import "../scripts/config";',
    });
    symlinkSync(path.join(root, "scripts/config.ts"), path.join(root, "src/config.ts"));
    expect(() => selectFocusedTests({ root, files: ["src/config.ts"] })).toThrow(/configuration/);
  });
});
