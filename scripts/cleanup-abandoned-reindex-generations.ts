import { loadEnvConfig } from "@next/env";
import {
  abandonedReindexGenerationAlertExitCode,
  abandonedReindexGenerationTotal,
  buildAbandonedGenerationStorageCleanupJobs,
  clampAbandonedCleanupLimit,
  hasAbandonedReindexGenerations,
  type AbandonedReindexGenerationCounts,
} from "@/lib/reindex-pipeline";
import { safeErrorLogDetails } from "@/lib/privacy";
import { assertSupabaseHealthy, probeSupabaseHealth } from "@/lib/supabase/health";
import { confirm } from "./cli-utils";

loadEnvConfig(process.cwd());

type CleanupResult = {
  ok?: boolean;
  dry_run?: boolean;
  document_count?: number;
  document_ids?: string[];
  counts?: AbandonedReindexGenerationCounts;
};

function parseArgs(argv: string[]) {
  const valueFor = (name: string) => {
    const inline = argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
    if (inline) return inline;
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return {
    apply: argv.includes("--apply"),
    // Read-only detection flag: makes a dry run that FINDS abandoned rows exit
    // non-zero so a scheduled probe can alert. Never widens what gets deleted.
    alertOnAbandoned: argv.includes("--alert-on-abandoned"),
    yes: argv.includes("--yes"),
    documentId: valueFor("document-id") ?? null,
    limit: Number.parseInt(valueFor("limit") ?? "", 10),
  };
}

function formatCounts(counts: AbandonedReindexGenerationCounts) {
  const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "  none";
  return entries.map(([table, count]) => `  ${table.padEnd(26)}: ${count}`).join("\n");
}

async function main() {
  const [{ env, requireServerEnv }, { createAdminClient }] = await Promise.all([
    import("@/lib/env"),
    import("@/lib/supabase/admin"),
  ]);
  requireServerEnv();

  const args = parseArgs(process.argv.slice(2));
  const limit = clampAbandonedCleanupLimit(args.limit);
  const supabase = createAdminClient();

  console.log("=== Abandoned Reindex Generation Cleanup ===");
  console.log(`Supabase project: ${env.SUPABASE_PROJECT_NAME ?? "unknown"} (${env.SUPABASE_PROJECT_REF ?? "unknown"})`);
  console.log(`Mode            : ${args.apply ? "apply" : "dry-run"}`);
  console.log(`Document filter : ${args.documentId ?? "all eligible documents"}`);
  console.log(`Document limit  : ${limit}`);
  console.log("");

  assertSupabaseHealthy(await probeSupabaseHealth(supabase), "Abandoned reindex generation cleanup");

  const { data, error } = await supabase.rpc("cleanup_abandoned_document_index_generations", {
    p_document_id: args.documentId ?? undefined,
    p_limit: limit,
    p_dry_run: true,
  });
  if (error) throw new Error(error.message);

  const result = (data ?? {}) as CleanupResult;
  const counts = result.counts ?? {};
  const total = abandonedReindexGenerationTotal(counts);
  console.log(`Eligible documents: ${result.document_count ?? 0}`);
  console.log(`Artifact rows      : ${total}`);
  console.log("Rows by table:");
  console.log(formatCounts(counts));

  // Determine orphaned storage objects from candidate documents
  const targetDocIds = (result.document_ids ?? []).filter((id): id is string => typeof id === "string" && Boolean(id));
  let cleanupJobs: ReturnType<typeof buildAbandonedGenerationStorageCleanupJobs> = [];
  let totalOrphanedPaths = 0;

  if (targetDocIds.length > 0) {
    const { data: candidateDocs, error: docsError } = await supabase
      .from("documents")
      .select("id,owner_id,metadata")
      .in("id", targetDocIds);
    if (docsError) throw new Error(`Failed to load candidate documents: ${docsError.message}`);

    const { data: candidateImages, error: imagesError } = await supabase
      .from("document_images")
      .select("id,document_id,storage_path,metadata,created_at")
      .in("document_id", targetDocIds);
    if (imagesError) throw new Error(`Failed to load candidate images: ${imagesError.message}`);

    const imageRowsByDoc = new Map<string, Array<NonNullable<typeof candidateImages>[number]>>();
    for (const img of candidateImages ?? []) {
      const list = imageRowsByDoc.get(img.document_id);
      if (list) list.push(img);
      else imageRowsByDoc.set(img.document_id, [img]);
    }

    cleanupJobs = (candidateDocs ?? []).flatMap((doc) =>
      buildAbandonedGenerationStorageCleanupJobs({
        documentId: doc.id,
        documentMetadata: doc.metadata,
        ownerId: doc.owner_id,
        imageRows: imageRowsByDoc.get(doc.id) ?? [],
        preserveNewestStagedGeneration: false,
      }),
    );
    totalOrphanedPaths = cleanupJobs.reduce((sum, job) => sum + job.image_paths.length, 0);
  }

  console.log(`Orphaned storage objects: ${totalOrphanedPaths}`);

  if (!hasAbandonedReindexGenerations(counts) && totalOrphanedPaths === 0) {
    console.log("\nNo abandoned staged generation rows or orphaned storage objects found.");
    return;
  }

  if (!args.apply) {
    console.log("\nDry run only. Re-run with --apply to enqueue storage cleanup and delete abandoned staged rows.");
    if (totalOrphanedPaths > 0) {
      console.log(`  Storage cleanup jobs that would be enqueued on apply: ${cleanupJobs.length}`);
    }
    const alertExitCode = abandonedReindexGenerationAlertExitCode({
      counts,
      alertOnAbandoned: args.alertOnAbandoned,
      apply: args.apply,
    });
    if (alertExitCode !== 0) {
      console.error(
        "\nAbandoned staged generation rows detected on a read-only probe — alerting. " +
          "Triage with `npm run reindex:cleanup-staged` before considering any apply run.",
      );
      process.exitCode = alertExitCode;
    }
    return;
  }

  if (!args.yes) {
    const shouldApply = await confirm(
      `Delete abandoned staged generation rows and enqueue storage cleanup for ${totalOrphanedPaths} orphaned object(s)?`,
    );
    if (!shouldApply) {
      console.log("\nNo changes applied.");
      return;
    }
  }

  // Stage jobs with empty image_paths so the storage janitor has zero objects to delete
  // before the database rows are removed. Populate real paths and activate only after RPC succeeds.
  let stagedJobsWithPaths: Array<{ id: string; imagePaths: string[] }> = [];
  if (cleanupJobs.length > 0) {
    const stagedJobs = cleanupJobs.map((job) => ({ ...job, image_paths: [], status: "failed" as const }));
    const { data: insertedJobs, error: insertError } = await supabase
      .from("storage_cleanup_jobs")
      .insert(stagedJobs)
      .select("id");
    if (insertError) throw new Error(`Failed to stage storage cleanup jobs: ${insertError.message}`);
    stagedJobsWithPaths = (insertedJobs ?? []).map((row, idx) => ({
      id: row.id,
      imagePaths: cleanupJobs[idx]?.image_paths ?? [],
    }));
  }

  const applied = await supabase.rpc("cleanup_abandoned_document_index_generations", {
    p_document_id: args.documentId ?? undefined,
    p_limit: limit,
    p_dry_run: false,
  });
  if (applied.error) {
    if (stagedJobsWithPaths.length > 0) {
      await supabase
        .from("storage_cleanup_jobs")
        .delete()
        .in(
          "id",
          stagedJobsWithPaths.map((job) => job.id),
        );
    }
    throw new Error(applied.error.message);
  }

  if (stagedJobsWithPaths.length > 0) {
    for (const staged of stagedJobsWithPaths) {
      const { error: activateError } = await supabase
        .from("storage_cleanup_jobs")
        .update({ image_paths: staged.imagePaths, status: "pending" })
        .eq("id", staged.id);
      if (activateError)
        throw new Error(`Failed to activate storage cleanup job ${staged.id}: ${activateError.message}`);
    }
    console.log(
      `Enqueued ${stagedJobsWithPaths.length} storage cleanup job(s) for ${totalOrphanedPaths} orphaned object(s).`,
    );
  }

  console.log("\nAbandoned staged generation cleanup applied.");
}

main().catch((error) => {
  console.error("Abandoned reindex generation cleanup failed", safeErrorLogDetails(error));
  process.exitCode = 1;
});
