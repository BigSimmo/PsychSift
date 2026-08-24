import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

import { readPublicSiteContentPartition } from "../src/lib/site-content/public-site-content";

const root = new URL("..", import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1));
const migrations = join(root, "supabase", "migrations");

function taskMigration() {
  const file = readdirSync(migrations).find((entry) => entry.endsWith("_add_site_content_release_and_outbox.sql"));
  expect(file).toBeDefined();
  return { file: file!, sql: readFileSync(join(migrations, file!), "utf8") };
}

describe("public site-content publication access", () => {
  it("uses bundled fallback only when the reader RPC is not yet applied and preserves authoritative empty partitions", async () => {
    const missing = {
      rpc: async () => ({ data: null, error: { code: "42883", message: "function does not exist" } }),
    };
    await expect(readPublicSiteContentPartition(missing as never, { domain: "medications" })).resolves.toBeNull();

    const empty = {
      rpc: async () => ({
        data: { activeReleaseId: "release-1", changeEpoch: 7, state: "current", records: [] },
        error: null,
      }),
    };
    await expect(readPublicSiteContentPartition(empty as never, { domain: "medications" })).resolves.toEqual({
      activeReleaseId: "release-1",
      changeEpoch: 7,
      state: "current",
      records: [],
    });

    const failed = { rpc: async () => ({ data: null, error: { message: "database unavailable" } }) };
    await expect(readPublicSiteContentPartition(failed as never, { domain: "medications" })).rejects.toThrow(
      "Canonical public site-content read failed.",
    );
  });
  it("allocates a forward-only migration after every existing migration", () => {
    const { file } = taskMigration();
    const timestamps = readdirSync(migrations)
      .filter((entry) => entry !== file)
      .map((entry) => Number(entry.slice(0, 14)))
      .filter(Number.isFinite);
    expect(Number(file.slice(0, 14))).toBeGreaterThan(Math.max(...timestamps));
  });

  it("publishes the public row, epoch, pending exclusion, and outbox atomically behind administrator authority", () => {
    const { sql } = taskMigration();
    expect(sql).toMatch(/create table public\.site_content_publications/i);
    expect(sql).toMatch(/create unique index[\s\S]*logical_id/i);
    expect(sql).toMatch(/create table public\.site_content_sync_outbox/i);
    expect(sql).toMatch(/create table public\.site_content_public_authority/i);
    expect(sql).toMatch(/create or replace function public\.publish_site_content_record/i);
    expect(sql).toMatch(/administrator_authorized[\s\S]*raise exception/i);
    expect(sql).toMatch(/change_epoch\s*=\s*change_epoch\s*\+\s*1/i);
    expect(sql).toMatch(/insert into public\.site_content_sync_outbox/i);
    expect(sql).toMatch(/delete from public\.rag_response_cache/i);
    expect(sql).toMatch(/revoke all[\s\S]*from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute[\s\S]*to service_role/i);
    expect(sql).not.toMatch(/grant (?:insert|update|delete)[^;]* to (?:anon|authenticated)/i);
  });

  it("defines fixed-search-path lease fencing, exact pending anti-join, activation, and retained rollback receipts", () => {
    const { sql } = taskMigration();
    for (const name of [
      "claim_site_content_sync_events",
      "heartbeat_site_content_sync_event",
      "complete_site_content_sync_event",
      "fail_site_content_sync_event",
      "activate_site_content_release",
      "rollback_site_content_release",
    ]) {
      expect(sql).toContain(`function public.${name}`);
    }
    expect(sql).toMatch(/for update skip locked/i);
    expect(sql).toMatch(/lease_id[\s\S]*generation_id[\s\S]*lease_expires_at/i);
    expect(sql).toMatch(/not exists[\s\S]*site_content_sync_outbox[\s\S]*logical_id/i);
    expect(sql).toMatch(/set search_path = ''/i);
    expect(sql).toMatch(/restoration_method[\s\S]*retained-pointer/i);
  });

  it("keeps reader selection independent of actor and legacy owner identity", () => {
    const routePaths = [
      "src/app/api/registry/records/route.ts",
      "src/app/api/registry/records/[slug]/route.ts",
      "src/app/api/medications/route.ts",
      "src/app/api/medications/[slug]/route.ts",
      "src/app/api/differentials/route.ts",
      "src/app/api/differentials/[slug]/route.ts",
      "src/app/api/differentials/presentations/[slug]/route.ts",
    ];
    for (const routePath of routePaths) {
      const source = readFileSync(join(root, routePath), "utf8");
      expect(source, basename(routePath)).not.toMatch(/\.eq\("owner_id",\s*access\.ownerId\)/);
      expect(source, basename(routePath)).not.toMatch(/fetchOwner[A-Za-z]+Rows/);
      expect(source, basename(routePath)).toMatch(/canonical public|publicSiteContent|public.*payload/i);
      expect(source).not.toMatch(/export async function (?:POST|PUT|PATCH|DELETE)/);
    }
  });
});
