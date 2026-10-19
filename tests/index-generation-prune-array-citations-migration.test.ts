import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static contract for the F-09 follow-up: images cited through uuid arrays survive the prune.
// Behaviour is proven against a replayed database by tests/sql/index-generation-prune.sql.
const name = "20261019180000_prune_keeps_array_cited_images.sql";
const sql = readFileSync(`supabase/migrations/${name}`, "utf8");
const schema = readFileSync("supabase/schema.sql", "utf8");
const code = sql.replace(/--.*$/gm, "");

describe("prune keeps array-cited images migration", () => {
  it("is mirrored verbatim in schema.sql", () => {
    expect(schema).toContain(`-- Projection: ${name}`);
    expect(schema).toContain(sql.trimEnd());
  });

  it("only replaces the prune function, with bounded timeouts and unchanged grants", () => {
    expect(code).toContain("set local lock_timeout = '5s';");
    expect(code).toContain("set local statement_timeout = '30s';");
    expect(code).toMatch(/create or replace function public\.prune_superseded_document_index_generations\(/);
    expect(code).not.toMatch(/\b(drop|alter)\s+table\b/i);
    expect(code).not.toMatch(/create trigger/i);
    expect(code).toContain("security definer");
    expect(code).toContain("set search_path = ''");
    expect(code).toMatch(
      /revoke all on function public\.prune_superseded_document_index_generations\(uuid, uuid\[\], integer\)\s+from public, anon, authenticated, service_role;/,
    );
  });

  it("keeps images named by chunk, memory card and summary arrays, and prunes images last", () => {
    expect(code).toContain("unnest(c.image_ids)");
    expect(code).toContain("from public.document_chunks c");
    expect(code).toContain("from public.document_memory_cards m");
    expect(code).toContain("from public.document_summaries s");
    expect(code).toContain("t.id <> all(v_cited_images)");
    expect(code).toMatch(/'document_chunks',\s*'document_images'\s*\]/);
  });
});
