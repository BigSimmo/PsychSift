import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnvConfig } from "@next/env";
import {
  buildImportStoragePath,
  chunkImportFiles,
  formatExactDuplicateSkip,
  importMimeType,
  type ExistingImportDocument,
  parseImportCliArgs,
  scanImportFiles,
} from "@/lib/bulk-import";
import { planDocumentName, type DocumentNamePlan } from "@/lib/document-naming";
import { assertSupabaseHealthy, probeSupabaseHealth } from "@/lib/supabase/health";
import {
  createTrustedDocumentAdmission,
  dispatchTrustedDocumentAdmission,
  TrustedDocumentAdmissionDispatchError,
  trustedAdmissionDocumentId,
  type TrustedAdmissionAuthority,
} from "@/lib/trusted-document-admission";

type SupabaseAdmin = Awaited<ReturnType<typeof loadAdminClient>>;

type TrustedBackendConfig = Readonly<{
  principal: string;
  capability: string;
  authority: TrustedAdmissionAuthority;
}>;

function deterministicUuid(value: string) {
  const bytes = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  bytes[12] = "4";
  bytes[16] = ((Number.parseInt(bytes[16]!, 16) & 0x3) | 0x8).toString(16);
  const hex = bytes.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function retainedImportNamePlan(row: { id: string; title: string; file_name: string | null; metadata?: unknown }) {
  const metadata =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : null;
  if (
    !metadata ||
    typeof metadata.source_title !== "string" ||
    typeof metadata.smart_title_base !== "string" ||
    typeof metadata.smart_title_group_key !== "string" ||
    !Number.isSafeInteger(metadata.smart_title_duplicate_index) ||
    (metadata.smart_title_duplicate_reason !== "none" &&
      metadata.smart_title_duplicate_reason !== "same_title_or_filename")
  ) {
    throw new Error(`Admitted import ${row.id} has invalid retained naming metadata.`);
  }
  return {
    title: metadata.source_title,
    baseTitle: metadata.smart_title_base,
    originalTitle: null,
    originalFileName: row.file_name ?? "",
    duplicateIndex: metadata.smart_title_duplicate_index as number,
    duplicateGroupKey: metadata.smart_title_group_key,
    duplicateReason: metadata.smart_title_duplicate_reason,
  } satisfies DocumentNamePlan;
}

export function loadTrustedBackendConfig(environment: NodeJS.ProcessEnv = process.env): TrustedBackendConfig {
  const principal = environment.TRUSTED_INGESTION_BACKEND_PRINCIPAL?.trim() ?? "";
  const capability = environment.TRUSTED_INGESTION_BACKEND_CAPABILITY ?? "";
  const rawAuthority = environment.TRUSTED_INGESTION_AUTHORITY_JSON;
  if (!principal || principal.length > 200) throw new Error("TRUSTED_INGESTION_BACKEND_PRINCIPAL is required.");
  if (!/^[0-9a-f]{64}$/.test(capability)) {
    throw new Error("TRUSTED_INGESTION_BACKEND_CAPABILITY must be exactly 64 lowercase hexadecimal characters.");
  }
  if (!rawAuthority) throw new Error("TRUSTED_INGESTION_AUTHORITY_JSON is required.");
  let authority: TrustedAdmissionAuthority;
  try {
    authority = JSON.parse(rawAuthority) as TrustedAdmissionAuthority;
  } catch {
    throw new Error("TRUSTED_INGESTION_AUTHORITY_JSON must be valid JSON.");
  }
  const validated = createTrustedDocumentAdmission({
    actor: { kind: "trusted_backend", principal },
    sourceChannel: "backend_import",
    documentId: "00000000-0000-4000-8000-000000000001",
    stagingOwnerId: "00000000-0000-4000-8000-000000000002",
    contentSha256: `sha256:${"0".repeat(64)}`,
    storagePath: "validation/documents/validation/document.pdf",
    originalFileName: "document.pdf",
    mimeType: "application/pdf",
    byteCount: 1,
    correlationId: "00000000-0000-4000-8000-000000000003",
    admissionPolicyVersion: "trusted-document-admission-v1",
    authority,
  });
  return { principal, capability, authority: validated.authority };
}

async function loadAdminClient() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

async function findOwnerIdByEmail(supabase: SupabaseAdmin, email: string) {
  const normalized = email.trim().toLowerCase();
  const perPage = 1000;

  for (let page = 1; page < 50; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === normalized);
    if (user?.id) return user.id;
    if (data.users.length < perPage) break;
  }

  throw new Error(`No Supabase Auth user found for ${email}. Sign in once before importing.`);
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

async function compensateImportUpload(args: {
  supabase: SupabaseAdmin;
  ownerId: string;
  bucket: string;
  imageBucket: string;
  storagePath: string;
}) {
  const { error: removeError } = await args.supabase.storage.from(args.bucket).remove([args.storagePath]);
  if (!removeError) return;
  const { error: ledgerError } = await args.supabase.from("storage_cleanup_jobs").insert({
    document_bucket: args.bucket,
    document_paths: [args.storagePath],
    owner_id: args.ownerId,
    status: "pending",
    image_bucket: args.imageBucket,
    image_paths: [],
  });
  if (ledgerError) {
    throw new Error(`Import cleanup failed: ${removeError.message}; cleanup ledger failed: ${ledgerError.message}`);
  }
}

export async function main() {
  const args = parseImportCliArgs(process.argv.slice(2));
  if (args.force) {
    throw new Error("--force cannot bypass trusted admission; use an explicitly authorised reprocessing operation.");
  }
  const backend = loadTrustedBackendConfig();
  const [{ env, requireServerEnv }, supabase] = args.dryRun
    ? [await import("@/lib/env"), null as SupabaseAdmin | null]
    : await Promise.all([import("@/lib/env"), loadAdminClient()]);
  requireServerEnv();
  const root = path.resolve(args.path);
  const files = await scanImportFiles(root, args.include, args.limit);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const batchName = args.batchName ?? `Clinical guideline import ${new Date().toISOString().slice(0, 10)}`;
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
      assertSupabaseHealthy(await probeSupabaseHealth(supabase), "Import dry-run duplicate check");
      existing = await existingDocumentsByHash(
        supabase,
        dryRunOwnerId,
        Array.from(new Set(files.map((file) => file.contentHash))),
      );
    } else if (args.ownerEmail) {
      const supabase = await loadAdminClient();
      assertSupabaseHealthy(await probeSupabaseHealth(supabase), "Import dry-run duplicate check");
      const ownerId = await findOwnerIdByEmail(supabase, args.ownerEmail);
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
          ? formatExactDuplicateSkip(file, duplicate, { dryRun: true })
          : `DRY RUN ${file.relativePath} ${file.contentHash.slice(0, 12)}`,
      );
    }
    if (files.length > args.queueBatchSize)
      console.log(`DRY RUN omitted ${files.length - args.queueBatchSize} additional file(s).`);
    if (dryRunOwnerId || args.ownerEmail) {
      console.log(
        `DRY RUN duplicate check: would_queue=${files.length - exactCopyCount}, exact_copies=${exactCopyCount}, total=${files.length}`,
      );
    }
    return;
  }

  if (!supabase) throw new Error("Supabase admin client is unavailable.");
  assertSupabaseHealthy(await probeSupabaseHealth(supabase), "Document import");
  const configuredOwnerId = args.ownerId ?? process.env.LOCAL_NO_AUTH_OWNER_ID;
  if (!configuredOwnerId && !args.ownerEmail && !args.resume) {
    throw new Error("Provide --owner-id, set LOCAL_NO_AUTH_OWNER_ID, or provide --owner-email for a new import batch.");
  }

  const requestedOwnerId =
    configuredOwnerId ?? (args.ownerEmail ? await findOwnerIdByEmail(supabase, args.ownerEmail) : undefined);
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

  console.log("Pre-loading existing documents for name planning...");
  const { data: dbDocs, error: dbDocsErr } = await supabase
    .from("documents")
    .select("id,title,file_name,content_hash,metadata")
    .eq("owner_id", ownerId)
    .limit(5000);
  if (dbDocsErr) throw new Error(dbDocsErr.message);
  type ExistingDocForPlan = {
    id: string;
    title: string;
    file_name: string | null;
    content_hash: string | null;
    metadata?: unknown;
  };
  const existingDocsForPlanning: ExistingDocForPlan[] = [];
  for (const row of dbDocs ?? []) {
    const rawId = (row as { id?: unknown }).id;
    const rawTitle = (row as { title?: unknown }).title;
    const rawFileName = (row as { file_name?: unknown }).file_name;
    const rawContentHash = (row as { content_hash?: unknown }).content_hash;
    const id = typeof rawId === "string" ? rawId : "";
    const title = typeof rawTitle === "string" ? rawTitle : "";
    if (!id || !title) continue;
    const file_name = typeof rawFileName === "string" ? rawFileName : null;
    const content_hash = typeof rawContentHash === "string" ? rawContentHash : null;
    existingDocsForPlanning.push({
      id,
      title,
      file_name,
      content_hash,
      metadata: (row as { metadata?: unknown }).metadata,
    });
  }

  let queued = 0;
  let replayed = 0;
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
        const correlationId = deterministicUuid(`${batch.id}\n${file.relativePath}\n${file.contentHash}`);
        const documentId = trustedAdmissionDocumentId(`trusted_backend:${backend.principal}`, correlationId);
        const storagePath = buildImportStoragePath(ownerId, documentId, file.fileName);
        const fileType = importMimeType(file.fileName);
        // The bounded name-planning snapshot is only a first-admission cache. An
        // exact replay must recover its immutable admitted name even when the row
        // falls outside that snapshot or its mutable display title was renamed.
        const { data: retainedDocument, error: retainedDocumentError } = await supabase
          .from("documents")
          .select("id,title,file_name,content_hash,metadata")
          .eq("owner_id", ownerId)
          .eq("id", documentId)
          .maybeSingle();
        if (retainedDocumentError) throw new Error(retainedDocumentError.message);
        if (retainedDocument?.file_name !== undefined && retainedDocument.file_name !== file.fileName) {
          throw new Error("Import correlation was already admitted with a different filename.");
        }
        const namePlan = retainedDocument
          ? retainedImportNamePlan(retainedDocument)
          : await planDocumentName({
              ownerId,
              fileName: file.fileName,
              requestedTitle: null,
              contentHash: file.contentHash,
              existingDocs: existingDocsForPlanning,
            });
        const document = {
          id: documentId,
          owner_id: ownerId,
          title: namePlan.title,
          description: null,
          file_name: file.fileName,
          file_type: fileType,
          file_size: file.size,
          storage_path: storagePath,
          content_hash: file.contentHash,
          source_path: file.absolutePath,
          import_batch_id: batch.id,
          max_attempts: env.WORKER_MAX_ATTEMPTS,
          metadata: {
            source_title: namePlan.title,
            publisher: null,
            jurisdiction: "Australia/WA",
            version: null,
            publication_date: null,
            review_date: null,
            indexed_at: null,
            uploaded_by: ownerId,
            original_file_name: namePlan.originalFileName,
            original_title: namePlan.originalTitle,
            smart_title_base: namePlan.baseTitle,
            smart_title_group_key: namePlan.duplicateGroupKey,
            smart_title_duplicate_index: namePlan.duplicateIndex,
            smart_title_duplicate_reason: namePlan.duplicateReason,
            document_status: "unknown",
            clinical_validation_status: "unverified",
            extraction_quality: "unknown",
            confidentiality_scope: "guidelines-only",
            corpus_scope: "uploaded_local",
            content_mode: "indexed_content",
            authority: backend.authority,
            source_path: file.absolutePath,
            content_hash: file.contentHash,
            import_batch_id: batch.id,
            queue_batch_size: args.queueBatchSize,
            admission_max_attempts: env.WORKER_MAX_ATTEMPTS,
          },
        };
        const admission = createTrustedDocumentAdmission({
          actor: { kind: "trusted_backend", principal: backend.principal },
          sourceChannel: "backend_import",
          documentId,
          stagingOwnerId: ownerId,
          contentSha256: `sha256:${file.contentHash}`,
          storagePath,
          originalFileName: file.fileName,
          mimeType: fileType,
          byteCount: file.size,
          correlationId,
          admissionPolicyVersion: "trusted-document-admission-v1",
          authority: backend.authority,
        });
        const dispatchInput = {
          admission,
          document,
          backend: { principal: backend.principal, capability: backend.capability },
        } as const;
        const replay = await dispatchTrustedDocumentAdmission({ ...dispatchInput, replayOnly: true }, supabase);
        const wasReplay = replay.outcome !== "not_found";
        if (replay.outcome === "not_found") {
          if (duplicate) {
            skipped += 1;
            console.log(formatExactDuplicateSkip(file, duplicate));
            continue;
          }
          const upload = await supabase.storage
            .from(env.SUPABASE_DOCUMENT_BUCKET)
            .upload(storagePath, await readFile(file.absolutePath), { contentType: fileType, upsert: false });
          if (upload.error) throw new Error(upload.error.message);
          let admitted = false;
          try {
            await dispatchTrustedDocumentAdmission({ ...dispatchInput, replayOnly: false }, supabase);
            admitted = true;
          } catch (dispatchError) {
            if (
              dispatchError instanceof TrustedDocumentAdmissionDispatchError &&
              dispatchError.kind === "outcome_unknown"
            ) {
              try {
                const recovered = await dispatchTrustedDocumentAdmission(
                  { ...dispatchInput, replayOnly: true },
                  supabase,
                );
                admitted = recovered.outcome !== "not_found";
              } catch {
                // Preserve an ambiguously committed object for exact-key replay recovery.
              }
            }
            if (dispatchError instanceof TrustedDocumentAdmissionDispatchError && dispatchError.kind === "rejected") {
              await compensateImportUpload({
                supabase,
                ownerId,
                bucket: env.SUPABASE_DOCUMENT_BUCKET,
                imageBucket: env.SUPABASE_IMAGE_BUCKET,
                storagePath,
              });
              if (dispatchError.message === "duplicate_content") {
                const racedDuplicates = await existingDocumentsByHash(supabase, ownerId, [file.contentHash]);
                const racedDuplicate = racedDuplicates.get(file.contentHash);
                if (!racedDuplicate) throw dispatchError;
                existing.set(file.contentHash, racedDuplicate);
                skipped += 1;
                console.log(formatExactDuplicateSkip(file, racedDuplicate));
                continue;
              }
            }
            if (!admitted) throw dispatchError;
          }
        }

        if (wasReplay) replayed += 1;

        existingDocsForPlanning.push({
          id: documentId,
          title: namePlan.title,
          file_name: file.fileName,
          content_hash: file.contentHash,
          metadata: {
            smart_title_group_key: namePlan.duplicateGroupKey,
          },
        });

        existing.set(file.contentHash, {
          id: documentId,
          storage_path: storagePath,
          title: namePlan.title,
          source_path: file.absolutePath,
          content_hash: file.contentHash,
        });
        queued += 1;
        console.log(`${wasReplay ? "REPLAY" : "QUEUE"} ${file.relativePath}`);
      } catch (error) {
        failed += 1;
        console.error(`FAIL ${file.relativePath}`, error instanceof Error ? error.message : String(error));
      }
    }

    await supabase
      .from("import_batches")
      .update({
        queued_files: queued,
        skipped_files: skipped,
        failed_files: failed,
      })
      .eq("id", batch.id);
  }

  const status = failed > 0 ? "completed_with_errors" : "completed";
  await supabase
    .from("import_batches")
    .update({
      status,
      queued_files: queued,
      skipped_files: skipped,
      failed_files: failed,
      completed_at: new Date().toISOString(),
    })
    .eq("id", batch.id);

  console.log(
    `Import batch ${batch.id}: queued=${queued}, replayed=${replayed}, exact_copies_skipped=${skipped}, failed=${failed}, total=${files.length}`,
  );
  console.log(
    "Indexing quality path unchanged: run npm run worker until jobs complete, then npm run check:indexing to verify detailed chunks, embeddings, summaries, labels, memory, index units, and quality rows.",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  loadEnvConfig(process.cwd());
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
