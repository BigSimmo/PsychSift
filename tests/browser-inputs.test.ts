import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { browserInputClosure } from "../scripts/browser-inputs.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

it("discovers newly named transitive browser inputs without widening server-only source", () => {
  const root = mkdtempSync(path.join(tmpdir(), "psychsift-browser-inputs-"));
  roots.push(root);
  const sources = {
    "src/components/entry.tsx": `'use client'; import { value } from '@/lib/new-helper'; import type { T } from '@/lib/types';`,
    "src/lib/new-helper.ts": `export { value } from './nested/reexport'; import './browser-side-effect'; import './directory'; import './same-name';`,
    "src/lib/directory/index.ts": `export const indexed = true;`,
    "src/lib/same-name.ts": `export const preferred = true;`,
    "src/lib/same-name/index.ts": `export const shadowed = true;`,
    "src/lib/nested/reexport.ts": `export const value = () => import('../lazy');`,
    "src/lib/lazy.ts": `export const load = () => require('./required');`,
    "src/lib/required.ts": `export { n } from './extension-spelling.js';`,
    "src/lib/extension-spelling.ts": `export const n = 1;`,
    "src/lib/types.ts": `export type T = string;`,
    "src/lib/browser-side-effect.ts": `import './server';`,
    "src/lib/server.ts": `import 'server-only'; import './server-dependency';`,
    "src/lib/server-dependency.ts": `export const secret = 1;`,
    "src/lib/unrelated-server.ts": `export const other = 1;`,
  };
  for (const [file, source] of Object.entries(sources)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), source);
  }
  const inputs = browserInputClosure(root);
  for (const file of Object.keys(sources).filter(
    (file) => !file.includes("server") && !file.endsWith("same-name/index.ts"),
  ))
    expect(inputs.has(file), file).toBe(true);
  expect(inputs.has("src/lib/same-name/index.ts")).toBe(false);
  for (const file of ["src/lib/server.ts", "src/lib/server-dependency.ts", "src/lib/unrelated-server.ts"])
    expect(inputs.has(file), file).toBe(false);
  writeFileSync(path.join(root, "src/lib/lazy.ts"), `export const load = (name: string) => import(name);`);
  const uncertainInputs = browserInputClosure(root);
  expect(uncertainInputs.has("src/lib/unrelated-server.ts")).toBe(true);
  expect(uncertainInputs.has("src/lib/server.ts")).toBe(false);
});

it("retains all five audited browser libraries and excludes a server-only Supabase client", () => {
  const inputs = browserInputClosure();
  for (const file of [
    "scroll-behavior.ts",
    "navigation-guards.ts",
    "keyboard-shortcuts.ts",
    "terms-acceptance.ts",
    "supabase/browser-client.ts",
    "work-help/index.ts",
    "medications.ts",
    "differentials.ts",
  ]) {
    expect(inputs.has(`src/lib/${file}`), file).toBe(true);
  }
  expect(inputs.has("src/lib/supabase/server.ts")).toBe(false);
});
