import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const SCRIPT = "scripts/check-function-grants.mjs";
const workdir = mkdtempSync(join(tmpdir(), "fn-grants-"));

afterAll(() => rmSync(workdir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

function run(schemaPath: string): { code: number; out: string } {
  try {
    const stdout = execFileSync("node", [SCRIPT, schemaPath], { encoding: "utf8" });
    return { code: 0, out: stdout };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

function fixture(name: string, sql: string): string {
  const file = join(workdir, name);
  writeFileSync(file, sql);
  return file;
}

const BLANKET = "revoke execute on all functions in schema public from public, anon, authenticated;";
const DEFINER = (name: string) =>
  [
    `create function public.${name}(p_owner uuid)`,
    "returns jsonb language plpgsql security definer set search_path = '' as $$",
    "begin return '{}'::jsonb; end;",
    "$$;",
  ].join("\n");

describe("check:function-grants", () => {
  it("passes against the committed schema.sql", () => {
    const result = run("supabase/schema.sql");
    expect(result.out).toContain("OK");
    expect(result.code).toBe(0);
  });

  it("fails a SECURITY DEFINER function left anon-executable after the blanket revoke", () => {
    const result = run(fixture("leaky.sql", [BLANKET, DEFINER("leaky")].join("\n")));
    expect(result.code).toBe(1);
    expect(result.out).toContain("public.leaky");
  });

  it("passes when the function is revoked FROM public (revoke all form)", () => {
    const result = run(
      fixture(
        "guarded.sql",
        [
          BLANKET,
          DEFINER("guarded"),
          "revoke all on function public.guarded(uuid) from public, anon, authenticated;",
        ].join("\n"),
      ),
    );
    expect(result.out).toContain("OK");
    expect(result.code).toBe(0);
  });

  it("fails when the revoke omits PUBLIC (revoke from anon only leaves the default PUBLIC grant)", () => {
    const result = run(
      fixture(
        "anon-only-revoke.sql",
        [BLANKET, DEFINER("anononly"), "revoke execute on function public.anononly(uuid) from anon;"].join("\n"),
      ),
    );
    expect(result.code).toBe(1);
    expect(result.out).toContain("public.anononly");
  });

  it("fails a function explicitly granted EXECUTE to anon (even after a revoke)", () => {
    const result = run(
      fixture(
        "reopened.sql",
        [
          BLANKET,
          DEFINER("reopened"),
          "revoke all on function public.reopened(uuid) from public, anon, authenticated;",
          "grant execute on function public.reopened(uuid) to anon;",
        ].join("\n"),
      ),
    );
    expect(result.code).toBe(1);
    expect(result.out).toContain("public.reopened");
  });

  it("fails on a schema-wide GRANT ... ON ALL FUNCTIONS ... TO anon that reopens everything", () => {
    const result = run(
      fixture(
        "schema-wide-grant.sql",
        [
          BLANKET,
          DEFINER("guarded"),
          "revoke all on function public.guarded(uuid) from public, anon, authenticated;",
          "grant execute on all functions in schema public to anon;",
        ].join("\n"),
      ),
    );
    expect(result.code).toBe(1);
    expect(result.out).toContain("all functions");
  });

  it("ignores SECURITY INVOKER functions (bound by RLS, not an escalation surface)", () => {
    const result = run(
      fixture(
        "invoker.sql",
        [BLANKET, "create function public.plain() returns void language sql as $$ select 1 $$;"].join("\n"),
      ),
    );
    expect(result.code).toBe(0);
  });

  it("treats a function defined before the blanket revoke as covered", () => {
    const result = run(fixture("covered.sql", [DEFINER("older"), BLANKET].join("\n")));
    expect(result.code).toBe(0);
  });

  it("fails when the baseline blanket revoke is missing entirely", () => {
    const result = run(
      fixture("no-blanket.sql", "create function public.f() returns void language sql as $$ select 1 $$;\n"),
    );
    expect(result.code).toBe(1);
    expect(result.out).toContain("no schema-wide");
  });

  it("keeps every public-source control-plane definer service-role-only", () => {
    const schema = readFileSync("supabase/schema.sql", "utf8");
    const migration = readFileSync("supabase/migrations/20260820121000_create_public_source_control_plane.sql", "utf8");
    const lifecycleAuthority = readFileSync(
      "supabase/migrations/20260824120000_consolidate_public_source_lifecycle_authority.sql",
      "utf8",
    );
    const result = run(fixture("public-source-control-plane.sql", `${schema}\n${migration}\n${lifecycleAuthority}`));
    expect(result.out).toContain("OK");
    expect(result.code).toBe(0);
  });
});
