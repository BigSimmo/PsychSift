import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  compareMigrations,
  hashMigrations,
  migrationFilenames,
  planSeal,
  readManifest,
  resealAllowed,
  readSealedVersions,
  resealBlockedWithoutApproval,
} from "../scripts/check-migration-immutability.mjs";

/**
 * Runs the applied-migration immutability guard inside the offline suite, so an edit to a shipped
 * migration fails in review rather than in the post-merge live drift check.
 *
 * The specific incident this generalises: on 2026-09-16 three already-applied migrations were
 * regenerated to absorb new catalogue records. Nothing offline objected — the migration replay
 * only proves the chain is internally consistent with itself, and the schema mirror was
 * regenerated from the same rewritten files, so the two agreed. Production, which never re-runs
 * an applied version, disagreed with both.
 *
 * If this fails, do not reach for `npm run migrations:seal`. A migration that has shipped has
 * been applied; changing the file cannot change what was applied. The change belongs in a NEW
 * migration. Resealing is for the narrow case of restoring a file to the bytes production holds,
 * and it requires `ALLOW_MIGRATION_RESEAL=true` / `npm run migrations:reseal`, explained in the
 * commit that does it.
 */
describe("shipped migrations are immutable", () => {
  it("matches every sealed migration byte for byte", () => {
    const sealed = (readManifest() as { versions: Record<string, string> }).versions;
    const result = compareMigrations(sealed, hashMigrations());
    expect(result.edited, "an already-shipped migration was edited").toEqual([]);
    expect(result.missing, "an already-shipped migration was deleted").toEqual([]);
    expect(result.unsealed, "a migration is not sealed — run npm run migrations:seal").toEqual([]);
  });

  it("seals every migration on disk", () => {
    // Non-vacuous: an empty or truncated manifest would otherwise pass the comparison above by
    // having nothing to disagree with.
    const sealed = (readManifest() as { versions: Record<string, string> }).versions;
    const onDisk = migrationFilenames();
    expect(onDisk.length).toBeGreaterThan(200);
    expect(Object.keys(sealed).sort()).toEqual([...onDisk].sort());
  });

  it("detects an edit, a deletion and an unsealed addition", () => {
    // The comparison is the whole guard, so it is tested directly rather than only exercised.
    const sealed = { a: "1", b: "2" };
    expect(compareMigrations(sealed, { a: "1", b: "2" })).toMatchObject({ ok: true });
    expect(compareMigrations(sealed, { a: "1", b: "changed" })).toMatchObject({ edited: ["b"], ok: false });
    expect(compareMigrations(sealed, { a: "1" })).toMatchObject({ missing: ["b"], ok: false });
    expect(compareMigrations(sealed, { a: "1", b: "2", c: "3" })).toMatchObject({ unsealed: ["c"], ok: false });
  });
});

describe("migration sealing is append-only", () => {
  const previous = { a: "1", b: "2" };

  it("appends hashes for new migrations without rewriting trusted ones", () => {
    const plan = planSeal(previous, { a: "1", b: "2", c: "3" });
    expect(plan.refused).toBe(false);
    expect(plan.unsealed).toEqual(["c"]);
    expect(plan.versions).toEqual({ a: "1", b: "2", c: "3" });
  });

  it("refuses to reseal an edited migration during normal sealing", () => {
    const plan = planSeal(previous, { a: "1", b: "changed" });
    expect(plan.refused).toBe(true);
    expect(plan.edited).toEqual(["b"]);
    // Trusted hashes must stay put when refused — otherwise an applied-history rewrite could
    // clear the immutability gate by running migrations:seal on the rewritten bytes.
    expect(plan.versions).toEqual(previous);
  });

  it("refuses to drop a missing sealed migration during normal sealing", () => {
    const plan = planSeal(previous, { a: "1" });
    expect(plan.refused).toBe(true);
    expect(plan.missing).toEqual(["b"]);
    expect(plan.versions).toEqual(previous);
  });

  it("refuses a reseal that rewrites or drops sealed entries until the owner's approval is named", () => {
    const env = (extra: Record<string, string> = {}) => ({ NODE_ENV: "test", ...extra }) as NodeJS.ProcessEnv;
    const edited = planSeal({ a: "1" }, { a: "2" }, { allowReseal: true });
    const dropped = planSeal({ a: "1", b: "2" }, { a: "1" }, { allowReseal: true });
    const appendOnly = planSeal({ a: "1" }, { a: "1", b: "2" }, { allowReseal: true });
    expect(resealBlockedWithoutApproval(edited, { env: env() })).toBe(true);
    expect(resealBlockedWithoutApproval(dropped, { env: env({ MIGRATION_RESEAL_OWNER_APPROVAL: "  " }) })).toBe(true);
    expect(resealBlockedWithoutApproval(appendOnly, { env: env() })).toBe(false);
    for (const vague of ["no", "yes", "2026-10-15", "owner"]) {
      expect(resealBlockedWithoutApproval(edited, { env: env({ MIGRATION_RESEAL_OWNER_APPROVAL: vague }) })).toBe(true);
    }
    expect(
      resealBlockedWithoutApproval(edited, {
        env: env({ MIGRATION_RESEAL_OWNER_APPROVAL: "owner, in chat, 2026-10-15" }),
      }),
    ).toBe(false);
  });

  it("treats a missing, unreadable or versionless manifest as unknown, never as empty", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "seal-"));
    try {
      const broken = path.join(dir, "broken.json");
      const versionless = path.join(dir, "versionless.json");
      const good = path.join(dir, "good.json");
      writeFileSync(broken, "{not json");
      writeFileSync(versionless, JSON.stringify({ note: "x" }));
      writeFileSync(good, JSON.stringify({ versions: { "a.sql": "1" } }));
      expect(readSealedVersions(path.join(dir, "absent.json"))).toBeNull();
      expect(readSealedVersions(broken)).toBeNull();
      expect(readSealedVersions(versionless)).toBeNull();
      expect(readSealedVersions(good)).toEqual({ "a.sql": "1" });
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("allows exceptional restoration only with an explicit reseal opt-in", () => {
    const emptyEnv = { NODE_ENV: "test" } as NodeJS.ProcessEnv;
    expect(resealAllowed({ argv: ["node", "script", "--write"], env: emptyEnv })).toBe(false);
    expect(resealAllowed({ argv: ["node", "script", "--write", "--allow-reseal"], env: emptyEnv })).toBe(true);
    expect(
      resealAllowed({
        argv: ["node", "script", "--write"],
        env: { ...emptyEnv, ALLOW_MIGRATION_RESEAL: "true" },
      }),
    ).toBe(true);

    const plan = planSeal(previous, { a: "1", b: "restored" }, { allowReseal: true });
    expect(plan.refused).toBe(false);
    expect(plan.edited).toEqual(["b"]);
    expect(plan.versions).toEqual({ a: "1", b: "restored" });
  });
});
