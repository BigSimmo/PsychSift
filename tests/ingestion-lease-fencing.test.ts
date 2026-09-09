import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  IngestionAttempt,
  parseIngestionFence,
  parseIngestionMutationResult,
  type IngestionFence,
} from "../supabase/functions/_shared/ingestion-attempt";
import { runIngestionMutation } from "../worker/behavior";
import { runEdgeIngestionMutation } from "../supabase/functions/indexing-v3-agent/behavior";

const fence: IngestionFence = {
  job_kind: "node",
  job_id: "11111111-1111-4111-8111-111111111111",
  document_id: "22222222-2222-4222-8222-222222222222",
  worker_id: "same-worker",
  lease_token: "33333333-3333-4333-8333-333333333333",
  expected_generation_id: "44444444-4444-4444-8444-444444444444",
  authority_digest: `sha256:${"a".repeat(64)}`,
};
const nextGeneration = "55555555-5555-4555-8555-555555555555";
const nodeOperations = [
  "heartbeat_ingestion_job",
  "update_ingestion_job_progress",
  "patch_ingestion_document_state",
  "reset_ingestion_attempt_artifacts",
  "write_ingestion_base_artifacts",
  "persist_ingestion_index_quality",
  "persist_ingestion_summary_projection",
  "stage_ingestion_deep_memory",
  "cleanup_ingestion_deep_memory_staging",
  "commit_document_deep_memory_generation",
  "persist_ingestion_image_caption_cache",
  "prepare_ingestion_image_upload",
  "complete_ingestion_job",
  "fail_or_retry_ingestion_job",
  "complete_strict_enrichment_job",
];
describe("actual mutation transport boundaries with an in-memory durable authority", () => {
  it.each(nodeOperations)("binds %s to the complete durable attempt and cancels stale continuation", async (name) => {
    const attempt = new IngestionAttempt(fence);
    const committed = { summary: "G2", manual: "retained" };
    const live = { ...fence, lease_token: nextGeneration };
    const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => {
      expect(args.p_fence).toEqual(fence);
      return JSON.stringify(args.p_fence) === JSON.stringify(live)
        ? { data: { ok: true }, error: null }
        : { data: { ok: false, reason: "lease_lost" }, error: null };
    });
    await expect(runIngestionMutation(attempt, rpc, name)).rejects.toMatchObject({ code: "lease_lost" });
    await expect(runIngestionMutation(attempt, rpc, name)).rejects.toMatchObject({ code: "lease_lost" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(committed).toEqual({ summary: "G2", manual: "retained" });
    expect(attempt.signal.aborted).toBe(true);
  });
  it.each(
    [undefined, null, false, { ok: false }, { ok: true, fence: null }, [], { ok: false, reason: "unknown" }].map(
      (value) => ({ value }),
    ),
  )("rejects malformed core response %# without a handoff", async ({ value }) => {
    const attempt = new IngestionAttempt(fence);
    const rpc = vi.fn(async () => ({ data: value, error: null }));
    await expect(
      runIngestionMutation(attempt, rpc, "commit_document_index_generation", { p_generation: nextGeneration }),
    ).rejects.toBeDefined();
    expect(attempt.signal.aborted).toBe(true);
  });
  it("accepts only the reserved generation in an otherwise identical core handoff", async () => {
    const attempt = new IngestionAttempt(fence);
    const next = { ...fence, expected_generation_id: nextGeneration };
    await runIngestionMutation(
      attempt,
      async () => ({ data: { ok: true, fence: next }, error: null }),
      "commit_document_index_generation",
      { p_generation: nextGeneration },
    );
    expect(attempt.fence).toEqual(next);
    const wrong = new IngestionAttempt(fence);
    await expect(
      runIngestionMutation(
        wrong,
        async () => ({ data: { ok: true, fence: next }, error: null }),
        "commit_document_index_generation",
        { p_generation: fence.expected_generation_id },
      ),
    ).rejects.toMatchObject({ code: "ingestion_rpc_invalid" });
  });
  it.each(["lease_token", "authority_digest", "expected_generation_id", "job_kind"])(
    "Edge refuses replacement %s through its actual import-safe boundary",
    async (key) => {
      const edgeFence = { ...fence, job_kind: "indexing_v3" as const };
      const attempt = new IngestionAttempt(edgeFence);
      const live = {
        ...edgeFence,
        [key]: key === "job_kind" ? "node" : key === "authority_digest" ? `sha256:${"b".repeat(64)}` : nextGeneration,
      };
      const execute = vi.fn(async (sent: IngestionFence) =>
        JSON.stringify(sent) === JSON.stringify(live) ? { ok: true } : { ok: false, reason: "lease_lost" },
      );
      await expect(runEdgeIngestionMutation(attempt, execute)).rejects.toMatchObject({ code: "lease_lost" });
      expect(attempt.signal.aborted).toBe(true);
      await expect(runEdgeIngestionMutation(attempt, execute)).rejects.toMatchObject({ code: "lease_lost" });
      expect(execute).toHaveBeenCalledOnce();
    },
  );
  it("transport error and malformed success never authorize a fallback", async () => {
    const attempt = new IngestionAttempt(fence);
    const execute = vi.fn(async () => {
      throw new Error("RPC missing");
    });
    await expect(runEdgeIngestionMutation(attempt, execute)).rejects.toThrow("RPC missing");
    expect(attempt.signal.aborted).toBe(true);
    for (const value of [undefined, null, false, [], { ok: false }, { ok: false, reason: "lease_lost", extra: true }])
      expect(() => parseIngestionMutationResult(value)).toThrow();
  });
  it("requires every fence field and rejects malformed or null Edge generation", () => {
    for (const key of Object.keys(fence)) {
      const value = { ...fence } as Record<string, unknown>;
      delete value[key];
      expect(() => parseIngestionFence(value)).toThrow();
    }
    expect(() => parseIngestionFence({ ...fence, job_kind: "indexing_v3", expected_generation_id: null })).toThrow();
    expect(() => parseIngestionFence({ ...fence, lease_token: "bad" })).toThrow();
  });
});

const migration = readFileSync(
  new URL("../supabase/migrations/20260831101000_fence_ingestion_leases_and_repairs.sql", import.meta.url),
  "utf8",
);
function body(name: string) {
  const start = migration.indexOf(`function public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  return migration.slice(start, migration.indexOf("end $$;", start));
}
describe("authored SQL fencing contracts (static; no SQL execution)", () => {
  it.each(["claim_ingestion_jobs", "claim_indexing_v3_agent_jobs"])(
    "%s rejects explicit null claim bounds and issues fresh attempts",
    (name) => {
      const sql = body(name);
      expect(sql).toContain("p_claim_limit is null");
      expect(sql).toContain("p_claim_limit not between 1 and 100");
      expect(sql).toContain("p_stale_after_minutes is null");
      expect(sql).toContain("lease_token = gen_random_uuid()");
      expect(sql).toContain("lease_duration_seconds = p_stale_after_minutes * 60");
      expect(sql.indexOf("lock_ingestion_document_authority")).toBeLessThan(sql.indexOf("for update skip locked"));
    },
  );
  it("uses marker presence including JSON null and refuses active P05 mutation authority", () => {
    const sql = body("lock_ingestion_document_authority");
    expect(sql).toContain("?| array['source_catalogue_key'");
    expect(sql).toContain("v_version.lifecycle not in ('shadow', 'approved')");
    expect(sql).not.toContain("'approved', 'active'");
    expect(sql).toContain(
      "public.public_source_acquisition_identity_digest(v_version.id) is distinct from v_version.acquisition_identity_digest",
    );
  });
  it("rejects null summary discriminators and uses an atomic projection boundary", () => {
    const sql = body("persist_ingestion_summary_projection");
    expect(sql).toContain("coalesce(v_payload->>'summary_kind','') not in ('structured','heuristic_fallback')");
    expect(sql).toContain("source = 'generated'");
    expect(sql).toContain("jsonb_merge_deep(metadata,p_metadata)");
  });
  it("checks wall clock under locks, exact generation and live source authority", () => {
    const sql = body("assert_current_ingestion_attempt");
    expect(sql.indexOf("clock_timestamp()")).toBeGreaterThan(sql.indexOf("for update"));
    for (const key of Object.keys(fence)) expect(sql).toContain(key);
    expect(sql).toContain("v_job->>'lease_write_generation_id'");
    expect(sql).toContain("v_locked->>'authority_digest' is distinct from p_fence->>'authority_digest'");
  });
  it("retains append-only dry-run audit, canonical UTF8 bytes and revoked obsolete repair", () => {
    const sql = body("record_ingestion_repair_plan");
    expect(sql).toContain("jsonb_array_length(p_plan->'documents') not between 1 and 100");
    expect(sql).toContain("convert_to(v_bytes,'UTF8')");
    expect(sql).not.toMatch(/(?:update|delete from) public\.(?:documents|ingestion_jobs)/);
    expect(migration).toContain("before update or delete on public.ingestion_repair_plan_audit");
    expect(migration).toContain("before truncate on public.ingestion_repair_plan_audit");
    expect(migration).toContain(
      "repair_strict_enrichment_gate_batch(integer) from public,anon,authenticated,service_role",
    );
  });
  it("mirrors effective U03 objects in the schema while excluding only the migration drain", () => {
    const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
    const marker = "-- Fresh schema has no processing leases to drain; migration-only precondition is omitted.\n";
    expect(schema.slice(schema.indexOf(marker) + marker.length)).toBe(
      migration.slice(migration.indexOf("alter table public.ingestion_jobs")),
    );
  });
});

const schemaSnapshot = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
const p05Hardening = readFileSync(
  new URL("../supabase/migrations/20260824123000_harden_public_source_lifecycle_authority.sql", import.meta.url),
  "utf8",
);
const p05Consolidation = readFileSync(
  new URL("../supabase/migrations/20260824120000_consolidate_public_source_lifecycle_authority.sql", import.meta.url),
  "utf8",
);
const p05Approval = readFileSync(
  new URL("../supabase/migrations/20260822123000_govern_australian_source_activation.sql", import.meta.url),
  "utf8",
);
const publicationOwner = readFileSync(
  new URL("../supabase/migrations/20260717131000_guard_document_publication_approval.sql", import.meta.url),
  "utf8",
);
function functionDefinition(sql: string, name: string) {
  const matches = Array.from(
    sql.matchAll(new RegExp(`create or replace function public\\.${name}\\([^]*?\\$\\$;`, "gi")),
  );
  expect(matches.length).toBeGreaterThan(0);
  return matches.at(-1)![0].trim();
}
function triggerDefinition(sql: string, name: string) {
  const matches = Array.from(sql.matchAll(new RegExp(`create (?:constraint )?trigger ${name}\\s[^;]+;`, "gi")));
  expect(matches.length).toBeGreaterThan(0);
  return matches.at(-1)![0].replace(/\s+/g, " ").toLowerCase();
}
const p05Internal = [
  "reject_public_source_activation_event_mutation()",
  "guard_public_source_version_identity()",
  "bump_public_source_serving_authority()",
  "public_source_acquisition_identity_digest(uuid)",
  "make_public_source_version_ineligible(uuid,text)",
  "make_public_source_version_ineligible(uuid)",
  "public_source_document_is_serving_eligible(uuid)",
  "require_active_public_source_version_for_publication()",
  "require_active_public_source_artifact_for_publication()",
  "require_document_publication_approval_state_digest()",
  "guard_document_publication_transition()",
];
describe("reviewed P05 dependency closure (static source, no installed privilege proof)", () => {
  it.each([
    { name: "require_document_publication_approval_state_digest", owner: p05Approval },
    { name: "public_source_document_is_serving_eligible", owner: p05Hardening },
    { name: "require_active_public_source_version_for_publication", owner: p05Hardening },
    { name: "require_active_public_source_artifact_for_publication", owner: p05Hardening },
    { name: "guard_document_publication_transition", owner: p05Consolidation },
  ])("preserves the exact effective $name function", ({ name, owner }) => {
    expect(functionDefinition(schemaSnapshot, name)).toBe(functionDefinition(owner, name));
  });
  it("restores all nine active-version triggers and preserves approval/publication bindings", () => {
    for (const table of [
      "document_labels",
      "document_summaries",
      "document_sections",
      "document_memory_cards",
      "document_table_facts",
      "document_embedding_fields",
      "document_index_quality",
      "document_index_units",
    ])
      expect(triggerDefinition(schemaSnapshot, `public_source_${table}_require_active_version`)).toBe(
        triggerDefinition(p05Hardening, `public_source_${table}_require_active_version`),
      );
    expect(triggerDefinition(schemaSnapshot, "public_source_documents_require_active_version")).toBe(
      triggerDefinition(p05Consolidation, "public_source_documents_require_active_version"),
    );
    expect(triggerDefinition(schemaSnapshot, "document_publication_approvals_require_state_digest")).toBe(
      triggerDefinition(p05Approval, "document_publication_approvals_require_state_digest"),
    );
    expect(triggerDefinition(schemaSnapshot, "documents_require_publication_approval")).toBe(
      triggerDefinition(publicationOwner, "documents_require_publication_approval"),
    );
  });
  it.each([
    { name: "migration", sql: migration },
    { name: "snapshot", sql: schemaSnapshot },
  ])("ends $name with only the named table and internal-function ACL corrections", ({ sql }) => {
    const compact = sql.replace(/\s+/g, " ").toLowerCase();
    for (const table of [
      "public_source_activation_events",
      "public_source_versions",
      "public_source_serving_authority",
    ]) {
      const revoke = `revoke all on table public.${table} from service_role;`;
      const grant = `grant select on table public.${table} to service_role;`;
      expect(compact.lastIndexOf(revoke)).toBeGreaterThan(-1);
      expect(compact.lastIndexOf(grant)).toBeGreaterThan(compact.lastIndexOf(revoke));
      expect(compact.slice(compact.lastIndexOf(grant) + grant.length)).not.toMatch(
        new RegExp(`grant [^;]+ on (?:table )?public\\.${table}[^;]+service_role`, "i"),
      );
    }
    for (const signature of p05Internal) {
      const revoke = `revoke all on function public.${signature} from service_role;`;
      expect(compact).toContain(revoke);
      const tail = compact.slice(compact.lastIndexOf(revoke) + revoke.length).replace(/\s+/g, "");
      expect(tail).not.toContain(`grantexecuteonfunctionpublic.${signature}toservice_role;`);
    }
  });
  it("retains all eight governed migration grants and no direct new worker calls to internal helpers", () => {
    for (const signature of [
      "record_public_source_activation_event(jsonb)",
      "create_public_source_fetch_manifest(text,text,text,uuid,text,text,text,uuid)",
      "stage_public_source_version(jsonb)",
      "activate_public_source_version(jsonb)",
      "transition_public_source_version(uuid,text,text,text,text,text)",
      "record_unchanged_public_source_check(jsonb)",
      "tombstone_public_source_version_for_review(uuid,text,text,text,text,text)",
      "public_source_serving_authority_stamp()",
    ]) {
      expect((p05Hardening + p05Consolidation).replace(/\s+/g, "").toLowerCase()).toContain(
        `grantexecuteonfunctionpublic.${signature}toservice_role;`,
      );
      expect(migration.replace(/\s+/g, "").toLowerCase()).not.toContain(`revokeallonfunctionpublic.${signature}`);
    }
    for (const file of [
      "../worker/main.ts",
      "../src/lib/document-enrichment.ts",
      "../src/lib/deep-memory.ts",
      "../supabase/functions/indexing-v3-agent/index.ts",
    ]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      for (const signature of p05Internal) expect(source).not.toContain(signature.split("(")[0]);
    }
  });
});
