#!/usr/bin/env node
/**
 * Applied migrations are immutable. This proves it by content hash.
 *
 * WHY THIS EXISTS. On 2026-09-16 a generator rewrote three already-applied migrations to take in
 * new catalogue records. The Supabase integration applies only versions it has not seen, so the
 * edit reached nothing: production kept the old definitions while the repository began describing
 * a database that has never existed. The post-merge live drift check caught it, which is to say
 * it was caught after it had shipped. Every offline gate passed, because a replayed database and
 * the schema mirror agreed with each other.
 *
 * `tests/site-content-epoch-zero-freeze.test.ts` pins that particular incident. This is the
 * general form: an edit to ANY migration the repository has already shipped is a defect, whatever
 * it touches, and it fails here before review rather than after merge.
 *
 * WHAT A FAILURE MEANS. Not "reseal it". A migration that has landed on `main` has been applied
 * to the live database, and changing the file cannot change what was applied. If the live schema
 * must change, write a NEW migration — the integration applies those. See
 * `docs/site-content-sync-runbook.md` and the Supabase project safety rules in `AGENTS.md`.
 *
 * SEALING IS APPEND-ONLY. `npm run migrations:seal` records hashes for *new* migration files
 * only. It refuses `edited` and `missing` entries so an applied-history rewrite cannot clear this
 * gate by resealing the rewritten bytes. The genuine exception — restoring a file to the bytes
 * production actually holds — requires an explicit one-time override:
 *   ALLOW_MIGRATION_RESEAL=true npm run migrations:reseal
 *   (or `node scripts/check-migration-immutability.mjs --write --allow-reseal`)
 * That path prints every existing entry it changes; the manifest diff and the reason for it must
 * land in front of a reviewer.
 *
 * Usage:
 *   npm run check:migration-immutability     verify (exit 1 on any violation)
 *   npm run migrations:seal                  append hashes for new migrations only
 *   npm run migrations:reseal                exceptional restore (requires ALLOW_MIGRATION_RESEAL=true)
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, "supabase", "migrations");
const MANIFEST_PATH = path.join(PROJECT_ROOT, "supabase", "applied-migration-hashes.json");
const MANIFEST_RELATIVE = "supabase/applied-migration-hashes.json";

const sha256 = (content) => createHash("sha256").update(content).digest("hex");

/** Migration filenames on disk, sorted, so the manifest and the report are stable. */
export function migrationFilenames(directory = MIGRATIONS_DIR) {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

export function hashMigrations(directory = MIGRATIONS_DIR) {
  const versions = {};
  for (const name of migrationFilenames(directory)) {
    versions[name] = sha256(readFileSync(path.join(directory, name), "utf8").replace(/\r\n/g, "\n"));
  }
  return versions;
}

export function readManifest(manifestPath = MANIFEST_PATH) {
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

/**
 * Compare sealed hashes against what is on disk.
 *
 * @returns {{ edited: string[], missing: string[], unsealed: string[], ok: boolean }}
 */
export function compareMigrations(sealed, current) {
  const edited = [];
  const missing = [];
  const unsealed = [];
  for (const [name, hash] of Object.entries(sealed)) {
    if (!(name in current)) missing.push(name);
    else if (current[name] !== hash) edited.push(name);
  }
  for (const name of Object.keys(current)) if (!(name in sealed)) unsealed.push(name);
  return {
    edited: edited.sort(),
    missing: missing.sort(),
    unsealed: unsealed.sort(),
    ok: edited.length === 0 && missing.length === 0 && unsealed.length === 0,
  };
}

/** True when the caller explicitly opted into rewriting already-sealed hashes. */
export function resealAllowed({ argv = process.argv, env = process.env } = {}) {
  return argv.includes("--allow-reseal") || env.ALLOW_MIGRATION_RESEAL === "true";
}

/**
 * Build the next manifest `versions` map.
 *
 * Normal sealing is append-only: keep every previously sealed hash untouched and add hashes for
 * `unsealed` files. Edited/missing entries are refused unless `allowReseal` is true, in which
 * case the working-tree hashes replace the trusted ones (exceptional restoration only).
 *
 * @returns {{
 *   versions: Record<string, string>,
 *   edited: string[],
 *   missing: string[],
 *   unsealed: string[],
 *   refused: boolean,
 * }}
 */
export function planSeal(previous, current, { allowReseal = false } = {}) {
  const { edited, missing, unsealed } = compareMigrations(previous, current);
  if ((edited.length > 0 || missing.length > 0) && !allowReseal) {
    return { versions: { ...previous }, edited, missing, unsealed, refused: true };
  }
  if (allowReseal) {
    // Exceptional restoration: trust the working tree for everything currently on disk.
    // Removals (missing) stay missing — a deleted shipped migration is still a defect to explain.
    const versions = { ...current };
    return { versions, edited, missing, unsealed, refused: false };
  }
  // Append-only: previous hashes win; only add unsealed names.
  const versions = { ...previous };
  for (const name of unsealed) versions[name] = current[name];
  return { versions, edited, missing, unsealed, refused: false };
}

function writeManifest(versions) {
  writeFileSync(
    MANIFEST_PATH,
    `${JSON.stringify(
      {
        note: "sha256 of every migration this repository has shipped, with newlines normalised. An entry whose hash changes means an applied migration was edited, which cannot reach the live database. See scripts/check-migration-immutability.mjs.",
        generator: "scripts/check-migration-immutability.mjs",
        sealed_at: new Date().toISOString(),
        versions,
      },
      null,
      2,
    )}\n`,
  );
}

export function seal({ argv = process.argv, env = process.env, write = writeManifest } = {}) {
  const current = hashMigrations();
  let previous = {};
  try {
    previous = readManifest().versions ?? {};
  } catch {
    previous = {};
  }
  const allowReseal = resealAllowed({ argv, env });
  const plan = planSeal(previous, current, { allowReseal });
  if (plan.refused) {
    console.error("Migration seal refused: sealing is append-only.");
    for (const name of plan.edited) console.error(`- edited an already-shipped migration: ${name}`);
    for (const name of plan.missing) console.error(`- deleted an already-shipped migration: ${name}`);
    console.error("");
    console.error(
      "An applied migration is never re-run, so rewriting its sealed hash would hide the exact " +
        "defect this guard exists to catch. Put the live-schema change in a NEW migration, then " +
        "run `npm run migrations:seal` to record that new file. If you are deliberately restoring " +
        "a file to what production holds, rerun with ALLOW_MIGRATION_RESEAL=true " +
        "(`npm run migrations:reseal`) and say why in the commit message.",
    );
    return 1;
  }
  write(plan.versions);
  console.log(`Sealed ${Object.keys(plan.versions).length} migrations into ${MANIFEST_RELATIVE}.`);
  for (const name of plan.unsealed) console.log(`  + ${name} (new)`);
  for (const name of plan.missing) console.log(`  - ${name} (removed)`);
  if (plan.edited.length > 0) {
    console.log("");
    console.log("RESEALED AN ALREADY-SHIPPED MIGRATION. Say why in the commit message:");
    for (const name of plan.edited) console.log(`  ! ${name}`);
    console.log("Editing an applied migration does not change the live database. If the live");
    console.log("schema must change, the change belongs in a NEW migration.");
  }
  return 0;
}

export function runMigrationImmutabilityGuard() {
  const current = hashMigrations();
  const sealed = readManifest().versions ?? {};
  const result = compareMigrations(sealed, current);
  if (result.ok) {
    console.log(`Migration immutability guard passed: ${Object.keys(sealed).length} shipped migrations unchanged.`);
    return 0;
  }
  console.error("Migration immutability guard failed.");
  for (const name of result.edited) console.error(`- edited an already-shipped migration: ${name}`);
  for (const name of result.missing) console.error(`- deleted an already-shipped migration: ${name}`);
  for (const name of result.unsealed) console.error(`- migration is not sealed: ${name}`);
  console.error("");
  if (result.edited.length > 0 || result.missing.length > 0) {
    console.error(
      "An applied migration is never re-run, so editing or deleting the file changes what this " +
        "repository CLAIMS the live database contains and nothing else. Put the change in a NEW " +
        "migration instead. If you are deliberately restoring a file to what production holds, " +
        "run `ALLOW_MIGRATION_RESEAL=true npm run migrations:reseal` and say so in the commit message.",
    );
  } else {
    console.error("Run `npm run migrations:seal` to record the new migration's bytes.");
  }
  return 1;
}

if (isDirectEntrypoint(import.meta.url)) {
  if (process.argv.includes("--write")) {
    process.exitCode = seal();
  } else {
    process.exitCode = runMigrationImmutabilityGuard();
  }
}
