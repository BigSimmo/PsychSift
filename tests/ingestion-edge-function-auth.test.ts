import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const config = readFileSync(join(root, "supabase/config.toml"), "utf8");
const schema = readFileSync(join(root, "supabase/schema.sql"), "utf8");
const databaseTypes = readFileSync(join(root, "src/lib/supabase/database.types.ts"), "utf8");
const migrationPath = join(root, "supabase/migrations/20260831100000_retire_ingestion_worker.sql");

describe("retired duplicate ingestion-worker Edge Function", () => {
  it("removes only the duplicate function, config registration, and current invoker surface", () => {
    expect(existsSync(join(root, "supabase/functions/ingestion-worker/index.ts"))).toBe(false);
    expect(existsSync(join(root, "supabase/functions/ingestion-worker/auth.ts"))).toBe(false);
    expect(config).not.toContain("[functions.ingestion-worker]");
    expect(schema).not.toContain("FUNCTION public.invoke_ingestion_worker");
    expect(databaseTypes).not.toContain("invoke_ingestion_worker:");
  });

  it("ships a forward-only revoke-before-drop migration", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const migration = readFileSync(migrationPath, "utf8").toLowerCase();
    const revoke = migration.indexOf("revoke execute on function public.invoke_ingestion_worker(integer)");
    const drop = migration.indexOf("drop function if exists public.invoke_ingestion_worker(integer)");
    expect(revoke).toBeGreaterThanOrEqual(0);
    expect(drop).toBeGreaterThan(revoke);
    expect(migration).not.toContain("create or replace function public.invoke_ingestion_worker");
  });
});
