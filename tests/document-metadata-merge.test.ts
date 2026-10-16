import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workerMain = readFileSync(new URL("../worker/main.ts", import.meta.url), "utf8");
const schemaSql = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
const r5Migration = readFileSync(
  new URL("../supabase/migrations/20260708310000_r5_document_metadata_merge.sql", import.meta.url),
  "utf8",
);

/**
 * Mirrors public.jsonb_merge_deep so the worker-owned-delta contract stays
 * covered offline (the SQL helper is exercise-checked via migration + live
 * apply). Nested objects merge recursively; scalars/arrays overwrite; JSON
 * null deletes the key (same as `merged - key` in SQL).
 */
function jsonbMergeDeep(
  targetObj: Record<string, unknown> | null | undefined,
  patchObj: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(targetObj ?? {}) };
  for (const [key, incoming] of Object.entries(patchObj ?? {})) {
    if (incoming === null) {
      delete merged[key];
      continue;
    }
    const existing = merged[key];
    if (
      existing !== null &&
      typeof existing === "object" &&
      !Array.isArray(existing) &&
      typeof incoming === "object" &&
      !Array.isArray(incoming)
    ) {
      merged[key] = jsonbMergeDeep(existing as Record<string, unknown>, incoming as Record<string, unknown>);
    } else {
      merged[key] = incoming;
    }
  }
  return merged;
}

describe("R5 document metadata deep-merge", () => {
  it("preserves concurrent rename/agent keys when worker sends owned deltas only", () => {
    const live = {
      title_override: "Renamed while reindexing",
      agent_state: { pass: "indexing-v3-agent", note: "keep me" },
      bulk_tag: "operator",
      enrichment_status: "completed",
    };
    const workerDelta = {
      indexed_at: "2026-07-08T12:00:00.000Z",
      index_generation_id: "gen-2",
      enrichment_status: "pending",
      indexing_v3_agent_status: "pending",
      page_count: 12,
    };

    expect(jsonbMergeDeep(live, workerDelta)).toEqual({
      title_override: "Renamed while reindexing",
      agent_state: { pass: "indexing-v3-agent", note: "keep me" },
      bulk_tag: "operator",
      indexed_at: "2026-07-08T12:00:00.000Z",
      index_generation_id: "gen-2",
      enrichment_status: "pending",
      indexing_v3_agent_status: "pending",
      page_count: 12,
    });
  });

  it("deep-merges nested objects without dropping sibling keys", () => {
    const live = {
      index_quality_metrics: { text_character_count: 100, page_count: 3 },
      labels: ["keep"],
    };
    const workerDelta = {
      index_quality_metrics: { text_character_count: 400, ocr_page_count: 1 },
    };

    expect(jsonbMergeDeep(live, workerDelta)).toEqual({
      index_quality_metrics: {
        text_character_count: 400,
        page_count: 3,
        ocr_page_count: 1,
      },
      labels: ["keep"],
    });
  });

  it("overwrites scalar and array keys from the patch", () => {
    expect(
      jsonbMergeDeep(
        { enrichment_status: "completed", issues: ["a"], note: "old" },
        { enrichment_status: "failed", issues: ["b"], note: "set" },
      ),
    ).toEqual({
      enrichment_status: "failed",
      issues: ["b"],
      note: "set",
    });
  });

  it("deletes sticky keys when the patch sends JSON null", () => {
    expect(
      jsonbMergeDeep(
        {
          indexing_v3_agent_last_error: "old",
          completion_gate_missing: ["image_caption"],
          keep: true,
        },
        {
          indexing_v3_agent_last_error: null,
          completion_gate_missing: null,
        },
      ),
    ).toEqual({ keep: true });
  });

  it("keeps the SQL merge helpers + grant posture in schema and the R5 migration", () => {
    for (const sql of [schemaSql, r5Migration]) {
      expect(sql).toContain("create or replace function public.jsonb_merge_deep");
      expect(sql).toContain("create or replace function public.apply_document_metadata_patch");
      expect(sql).toContain("perform public.apply_document_metadata_patch(");
      expect(sql).toContain(
        "revoke execute on function public.jsonb_merge_deep(jsonb, jsonb) from public, anon, authenticated",
      );
      expect(sql).toContain(
        "grant execute on function public.apply_document_metadata_patch(uuid, jsonb) to service_role",
      );
    }
  });

  it("routes worker document metadata updates through the merge RPC with owned deltas only", () => {
    // Fenced leases: patch_ingestion_document_state (lease-fenced) replaces the unfenced
    // apply_document_metadata_patch call and keeps the same jsonb_merge_deep semantics.
    expect(workerMain).toContain('await mutation(attemptForDocument(documentId), "patch_ingestion_document_state", {');
    expect(workerMain).toContain("p_metadata: sanitizeJsonbRecord(metadata ?? {}),");
    expect(workerMain).not.toContain('rpc("apply_document_metadata_patch"');
    expect(workerMain).toContain("send only worker-owned key deltas");
    expect(workerMain).not.toContain("...(job.documents.metadata");
    const patchStart = schemaSql.lastIndexOf("create or replace function public.patch_ingestion_document_state(");
    expect(patchStart).toBeGreaterThan(-1);
    const patchBody = schemaSql.slice(patchStart, schemaSql.indexOf("end $$;", patchStart));
    expect(patchBody).toContain("public.assert_current_ingestion_attempt(p_fence");
    expect(patchBody).toContain("metadata=public.jsonb_merge_deep(metadata,p_metadata)");
    // Only worker-owned keys may be patched; anything else is rejected, not merged.
    expect(patchBody).toMatch(/jsonb_object_keys\(p_metadata\) k where k <> all\(array\[/);
    expect(patchBody).toContain("raise exception 'invalid_ingestion_document_patch'");
  });
});
