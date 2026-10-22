import { describe, expect, it } from "vitest";
import {
  defaultTargets,
  extractScriptRefs,
  findStaleRefs,
  parsePackageScripts,
} from "../scripts/check-docs-script-refs.mjs";
import { isMaintainedDatedDocument } from "../scripts/lib/document-lifecycle.mjs";

it("checks commands in dated plans that remain maintained references", () => {
  expect(defaultTargets()).toContain("docs/superpowers/plans/2026-09-20-cme-mode-phase-1.md");
});

it("requires an explicit live lifecycle header rather than incidental prose", () => {
  expect(isMaintainedDatedDocument("**Status:** maintained implementation reference")).toBe(true);
  expect(isMaintainedDatedDocument("**Status:** completed\nPreviously active reference")).toBe(false);
  expect(isMaintainedDatedDocument("This was maintained during the project.")).toBe(false);
});

describe("parsePackageScripts", () => {
  it("returns the set of script names", () => {
    const set = parsePackageScripts(JSON.stringify({ scripts: { build: "x", "verify:cheap": "y" } }));
    expect(set.has("build")).toBe(true);
    expect(set.has("verify:cheap")).toBe(true);
    expect(set.size).toBe(2);
  });
});

describe("extractScriptRefs", () => {
  it("extracts npm run tokens from inline code spans and fenced blocks", () => {
    const md = ["Run `npm run verify:cheap` first.", "```bash", "npm run build", "pnpm run lint", "```"].join("\n");
    const refs = extractScriptRefs(md);
    expect(refs).toEqual(expect.arrayContaining(["verify:cheap", "build", "lint"]));
  });

  it("ignores npm run mentions in prose (outside code)", () => {
    expect(extractScriptRefs("just npm run the thing normally")).toEqual([]);
  });

  it("captures the script name with flags following it", () => {
    expect(extractScriptRefs("`npm run eval:quality -- --rag-only`")).toEqual(["eval:quality"]);
  });
});

describe("findStaleRefs", () => {
  const valid = new Set(["build", "verify:cheap"]);
  it("flags references with no matching script", () => {
    expect(findStaleRefs(["build", "verify:gone"], valid)).toEqual(["verify:gone"]);
  });
  it("skips allowlisted and placeholder tokens", () => {
    expect(findStaleRefs(["<script>", "your-script"], valid)).toEqual([]);
  });
  it("returns empty when everything resolves", () => {
    expect(findStaleRefs(["build", "verify:cheap"], valid)).toEqual([]);
  });
});
