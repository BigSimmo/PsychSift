import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("site-content gate generated type parity", () => {
  it("keeps generated deployment identity, synchronizer state, and runtime RPCs in type parity", () => {
    const root = resolve(import.meta.dirname, "..");
    const types = readFileSync(resolve(root, "src/lib/supabase/database.types.ts"), "utf8");
    const migration = readFileSync(
      resolve(root, "supabase/migrations/20260827213539_add_site_content_runtime_authority.sql"),
      "utf8",
    );
    const releaseBlock =
      types.match(/site_content_releases:\s*\{([\s\S]*?)\n\s*\};\n\s*site_content_synchronizer_state/)?.[1] ?? "";
    expect(releaseBlock).toMatch(/Row:[\s\S]*deployment_sha:\s*string/);
    expect(releaseBlock.match(/Insert:\s*\{([\s\S]*?)\n\s*\};\n\s*Update/)?.[1] ?? "").not.toContain("deployment_sha");
    expect(types).toContain("site_content_synchronizer_state: {");
    expect(types).toMatch(/read_site_content_runtime_authority:\s*\{ Args: never; Returns: Json \}/);
    expect(types).toMatch(/record_site_content_synchronizer_heartbeat:[\s\S]*p_invocation_id: string/);
    expect(migration).toMatch(/deployment_sha text[\s\S]*generated always/i);
  });

  it("matches the exact migration columns and relationships", () => {
    const root = resolve(import.meta.dirname, "..");
    const types = readFileSync(resolve(root, "src/lib/supabase/database.types.ts"), "utf8");
    const migration = readFileSync(
      resolve(root, "supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql"),
      "utf8",
    );
    const block =
      types.match(/site_content_release_gate_artifacts:\s*\{([\s\S]*?)\n\s*\};\n\s*site_content_validation/)?.[1] ?? "";
    const expectedColumns = [
      "artifact",
      "artifact_digest",
      "observed_at",
      "owner",
      "recorded_at",
      "release_id",
      "subject",
      "subject_digest",
    ];
    const rowBlock = block.match(/Row:\s*\{([\s\S]*?)\n\s*\};\n\s*Insert/)?.[1] ?? "";
    const insertBlock = block.match(/Insert:\s*\{([\s\S]*?)\n\s*\};\n\s*Update/)?.[1] ?? "";
    const fields = (value: string) => [...value.matchAll(/^\s*(\w+)\??:/gm)].map((match) => match[1]).sort();
    expect(fields(rowBlock)).toEqual(expectedColumns);
    expect(fields(insertBlock)).toEqual(expectedColumns);
    expect(block).toMatch(/Row:[\s\S]*observed_at:\s*string/);
    expect(block).toMatch(/Insert:[\s\S]*observed_at:\s*string/);
    expect(block).toMatch(/Relationships:\s*\[\]/);
    expect(block).not.toMatch(/release_id_fkey/);
    const migrationBlock =
      migration.match(/create table public\.site_content_release_gate_artifacts\s*\(([\s\S]*?)\n\);/)?.[1] ?? "";
    expect(migrationBlock).toMatch(/observed_at\s+timestamptz\s+not null/i);
    expect(migrationBlock).not.toMatch(/release_id[^,\n]*references/i);
    for (const functionName of [
      "provision_site_content_validation_secret",
      "provision_site_content_governance_gate_owner_secret",
      "provision_rag_programme_gate_owner_secret",
    ]) {
      expect(types).toMatch(new RegExp(`${functionName}: \\{[\\s\\S]*?p_configuration: Json`, "i"));
      expect(migration).toMatch(new RegExp(`function public\\.${functionName}\\(p_configuration jsonb\\)`, "i"));
    }
  });
});
