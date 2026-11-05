import path from "node:path";
import { loadEnvConfig } from "@next/env";
import {
  chunkImportFiles,
  formatExactDuplicateSkip,
  type ExistingImportDocument,
  parseImportCliArgs,
  scanImportFiles,
} from "@/lib/bulk-import";
import { assertExistingImportDocument, queueExistingImportDocument } from "./lib/import-document-queue";
import { assertSupabaseHealthy, probeSupabaseHealth } from "@/lib/supabase/health";
import { findOwnerIdByEmail } from "./lib/find-owner-id-by-email";

loadEnvConfig(process.cwd());

type SupabaseAdmin = Awaited<ReturnType<typeof loadAdminClient>>;

async function loadAdminClient() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

async function existingDocumentsByHash(supabase: SupabaseAdmin, ownerId: string, hashes: string[]) {
  const existing = new Map<string, ExistingImportDocument>();
  for (let start = 0; start < hashes.length; start += 100) {
    const hashBatch = hashes.slice(start, start + 100);
    const { data, error } = await supabase
      .from("documents")
      .select("id,storage_path,title,source_path,content_hash")
      .eq("owner_id", ownerId)
      .in("content_hash", hashBatch);

    if (error) throw new Error(error.message);
    for (const document of data ?? []) {
      if (document.content_hash) existing.set(document.content_hash, document);
    }
  }
  return existing;
}

async function loadOrCreateBatch(args: {
  supabase: SupabaseAdmin;
  ownerId?: string;
  name: string;
  sourceRoot: string;
  include: string;
  limit?: number;
  resume?: string;
  totalFiles: number;
  totalBytes: number;
  queueBatchSize: number;
  dryRun: boolean;
}) {
  if (args.dryRun) {
    return { id: "dry-run", name: args.name, owner_id: null };
  }

  if (args.resume) {
    const { data, error } = await args.supabase
      .from("import_batches")
      .select("id,name,owner_id")
      .eq("id", args.resume)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error(`Import batch not found: ${args.resume}`);
    if (args.ownerId && data.owner_id !== args.ownerId) throw new Error("Resume batch belongs to a different user.");
    return data;
  }

  if (!args.ownerId) throw new Error("New import batches require an owner user.");

  const { data, error } = await args.supabase
    .from("import_batches")
    .insert({
      owner_id: args.ownerId,
      name: args.name,
      source_root: args.sourceRoot,
      include_glob: args.include,
      status: "processing",
      total_files: args.totalFiles,
      total_bytes: args.totalBytes,
      metadata: {
        importer: "local-folder",
        document_scope: "guidelines-only",
        limit: args.limit ?? null,
        queue_batch_size: args.queueBatchSize,
      },
    })
    .select("id,name,owner_id")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

async function main() {
  const args = parseImportCliArgs(process.argv.slice(2));
  const root = path.resolve(args.path);
  const files = await scanImportFiles(root, args.include, args.limit);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const batchName = args.batchName ?? `Clinical guideline import ${new Date().toISOString().slice(0, 10)}`;
  const [{ env, requireServerEnv }, supabase] = args.dryRun
    ? [await import("@/lib/env"), null as SupabaseAdmin | null]
    : await Promise.all([import("@/lib/env"), loadAdminClient()]);

  console.log(`Scanned ${files.length} file(s), ${(totalBytes / 1024 / 1024).toFixed(1)} MB total.`);

  if (!files.length) return;
  if (!args.forceLargeImport) {
    if (files.length > env.MAX_IMPORT_JOBS_PER_RUN) {
      throw new Error(
        `Import wave has ${files.length} file(s), above MAX_IMPORT_JOBS_PER_RUN=${env.MAX_IMPORT_JOBS_PER_RUN}. Re-run with --limit ${env.MAX_IMPORT_JOBS_PER_RUN} or --force-large-import after confirming Supabase health.`,
      );
    }
    if (totalBytes > env.MAX_IMPORT_BYTES_PER_RUN) {
      throw new Error(
        `Import wave is ${totalBytes} byte(s), above MAX_IMPORT_BYTES_PER_RUN=${env.MAX_IMPORT_BYTES_PER_RUN}. Split the import or use --force-large-import after confirming Supabase health.`,
      );
    }
  }

  if (args.dryRun) {
    let existing = new Map<string, ExistingImportDocument>();
    const dryRunOwnerId = args.ownerId ?? process.env.LOCAL_NO_AUTH_OWNER_ID;
    if (dryRunOwnerId) {
      const supabase = await loadAdminClient();
      requireServerEnv();
      assertSupabaseHealthy(await probeSupabaseHealth(supabase), "Import dry-run duplicate check");
      existing = await existingDocumentsByHash(
        supabase,
        dryRunOwnerId,
        Array.from(new Set(files.map((file) => file.contentHash))),
      );
    } else if (args.ownerEmail) {
      const supabase = await loadAdminClient();
      requireServerEnv();
      assertSupabaseHealthy(await probeSupabaseHealth(supabase), "Import dry-run duplicate check");
      const ownerId = await findOwnerIdByEmail(supabase, args.ownerEmail, { purpose: "importing" });
      existing = await existingDocumentsByHash(
        supabase,
        ownerId,
        Array.from(new Set(files.map((file) => file.contentHash))),
      );
    }

    const exactCopyCount = files.filter((file) => existing.has(file.contentHash)).length;
    const dryRunBatches = chunkImportFiles(files, args.queueBatchSize);
    console.log(`DRY RUN queue plan: ${dryRunBatches.length} batch(es) of up to ${args.queueBatchSize} file(s).`);
    for (const file of files.slice(0, args.queueBatchSize)) {
      const duplicate = existing.get(file.contentHash);
      console.log(
        duplicate
          ? `DRY RUN EXISTING ${file.relativePath}: ${args.force ? "would request a generation-preserving replacement" : "would preserve indexed copies or repair missing queue work"}`
          : `DRY RUN BLOCKED NEW INTAKE ${file.relativePath}: reviewed backend authority/admission is unavailable`,
      );
    }
    if (files.length > args.queueBatchSize)
      console.log(`DRY RUN omitted ${files.length - args.queueBatchSize} additional file(s).`);
    if (dryRunOwnerId || args.ownerEmail) {
      console.log(
        `DRY RUN duplicate check: blocked_new_intake=${files.length - exactCopyCount}, existing_copies_to_reconcile=${exactCopyCount}, total=${files.length}`,
      );
    }
    return;
  }

  requireServerEnv();
  if (!supabase) throw new Error("Supabase admin client is unavailable.");
  assertSupabaseHealthy(await probeSupabaseHealth(supabase), "Document import");
  const configuredOwnerId = args.ownerId ?? process.env.LOCAL_NO_AUTH_OWNER_ID;
  if (!configuredOwnerId && !args.ownerEmail && !args.resume) {
    throw new Error("Provide --owner-id, set LOCAL_NO_AUTH_OWNER_ID, or provide --owner-email for a new import batch.");
  }

  const requestedOwnerId =
    configuredOwnerId ??
    (args.ownerEmail ? await findOwnerIdByEmail(supabase, args.ownerEmail, { purpose: "importing" }) : undefined);
  const batch = await loadOrCreateBatch({
    supabase,
    ownerId: requestedOwnerId,
    name: batchName,
    sourceRoot: root,
    include: args.include,
    limit: args.limit,
    resume: args.resume,
    totalFiles: files.length,
    totalBytes,
    queueBatchSize: args.queueBatchSize,
    dryRun: args.dryRun,
  });
  const ownerId = requestedOwnerId ?? batch.owner_id;
  if (!ownerId) throw new Error("Import batch has no owner user.");

  const existing = await existingDocumentsByHash(
    supabase,
    ownerId,
    Array.from(new Set(files.map((file) => file.contentHash))),
  );

  let queued = 0;
  let skipped = 0;
  let failed = 0;
  const importBatches = chunkImportFiles(files, args.queueBatchSize);

  console.log(`Queueing ${files.length} file(s) in ${importBatches.length} batch(es) of up to ${args.queueBatchSize}.`);

  for (const [batchIndex, fileBatch] of importBatches.entries()) {
    const start = batchIndex * args.queueBatchSize + 1;
    const end = start + fileBatch.length - 1;
    console.log(`QUEUE BATCH ${batchIndex + 1}/${importBatches.length} files ${start}-${end}/${files.length}`);

    for (const file of fileBatch) {
      try {
        const duplicate = existing.get(file.contentHash);
        assertExistingImportDocument(duplicate);
        const result = await queueExistingImportDocument({
          rpc: (name, payload) => supabase.rpc(name, payload),
          documentId: duplicate.id,
          ownerId,
          contentHash: file.contentHash,
          batchId: batch.id,
          force: args.force,
          maxAttempts: env.WORKER_MAX_ATTEMPTS,
        });
        if (result.outcome === "skipped") {
          skipped += 1;
          console.log(formatExactDuplicateSkip(file, duplicate));
        } else if (result.outcome === "already_active") {
          skipped += 1;
          console.log(`ALREADY QUEUED ${file.relativePath}`);
        } else {
          queued += 1;
          console.log(`${args.force ? "REQUEUE" : "REPAIR QUEUE"} ${file.relativePath}`);
        }
      } catch (error) {
        failed += 1;
        console.error(`FAIL ${file.relativePath}`, error instanceof Error ? error.message : String(error));
      }
    }

    const { error: progressError } = await supabase
      .from("import_batches")
      .update({
        queued_files: queued,
        skipped_files: skipped,
        failed_files: failed,
      })
      .eq("id", batch.id);
    if (progressError) console.warn(`WARN import batch ${batch.id} progress not recorded: ${progressError.message}`);
  }

  const status = failed > 0 ? "completed_with_errors" : "completed";
  const { error: completionError } = await supabase
    .from("import_batches")
    .update({
      status,
      queued_files: queued,
      skipped_files: skipped,
      failed_files: failed,
      completed_at: new Date().toISOString(),
    })
    .eq("id", batch.id);
  if (completionError) {
    console.error(`FAIL import batch ${batch.id} completion not recorded: ${completionError.message}`);
    process.exitCode = 1;
  }

  console.log(
    `Import batch ${batch.id}: queued=${queued}, exact_copies_skipped=${skipped}, failed=${failed}, total=${files.length}`,
  );
  // A FAIL line must not look like success to a wrapping script or `&&` chain.
  if (failed > 0) process.exitCode = 1;
  console.log(
    "Indexing quality path unchanged: run npm run worker until jobs complete, then npm run check:indexing to verify detailed chunks, embeddings, summaries, labels, memory, index units, and quality rows.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
