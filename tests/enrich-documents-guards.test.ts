import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ENRICH_USAGE, parseEnrichArgs } from "../scripts/lib/enrich-documents-args";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(repositoryRoot, "scripts", "enrich-documents.ts"), "utf8");

// `npm run enrich:documents` writes document/image rows through the service-role client and
// calls OpenAI. It must follow the sibling backfill convention: dry-run by default, explicit
// `--write`, explicit `--all-owners`, and a Supabase project check before any client exists.
describe("enrich:documents guards", () => {
  const noOwnerEnv: Record<string, string | undefined> = {};

  it("defaults to dry-run and never implies --all-owners from an empty owner environment", () => {
    expect(() => parseEnrichArgs([], noOwnerEnv)).toThrow(/--all-owners explicitly/);
    const args = parseEnrichArgs(["--all-owners"], noOwnerEnv);
    expect(args.write).toBe(false);
    expect(args.allOwners).toBe(true);
  });

  it("keeps an owner-scoped run owner-scoped unless --all-owners is passed", () => {
    const args = parseEnrichArgs([], { LOCAL_NO_AUTH_OWNER_ID: "owner-1" });
    expect(args.allOwners).toBe(false);
    expect(args.ownerId).toBe("owner-1");
    expect(args.write).toBe(false);
  });

  it("enables writes only with --write", () => {
    const args = parseEnrichArgs(["--owner-id", "owner-1", "--write", "--limit", "3"], noOwnerEnv);
    expect(args.write).toBe(true);
    expect(args.limit).toBe(3);
  });

  it("rejects unknown options and invalid modes instead of silently ignoring them", () => {
    expect(() => parseEnrichArgs(["--owner-id", "owner-1", "--mode", "everything"], noOwnerEnv)).toThrow(/--mode/);
    expect(() => parseEnrichArgs(["--owner-id", "owner-1", "--bogus", "x"], noOwnerEnv)).toThrow(/Unknown option/);
    expect(ENRICH_USAGE).toContain("--write");
    expect(ENRICH_USAGE).toContain("--all-owners");
  });

  it("checks the Supabase project before creating the admin client, and gates every write on --write", () => {
    const mainStart = source.indexOf("async function main()");
    expect(mainStart).toBeGreaterThan(-1);
    const main = source.slice(mainStart);
    const projectCheck = main.indexOf("checkSupabaseProjectConfig(");
    const adminClient = main.indexOf("loadAdminClient()");
    expect(projectCheck, "the project check must exist in main").toBeGreaterThan(-1);
    expect(adminClient, "the admin client must be created in main").toBeGreaterThan(-1);
    expect(projectCheck).toBeLessThan(adminClient);

    const dryRunGate = main.indexOf("if (!args.write)");
    const firstWrite = main.indexOf(".update(");
    expect(dryRunGate, "the dry-run gate must exist in main").toBeGreaterThan(-1);
    expect(firstWrite).toBeGreaterThan(dryRunGate);
    expect(main.indexOf("upsertDocumentEnrichment(")).toBeGreaterThan(dryRunGate);
  });

  it("checks every update's error and exits non-zero when any document fails", () => {
    expect(source).not.toMatch(/\n\s*await (?:args\.)?supabase\s*\n\s*\.from\([^)]*\)\s*\n\s*\.update\(/);
    expect(source).toContain("failed += 1;");
    expect(source).toContain("if (failed > 0) process.exitCode = 1;");
  });
});
