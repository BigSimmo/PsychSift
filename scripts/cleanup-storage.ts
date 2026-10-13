import { loadEnvConfig } from "@next/env";
import { nonNullDocumentIds, partitionStorageCleanupJobs } from "@/lib/storage-cleanup-safety";
import { loadAdminClient } from "./eval-utils";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

type CleanupArgs = {
  limit: number;
  dryRun: boolean;
};

export type CleanupJob = {
  id: string;
  document_id: string | null;
  document_bucket: string | null;
  document_paths: string[] | null;
  image_bucket: string | null;
  image_paths: string[] | null;
  attempts: number;
  public_source_reservation_id: string | null;
  public_source_upload_attempt_id: string | null;
  public_source_storage_bucket: string | null;
  public_source_storage_path: string | null;
  public_source_cleanup_not_before: string | null;
  public_source_claim_token?: string | null;
  public_source_claim_expires_at?: string | null;
};

type ClaimedPublicSourceCleanup = {
  id: string;
  claimToken: string;
  claimExpiresAt: string;
  reservationId: string;
  uploadAttemptId: string;
  bucket: string;
  path: string;
  imagePaths: unknown[];
  attempts: number;
};

export type ControlledPublicSourceCleanupDependencies = {
  claim(maxAttempts: number): Promise<unknown>;
  remove(bucket: string, path: string): Promise<{ removed: number; warnings: string[] }>;
  complete(input: { jobId: string; claimToken: string; storageRemoved: number }): Promise<void>;
  release(input: { jobId: string; claimToken: string; error: "storage_delete_failed" }): Promise<void>;
};

export function publicSourceCleanupIdentityError(job: CleanupJob) {
  if (job.public_source_reservation_id === null) {
    return job.public_source_upload_attempt_id === null
      ? null
      : "Controlled public source cleanup identity is inconsistent.";
  }
  if (
    !job.public_source_upload_attempt_id ||
    !job.public_source_storage_bucket ||
    !job.public_source_storage_path ||
    job.document_bucket !== job.public_source_storage_bucket ||
    job.document_paths?.length !== 1 ||
    job.document_paths[0] !== job.public_source_storage_path ||
    (job.image_paths?.length ?? 0) !== 0
  ) {
    return "Controlled public source cleanup identity is inconsistent.";
  }
  return null;
}

function parseClaimedPublicSourceCleanup(value: unknown): ClaimedPublicSourceCleanup | null {
  if (value === null) return null;
  if (!value || typeof value !== "object") throw new Error("Controlled cleanup claim was invalid.");
  const claim = value as Partial<ClaimedPublicSourceCleanup>;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    typeof claim.id !== "string" ||
    !uuid.test(claim.id) ||
    typeof claim.claimToken !== "string" ||
    !uuid.test(claim.claimToken) ||
    typeof claim.claimExpiresAt !== "string" ||
    !Number.isFinite(Date.parse(claim.claimExpiresAt)) ||
    typeof claim.reservationId !== "string" ||
    !uuid.test(claim.reservationId) ||
    typeof claim.uploadAttemptId !== "string" ||
    !uuid.test(claim.uploadAttemptId) ||
    typeof claim.bucket !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{0,62}$/.test(claim.bucket) ||
    typeof claim.path !== "string" ||
    claim.path.length < 1 ||
    claim.path.length > 1024 ||
    !Array.isArray(claim.imagePaths) ||
    claim.imagePaths.length !== 0 ||
    !Number.isInteger(claim.attempts)
  ) {
    throw new Error("Controlled cleanup claim identity was invalid.");
  }
  return claim as ClaimedPublicSourceCleanup;
}

export async function processControlledPublicSourceCleanup(
  limit: number,
  dependencies: ControlledPublicSourceCleanupDependencies,
) {
  let completed = 0;
  let failed = 0;
  for (let claimed = 0; claimed < limit; claimed += 1) {
    const claim = parseClaimedPublicSourceCleanup(await dependencies.claim(25));
    if (!claim) break;
    const removal = await dependencies.remove(claim.bucket, claim.path);
    if (removal.warnings.length > 0) {
      await dependencies.release({
        jobId: claim.id,
        claimToken: claim.claimToken,
        error: "storage_delete_failed",
      });
      failed += 1;
      continue;
    }
    await dependencies.complete({
      jobId: claim.id,
      claimToken: claim.claimToken,
      storageRemoved: removal.removed,
    });
    completed += 1;
  }
  return { completed, failed };
}

function parseArgs(argv: string[]): CleanupArgs {
  const args: CleanupArgs = { limit: 50, dryRun: false };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (token === "--limit") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Missing value for --limit");
      args.limit = Number.parseInt(value, 10);
      index += 1;
    }
  }

  if (!Number.isInteger(args.limit) || args.limit <= 0) throw new Error("--limit must be a positive integer.");
  return args;
}

async function removePaths(args: {
  supabase: Awaited<ReturnType<typeof loadAdminClient>>;
  bucket: string;
  paths: string[];
}) {
  let removed = 0;
  const warnings: string[] = [];
  const uniquePaths = Array.from(new Set(args.paths.filter(Boolean)));

  for (let start = 0; start < uniquePaths.length; start += 1000) {
    const batch = uniquePaths.slice(start, start + 1000);
    const { data, error } = await args.supabase.storage.from(args.bucket).remove(batch);
    if (error) {
      warnings.push(`${args.bucket}: ${error.message}`);
    } else {
      removed += data?.length ?? 0;
    }
  }

  return { removed, warnings };
}

async function main() {
  loadEnvConfig(process.cwd());
  const args = parseArgs(process.argv.slice(2));
  const supabase = await loadAdminClient();
  const { data, error } = await supabase
    .from("storage_cleanup_jobs")
    .select(
      "id,document_id,document_bucket,document_paths,image_bucket,image_paths,attempts,public_source_reservation_id,public_source_upload_attempt_id,public_source_storage_bucket,public_source_storage_path,public_source_cleanup_not_before",
    )
    .in("status", ["pending", "failed"])
    .is("public_source_reservation_id", null)
    .order("created_at", { ascending: true })
    .limit(args.limit);

  if (error) throw new Error(error.message);
  const allJobs = (data ?? []) as CleanupJob[];

  // Audit R11 guard: never remove storage for a ledger row whose document still
  // exists — a genuinely-deleted document has its ledger document_id nulled by
  // the ON DELETE SET NULL FK, so a live document_id means the delete aborted
  // and these paths still belong to a live document.
  const candidateDocumentIds = nonNullDocumentIds(allJobs);
  const liveDocumentIds = new Set<string>();
  for (let start = 0; start < candidateDocumentIds.length; start += 1000) {
    const batch = candidateDocumentIds.slice(start, start + 1000);
    const { data: liveDocs, error: liveError } = await supabase.from("documents").select("id").in("id", batch);
    if (liveError) throw new Error(liveError.message);
    for (const doc of liveDocs ?? []) liveDocumentIds.add(doc.id);
  }

  const { safe: ownershipSafeJobs, skipped } = partitionStorageCleanupJobs(allJobs, liveDocumentIds);
  const jobs = ownershipSafeJobs;
  console.log(`Found ${allJobs.length} generic storage cleanup job(s); ${jobs.length} safe to process.`);
  if (skipped.length > 0) {
    console.warn(
      `Skipping ${skipped.length} cleanup job(s) whose document still exists (aborted delete; would destroy live storage): ${skipped
        .map((job) => job.id)
        .join(", ")}`,
    );
  }
  if (args.dryRun) {
    console.log("Controlled public-source cleanup remains unclaimed in dry-run mode.");
    return;
  }

  let completed = 0;
  let failed = 0;

  for (const job of jobs) {
    const identityError = publicSourceCleanupIdentityError(job);
    if (identityError) {
      const { error: identityUpdateError } = await supabase
        .from("storage_cleanup_jobs")
        .update({
          status: "failed",
          attempts: job.attempts + 1,
          last_error: identityError,
          completed_at: null,
          metadata: { operation: "storage_cleanup_identity_rejected" },
        })
        .eq("id", job.id);
      if (identityUpdateError) throw new Error(identityUpdateError.message);
      failed += 1;
      continue;
    }
    const documentCleanup = await removePaths({
      supabase,
      bucket: job.document_bucket ?? "clinical-documents",
      paths: job.document_paths ?? [],
    });
    const imageCleanup = await removePaths({
      supabase,
      bucket: job.image_bucket ?? "clinical-images",
      paths: job.image_paths ?? [],
    });
    const warnings = [...documentCleanup.warnings, ...imageCleanup.warnings];
    const nextStatus = warnings.length > 0 ? "failed" : "completed";
    const { error: updateError } = await supabase
      .from("storage_cleanup_jobs")
      .update({
        status: nextStatus,
        attempts: job.attempts + 1,
        storage_removed: documentCleanup.removed + imageCleanup.removed,
        last_error: warnings.length ? warnings.join("; ") : null,
        completed_at: nextStatus === "completed" ? new Date().toISOString() : null,
        metadata: {
          operation: "storage_cleanup_retry",
          storage_warnings: warnings,
        },
      })
      .eq("id", job.id);

    if (updateError) throw new Error(updateError.message);
    if (nextStatus === "completed") completed += 1;
    else failed += 1;
  }

  // Each queue gets an independently bounded pass so a persistent generic
  // backlog cannot starve abandoned governed-source cleanup (or vice versa).
  const { error: reapError } = await supabase.rpc("reap_expired_public_source_upload_attempts", {
    p_limit: Math.min(args.limit, 100),
  });
  if (reapError) throw new Error("Expired public-source upload attempt reaping failed.");
  const controlled = await processControlledPublicSourceCleanup(args.limit, {
    claim: async (maxAttempts) => {
      const { data: claim, error: claimError } = await supabase.rpc("claim_public_source_cleanup_job", {
        p_max_attempts: maxAttempts,
      });
      if (claimError) throw new Error("Controlled public-source cleanup claim failed.");
      return claim;
    },
    remove: async (bucket, path) => removePaths({ supabase, bucket, paths: [path] }),
    complete: async ({ jobId, claimToken, storageRemoved }) => {
      const { error: completeError } = await supabase.rpc("complete_public_source_cleanup_job", {
        p_job_id: jobId,
        p_claim_token: claimToken,
        p_storage_removed: storageRemoved,
      });
      if (completeError) throw new Error("Controlled public-source cleanup completion failed.");
    },
    release: async ({ jobId, claimToken, error: releaseReason }) => {
      const { error: releaseError } = await supabase.rpc("release_public_source_cleanup_job", {
        p_job_id: jobId,
        p_claim_token: claimToken,
        p_error: releaseReason,
      });
      if (releaseError) throw new Error("Controlled public-source cleanup release failed.");
    },
  });
  completed += controlled.completed;
  failed += controlled.failed;

  console.log(`Storage cleanup complete: ${completed} completed, ${failed} failed.`);
}

if (isDirectEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
