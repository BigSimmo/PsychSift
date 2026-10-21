/**
 * Roll documents back to their previous committed index generation.
 *
 * Dry run by default: prints, per document, the current and previous generation with chunk
 * counts and whether the rollback would proceed. Writes only with --apply.
 *
 *   npm run reindex:rollback -- --document-id <uuid>[,<uuid>]
 *   npm run reindex:rollback -- --committed-after 2026-10-21T00:00:00Z
 *   npm run reindex:rollback -- --chunker-version 1.3.1-page
 *   npm run reindex:rollback -- --document-id <uuid> --apply [--yes] [--limit 50]
 *
 * See docs/reindex-runbook.md, "Rolling back a reindex".
 */
import { loadEnvConfig } from "@next/env";
import {
  applyRollbackPlans,
  collectCommittedGenerations,
  formatRollbackOutcome,
  parseRollbackArgs,
  runReindexRollback,
  type RollbackScope,
  type RollbackStore,
} from "@/lib/reindex-rollback";
import { assertSupabaseHealthy, probeSupabaseHealth } from "@/lib/supabase/health";
import type { createAdminClient as CreateAdminClient } from "@/lib/supabase/admin";
import { confirm } from "./cli-utils";

loadEnvConfig(process.cwd());

type AdminClient = ReturnType<typeof CreateAdminClient>;
const PAGE = 1000;

function supabaseRollbackStore(supabase: AdminClient): RollbackStore {
  // Pages through every matching row and yields each distinct document id once. No limit
  // here: the planner applies the document limit after the exact scope filter.
  async function* distinctDocumentIds(
    load: (
      from: number,
      to: number,
    ) => PromiseLike<{ data: { document_id: string }[] | null; error: { message: string } | null }>,
  ) {
    const ids = new Set<string>();
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await load(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      for (const row of data ?? []) {
        if (ids.has(row.document_id)) continue;
        ids.add(row.document_id);
        yield row.document_id;
      }
      if (!data || data.length < PAGE) break;
    }
  }
  return {
    async *candidateDocumentIds(scope: RollbackScope) {
      if (scope.kind === "documents") {
        yield* scope.documentIds;
        return;
      }
      if (scope.kind === "committed-after") {
        yield* distinctDocumentIds((from, to) =>
          supabase
            .from("document_pages")
            .select("document_id")
            .not("index_generation_id", "is", null)
            .gt("created_at", scope.after)
            .order("created_at", { ascending: false })
            .order("id")
            .range(from, to),
        );
        return;
      }
      yield* distinctDocumentIds((from, to) =>
        supabase
          .from("document_chunks")
          .select("document_id")
          .eq("metadata->>chunker_version", scope.chunkerVersion)
          .order("document_id")
          .order("id")
          .range(from, to),
      );
    },
    async currentGeneration(documentId) {
      const { data, error } = await supabase
        .from("documents")
        .select("index_generation_id")
        .eq("id", documentId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data?.index_generation_id ?? null;
    },
    async committedGenerations(documentId) {
      return collectCommittedGenerations(async (from, to) => {
        const { data, error } = await supabase
          .from("document_pages")
          .select("index_generation_id,created_at")
          .eq("document_id", documentId)
          .not("index_generation_id", "is", null)
          .order("created_at", { ascending: true })
          .order("id")
          .range(from, to);
        if (error) throw new Error(error.message);
        // document_pages.index_generation_id exists in supabase/schema.sql but not yet in the
        // generated database types, so the row shape is stated here.
        return (data ?? []) as unknown as Array<{ index_generation_id: string | null; created_at: string }>;
      }, PAGE);
    },
    async chunkCount(documentId, generationId) {
      const { count, error } = await supabase
        .from("document_chunks")
        .select("id", { count: "exact", head: true })
        .eq("document_id", documentId)
        .eq("index_generation_id", generationId);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
    async chunkerVersions(documentId, generationId) {
      const { data, error } = await supabase
        .from("document_chunks")
        .select("metadata")
        .eq("document_id", documentId)
        .eq("index_generation_id", generationId)
        .limit(50);
      if (error) throw new Error(error.message);
      const versions = (data ?? []).map((row) => {
        const metadata = row.metadata as Record<string, unknown> | null;
        return typeof metadata?.chunker_version === "string" ? metadata.chunker_version : null;
      });
      return [...new Set(versions.filter((value): value is string => Boolean(value)))];
    },
    async repoint(documentId, expectedGeneration, targetGeneration) {
      const { data, error } = await supabase.rpc("rollback_document_index_generation", {
        p_document_id: documentId,
        p_expected_generation: expectedGeneration,
        p_target_generation: targetGeneration,
      });
      if (error) throw new Error(error.message);
      const result = (data ?? {}) as { ok?: boolean; reason?: string };
      return { ok: result.ok === true, reason: result.reason };
    },
  };
}

async function main() {
  const args = parseRollbackArgs(process.argv.slice(2));
  const [{ env, requireServerEnv }, { createAdminClient }] = await Promise.all([
    import("@/lib/env"),
    import("@/lib/supabase/admin"),
  ]);
  requireServerEnv();
  const supabase = createAdminClient();

  console.log("=== Reindex Generation Rollback ===");
  console.log(`Supabase project: ${env.SUPABASE_PROJECT_NAME ?? "unknown"} (${env.SUPABASE_PROJECT_REF ?? "unknown"})`);
  console.log(`Mode            : ${args.apply ? "apply" : "dry-run"}`);
  console.log(`Scope           : ${JSON.stringify(args.scope)}`);
  console.log(`Document limit  : ${args.limit}`);
  console.log("");

  assertSupabaseHealthy(await probeSupabaseHealth(supabase), "Reindex generation rollback");
  const store = supabaseRollbackStore(supabase);

  const preview = await runReindexRollback(store, args.scope, { apply: false, limit: args.limit });
  for (const outcome of preview) console.log(formatRollbackOutcome(outcome, false));
  const ready = preview.filter((outcome) => !outcome.refusal).length;
  console.log(`\nDocuments in scope: ${preview.length}; would roll back: ${ready}; refused: ${preview.length - ready}`);

  if (!args.apply) {
    console.log("\nDry run only. Re-run with --apply to repoint the documents above.");
    return;
  }
  if (ready === 0) return;
  if (!args.yes && !(await confirm(`Roll back ${ready} document(s) to their previous generation?`))) {
    console.log("Aborted.");
    return;
  }
  // Apply exactly the plans shown above; the RPC fails closed (pointer_moved) on any drift.
  const applied = await applyRollbackPlans(store, preview);
  for (const outcome of applied) console.log(formatRollbackOutcome(outcome, true));
  const failed = applied.filter((outcome) => !outcome.refusal && !outcome.applied).length;
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
