import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static contract for the second F-09 follow-up: chunks cited through uuid arrays survive the
// prune. Behaviour is proven against a replayed database by tests/sql/index-generation-prune.sql.
const name = "20261019183000_prune_keeps_array_cited_chunks.sql";
const sql = readFileSync(`supabase/migrations/${name}`, "utf8");
const schema = readFileSync("supabase/schema.sql", "utf8");
const code = sql.replace(/--.*$/gm, "");

describe("prune keeps array-cited chunks migration", () => {
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

  it("keeps chunks named by summary, section and memory card arrays, and keeps the image guard", () => {
    expect(code).toContain("unnest(s.source_chunk_ids)");
    expect(code).toContain("unnest(sec.chunk_ids)");
    expect(code).toContain("unnest(m.source_chunk_ids)");
    expect(code).toContain("t.id <> all(v_cited_chunks)");
    expect(code).toContain("t.id <> all(v_cited_images)");
    expect(code).toMatch(/'document_sections',\s*'document_pages',\s*'document_chunks',\s*'document_images'\s*\]/);
  });
});
