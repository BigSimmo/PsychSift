#!/usr/bin/env node
/**
 * Backfill first-page cover thumbnails for already-indexed PDF documents.
 *
 * Generates a compact page-1 PNG, uploads it to the image bucket as
 * source_kind=cover_page (searchable=false), and patches documents.metadata.cover_image_id.
 *
 * Safety:
 * - Requires explicit --apply (dry-run by default)
 * - Never marks covers searchable / never attaches them to chunks
 * - Audits existing cover objects and repairs stale document metadata
 *
 * One-shot backfill: retired from scripts/ once the ingestion pipeline started
 * generating cover thumbnails for new documents directly (see worker/main.ts,
 * worker/python/extract_pdf_assets.py). Kept here for provenance and as a
 * re-runnable repair tool if a targeted document is ever missing its cover.
 *
 * Usage:
 *   node scripts/archive/backfill-document-covers.mjs
 *   node scripts/archive/backfill-document-covers.mjs --apply --limit 25
 *   node scripts/archive/backfill-document-covers.mjs --apply --all
 *   node scripts/archive/backfill-document-covers.mjs --apply --document-id <uuid>
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { isDirectEntrypoint } from "../lib/is-entrypoint.mjs";

export function isMissingStorageObject(error) {
  if (!error || typeof error !== "object") return false;
  return (
    Number(error.status) === 404 || String(error.statusCode ?? "") === "404" || String(error.code ?? "") === "NoSuchKey"
  );
}

export function selectCommittedCovers(covers, committedGeneration, coverImageId) {
  const matches = covers.filter((cover) => {
    const metadataGeneration = cover.metadata?.index_generation_id;
    const rowGeneration = cover.index_generation_id || metadataGeneration;
    return !committedGeneration || !rowGeneration || rowGeneration === committedGeneration;
  });
  const selected = matches.find((cover) => cover.id === coverImageId) ?? matches[0] ?? null;
  return { selected, matches };
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

async function runPythonCover(pdfPath, outputDir) {
  const script = `
import json, sys
import fitz
sys.path.insert(0, ${JSON.stringify(path.join(process.cwd(), "worker/python"))})
import extract_pdf_assets as extractor
doc = fitz.open(${JSON.stringify(pdfPath)})
budget = extractor.ExtractionBudget()
budget.set_page_count(doc.page_count)
cover = extractor.save_cover_page(doc[0], ${JSON.stringify(outputDir)}, budget, [])
doc.close()
print(json.dumps(cover))
`;
  const scriptPath = path.join(outputDir, "render_cover.py");
  await writeFile(scriptPath, script, "utf8");
  return await new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON_BIN || "python3", [scriptPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      if (!settled) {
        settled = true;
        reject(new Error("cover render timed out"));
      }
    }, 60_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(new Error(`failed to start python: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(new Error(stderr || `python exited ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        reject(new Error(`invalid cover JSON: ${stdout}\n${stderr}`));
      }
    });
  });
}

async function main() {
  const apply = hasFlag("--apply");
  const all = hasFlag("--all");
  const limit = all ? Number.POSITIVE_INFINITY : Number(argValue("--limit") ?? "50");
  const documentId = argValue("--document-id");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const documentBucket = process.env.SUPABASE_DOCUMENT_BUCKET || "clinical-documents";
  const imageBucket = process.env.SUPABASE_IMAGE_BUCKET || "clinical-images";

  // Page through cover rows — PostgREST caps a single select at 1000 by default.
  // Stable ORDER BY is required for range/offset paging (otherwise pages can skip/dupe rows).
  const coversByDocument = new Map();
  for (let from = 0; ; from += 1000) {
    const { data: existingCoverRows, error: existingCoverError } = await supabase
      .from("document_images")
      .select("id,document_id,storage_path,index_generation_id,metadata")
      .eq("source_kind", "cover_page")
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (existingCoverError) throw new Error(existingCoverError.message);
    for (const row of existingCoverRows ?? []) {
      const key = String(row.document_id);
      const rows = coversByDocument.get(key) ?? [];
      rows.push(row);
      coversByDocument.set(key, rows);
    }
    if (!existingCoverRows?.length || existingCoverRows.length < 1000) break;
  }

  const targetLimit = all ? Number.POSITIVE_INFINITY : Number.isFinite(limit) ? limit : 50;
  const candidates = [];
  if (documentId) {
    const { data: documents, error: docsError } = await supabase
      .from("documents")
      .select("id,owner_id,title,file_name,file_type,storage_path,status,metadata")
      .eq("id", documentId)
      .eq("status", "indexed")
      .ilike("file_type", "%pdf%");
    if (docsError) throw new Error(docsError.message);
    for (const doc of documents ?? []) {
      if (doc.storage_path) candidates.push(doc);
    }
  } else {
    // Walk the full indexed-PDF set until we fill this batch (or exhaust the corpus).
    // Secondary id order keeps offset pages stable when many rows share created_at.
    for (let from = 0; candidates.length < targetLimit; from += 1000) {
      const { data: documents, error: docsError } = await supabase
        .from("documents")
        .select("id,owner_id,title,file_name,file_type,storage_path,status,metadata")
        .eq("status", "indexed")
        .ilike("file_type", "%pdf%")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + 999);
      if (docsError) throw new Error(docsError.message);
      if (!documents?.length) break;
      for (const doc of documents) {
        if (!doc.storage_path) continue;
        candidates.push(doc);
        if (candidates.length >= targetLimit) break;
      }
      if (documents.length < 1000) break;
    }
  }
  console.log(
    `Found ${candidates.length} indexed PDF candidate(s) (cover rows=${Array.from(coversByDocument.values()).reduce((sum, rows) => sum + rows.length, 0)}). mode=${apply ? "apply" : "dry-run"}`,
  );

  let created = 0;
  let repaired = 0;
  let skipped = 0;
  let failed = 0;

  function committedGenerationId(metadata) {
    return typeof metadata?.index_generation_id === "string" && metadata.index_generation_id
      ? metadata.index_generation_id
      : null;
  }

  async function loadCurrentDocument(targetDocumentId) {
    const { data, error } = await supabase
      .from("documents")
      .select("id,owner_id,title,file_name,file_type,storage_path,status,metadata")
      .eq("id", targetDocumentId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async function loadCurrentCovers(targetDocumentId) {
    const { data, error } = await supabase
      .from("document_images")
      .select("id,document_id,storage_path,index_generation_id,metadata")
      .eq("document_id", targetDocumentId)
      .eq("source_kind", "cover_page")
      .order("id", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function patchCoverImageId(targetDocumentId, coverImageId, expectedGeneration) {
    const fresh = await loadCurrentDocument(targetDocumentId);
    if (!fresh || fresh.status !== "indexed" || committedGenerationId(fresh.metadata) !== expectedGeneration) {
      return false;
    }
    const current =
      fresh.metadata && typeof fresh.metadata === "object" && !Array.isArray(fresh.metadata) ? fresh.metadata : {};
    if (current.cover_image_id === coverImageId) return true;

    let patch = supabase
      .from("documents")
      .update({ metadata: { ...current, cover_image_id: coverImageId } })
      .eq("id", targetDocumentId)
      .eq("status", "indexed")
      .eq("storage_path", fresh.storage_path)
      .eq("metadata", JSON.stringify(current));
    patch = expectedGeneration
      ? patch.eq("metadata->>index_generation_id", expectedGeneration)
      : patch.is("metadata->>index_generation_id", null);
    const { data: patched, error: patchError } = await patch.select("id").maybeSingle();
    if (patchError) throw new Error(patchError.message);
    return Boolean(patched);
  }

  async function generationIsCurrent(expectedDocument, expectedGeneration) {
    const fresh = await loadCurrentDocument(expectedDocument.id);
    return Boolean(
      fresh &&
      fresh.status === "indexed" &&
      fresh.storage_path === expectedDocument.storage_path &&
      committedGenerationId(fresh.metadata) === expectedGeneration,
    );
  }

  async function removeOrQueueReplacedImage(targetDocument, replacedPath) {
    const { data: references, error: referenceError } = await supabase
      .from("document_images")
      .select("id")
      .eq("storage_path", replacedPath)
      .limit(1);
    if (referenceError) throw new Error(referenceError.message);
    if (references?.length) return;

    const removal = await supabase.storage.from(imageBucket).remove([replacedPath]);
    if (!removal.error) return;

    const { error: cleanupError } = await supabase.from("storage_cleanup_jobs").insert({
      owner_id: targetDocument.owner_id ?? null,
      document_id: targetDocument.id,
      document_bucket: documentBucket,
      document_paths: [],
      image_bucket: imageBucket,
      image_paths: [replacedPath],
      status: "pending",
      last_error: removal.error.message,
      metadata: {
        operation: "replace_document_cover",
        created_by: "backfill-document-covers",
      },
    });
    if (cleanupError) {
      throw new Error(`failed to remove or queue replaced cover ${replacedPath}: ${cleanupError.message}`);
    }
  }

  async function retireCoverRow(targetDocument, coverRow) {
    const { error } = await supabase
      .from("document_images")
      .delete()
      .eq("id", coverRow.id)
      .eq("document_id", targetDocument.id);
    if (error) throw new Error(`failed to retire cover row ${coverRow.id}: ${error.message}`);
    if (coverRow.storage_path) {
      await removeOrQueueReplacedImage(targetDocument, coverRow.storage_path);
    }
  }

  async function rollbackReplacementCover(targetDocument, insertedId, imagePath) {
    if (insertedId) {
      const fresh = await loadCurrentDocument(targetDocument.id);
      if (fresh?.metadata?.cover_image_id === insertedId) {
        return false;
      }
      const { error } = await supabase
        .from("document_images")
        .delete()
        .eq("id", insertedId)
        .eq("document_id", targetDocument.id);
      if (error) {
        throw new Error(`failed to roll back replacement cover row ${insertedId}: ${error.message}`);
      }
    }
    await removeOrQueueReplacedImage(targetDocument, imagePath);
    return true;
  }

  for (const candidate of candidates) {
    try {
      // Candidate and cover inventories are only selection snapshots. Reload both
      // immediately before work so an atomic reindex cannot leave this repair
      // operating on the generation that was current when corpus paging began.
      const doc = await loadCurrentDocument(candidate.id);
      if (
        !doc ||
        doc.status !== "indexed" ||
        !doc.storage_path ||
        !String(doc.file_type).toLowerCase().includes("pdf")
      ) {
        console.log(`skipped stale candidate ${candidate.id}`);
        skipped += 1;
        continue;
      }

      const committedGeneration = committedGenerationId(doc.metadata);
      const existingCovers = await loadCurrentCovers(doc.id);
      const { selected: committedCover, matches: committedCovers } = selectCommittedCovers(
        existingCovers,
        committedGeneration,
        doc.metadata?.cover_image_id,
      );
      const existingCover = committedCover ?? existingCovers[0];

      let existingObjectIsLive = false;
      if (committedCover?.storage_path) {
        const probe = await supabase.storage.from(imageBucket).download(committedCover.storage_path);
        if (probe.error && !isMissingStorageObject(probe.error)) {
          throw new Error(`failed to verify existing cover ${committedCover.id}: ${probe.error.message}`);
        }
        existingObjectIsLive = !probe.error && Boolean(probe.data);
      }

      if (existingCover && existingObjectIsLive) {
        const existingId = existingCover.id;
        let changed = false;
        if (apply && doc.metadata?.cover_image_id !== existingId) {
          const patched = await patchCoverImageId(doc.id, existingId, committedGeneration);
          if (!patched) {
            console.log(`skipped generation-changed metadata repair for ${doc.id}`);
            skipped += 1;
            continue;
          }
          console.log(`recovered cover metadata ${existingId} for ${doc.id}`);
          changed = true;
        }
        if (apply && committedGeneration) {
          for (const duplicate of committedCovers) {
            if (duplicate.id === existingId) continue;
            await retireCoverRow(doc, duplicate);
            console.log(`retired duplicate cover ${duplicate.id} for ${doc.id}`);
            changed = true;
          }
        }
        if (changed) {
          repaired += 1;
        } else {
          skipped += 1;
          console.log(`verified live cover ${existingId} for ${doc.id}`);
        }
        continue;
      }

      if (!apply) {
        console.log(
          `dry-run would ${existingCover ? "repair missing cover object" : "create cover"} for ${doc.id} (${doc.title || doc.file_name})`,
        );
        continue;
      }

      const workDir = await mkdtemp(path.join(tmpdir(), "cover-backfill-"));
      try {
        let replacementPath = null;
        let replacementRowId = null;
        let replacementNeedsRollback = false;
        try {
          const { data: blob, error: downloadError } = await supabase.storage
            .from(documentBucket)
            .download(doc.storage_path);
          if (downloadError || !blob) throw new Error(downloadError?.message || "download failed");
          const pdfPath = path.join(workDir, "source.pdf");
          await writeFile(pdfPath, Buffer.from(await blob.arrayBuffer()));
          const cover = await runPythonCover(pdfPath, workDir);
          if (!cover?.path) throw new Error("cover render returned empty");

          const bytes = await readFile(cover.path);
          const generationId = committedGeneration ?? randomUUID();
          const repairId = randomUUID();
          const imagePrefix = doc.owner_id ? `${doc.owner_id}/images/${doc.id}` : `local/${doc.id}`;
          const imagePath = `${imagePrefix}/${generationId}/cover-page-1-${repairId}.png`;
          const upload = await supabase.storage.from(imageBucket).upload(imagePath, bytes, {
            contentType: "image/png",
            upsert: false,
          });
          if (upload.error) throw new Error(upload.error.message);
          replacementPath = imagePath;
          replacementNeedsRollback = true;

          // Rendering and upload can be slow. Revalidate immediately before the
          // database write, then use a generation-conditioned pointer update as
          // the final compare-and-swap. If either fence fails, remove the new
          // artifact instead of publishing an old-generation cover.
          if (!(await generationIsCurrent(doc, committedGeneration))) {
            await rollbackReplacementCover(doc, null, imagePath);
            replacementNeedsRollback = false;
            console.log(`skipped generation-changed cover repair for ${doc.id}`);
            skipped += 1;
            continue;
          }

          const imageHash = createHash("sha256").update(bytes).digest("hex");
          const imageRow = {
            document_id: doc.id,
            page_number: 1,
            storage_path: imagePath,
            mime_type: "image/png",
            caption: "Document cover page preview.",
            bbox: cover.bbox ?? null,
            image_type: "unclear",
            searchable: false,
            clinical_relevance_score: 0,
            source_kind: "cover_page",
            width: cover.width ?? null,
            height: cover.height ?? null,
            image_hash: imageHash,
            labels: ["cover-page"],
            index_generation_id: generationId,
            metadata: {
              ...(cover.metadata ?? {}),
              source_kind: "cover_page",
              clinical_use_class: "decorative_or_empty",
              index_generation_id: generationId,
              backfill: "document-cover-thumbnails",
            },
          };

          // Insert first and retire the previous row only after the document
          // pointer moves. This preserves the old storage-path ledger until the
          // replacement is committed and makes a failed compare-and-swap easy to
          // roll back without reconstructing a mutated row.
          const { data: inserted, error: insertError } = await supabase
            .from("document_images")
            .insert(imageRow)
            .select("id")
            .single();
          if (insertError) throw new Error(insertError.message);
          replacementRowId = inserted.id;

          const patched = await patchCoverImageId(doc.id, inserted.id, committedGeneration);
          if (!patched) {
            const rolledBack = await rollbackReplacementCover(doc, inserted.id, imagePath);
            if (!rolledBack) {
              throw new Error(`replacement cover ${inserted.id} became published during rollback`);
            }
            replacementNeedsRollback = false;
            console.log(`rolled back generation-changed cover repair for ${doc.id}`);
            skipped += 1;
            continue;
          }
          replacementNeedsRollback = false;

          if (existingCover) {
            await retireCoverRow(doc, existingCover);
            repaired += 1;
            console.log(`repaired cover ${inserted.id} for ${doc.id}`);
          } else {
            created += 1;
            console.log(`created cover ${inserted.id} for ${doc.id}`);
          }
        } catch (error) {
          if (replacementNeedsRollback && replacementPath) {
            try {
              await rollbackReplacementCover(doc, replacementRowId, replacementPath);
            } catch (rollbackError) {
              const originalMessage = error instanceof Error ? error.message : String(error);
              const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
              throw new Error(`${originalMessage}; rollback failed: ${rollbackMessage}`);
            }
          }
          throw error;
        }
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    } catch (error) {
      failed += 1;
      console.error(`failed ${candidate.id}:`, error instanceof Error ? error.message : error);
    }
  }

  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      created,
      repaired,
      skipped,
      failed,
      scanned: candidates.length,
    }),
  );
  if (!apply) {
    console.log("Re-run with --apply to write covers.");
  }
}

if (isDirectEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
