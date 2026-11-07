/** Offline scratch-database fixture generator. Never connects to a database.
 * Seed output is synthetic admission/claim SQL; stage output exercises the real
 * fenced RPCs. Run only against an isolated disposable database, never hosted.
 * Usage: --seed --fixture /tmp/general-pdf.json, then --stage --fixture ... --claim /tmp/claim.json.
 */
import { readFile, writeFile, rm } from "node:fs/promises";
import PDFDocument from "pdfkit";
import { extractPdf } from "../../src/lib/extractors/document";
import {
  bytesDigest,
  generationEvidenceBytes,
  originalApplicabilityFamilies,
  type OriginalApplicabilityWitness,
  type SourceExpectation,
} from "../../src/lib/ingestion-generation-evidence";
import type { ExtractedDocument } from "../../src/lib/types";
import {
  attachAttemptControlEvidence,
  attachPrerequisiteQualityDiagnostic,
  buildGenerationRetentionPacket,
  captureGenerationImages,
  type CapturedGenerationImage,
} from "../../worker/generation-evidence";
import {
  buildManagedGeneralPdfChunks,
  prepareManagedGeneralPdfTerminalPacket,
} from "../../worker/managed-general-pdf-terminal";
import { prepareNativeTextPdfCandidateChunks } from "../../worker/candidate-chunks";
import { GENERAL_PDF_INSPECTION_VERSION, generalPdfInspectionReviewSchema } from "../../worker/general-pdf-inspection";
import type { JobRow } from "../../worker/types";

const owner = "70000000-0000-4000-8000-000000000001";
const documentId = "70000000-0000-4000-8000-000000000002";
const correlation = "70000000-0000-4000-8000-000000000003";
const sqlJson = (value: unknown) => "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
function arg(flag: string): string {
  const index = process.argv.indexOf(flag);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`synthetic_fixture_requires_${flag}`);
  return value;
}
type Fixture = { originalHex: string; extracted: ExtractedDocument; capturedImages: CapturedGenerationImage[] };

async function seed(fixturePath: string) {
  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const parts: Buffer[] = [];
    const doc = new PDFDocument({ margin: 50 });
    doc.on("data", (part) => parts.push(Buffer.from(part)));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(parts)));
    doc.text("Synthetic offline native reference. Preserve this complete qualification.");
    doc.addPage().text("Synthetic second page. Preserve the final sentence exactly.");
    doc.end();
  });
  const extracted = await extractPdf(buffer);
  try {
    const capturedImages = await captureGenerationImages({
      extracted,
      trustedTemporaryRoots: extracted.temporaryPaths ?? [],
      fileName: "synthetic-native.pdf",
      mimeType: "application/pdf",
    });
    await writeFile(fixturePath, JSON.stringify({ originalHex: buffer.toString("hex"), extracted, capturedImages }));
  } finally {
    await Promise.all(
      (extracted.temporaryPaths ?? []).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  }
  const authority = {
    version: 1,
    sourceRole: "clinical_guideline",
    authorityBasis: "administrator_template",
    licencePolicy: "review_required",
    rightsEvidenceRef: "synthetic:scratch-only",
    publisher: "Synthetic publisher",
    jurisdiction: "Australia/WA",
    publicationDate: null,
    effectiveDate: null,
    reviewDate: null,
    expiryDate: null,
    currentness: "current",
    supersedesDocumentId: null,
    purpose: "clinical_retrieval",
    supportedFeatures: ["text"],
    providerProcessing: "permitted",
  };
  const filename = "synthetic-native.pdf";
  const storage = `${owner}/documents/${documentId}/${filename}`;
  const admission = {
    document_id: documentId,
    staging_owner_id: owner,
    source_channel: "admin_api",
    content_sha256: bytesDigest(buffer),
    file_name_sha256: bytesDigest(Buffer.from(filename)),
    storage_path_sha256: bytesDigest(Buffer.from(storage)),
    mime_type: "application/pdf",
    byte_count: buffer.length,
    correlation_id: correlation,
    admission_policy_version: "trusted-document-admission-v1",
    authority,
  };
  const doc = {
    id: documentId,
    owner_id: owner,
    title: "Synthetic scratch native reference",
    description: null,
    file_name: filename,
    file_type: "application/pdf",
    file_size: buffer.length,
    storage_path: storage,
    content_hash: bytesDigest(buffer).slice(7),
    metadata: { corpus_scope: "uploaded_local", content_mode: "indexed_content", authority },
    max_attempts: 1,
  };
  process.stdout.write(
    `-- SCRATCH ONLY. Generates a private synthetic document; no Storage/provider traffic.\n` +
      `insert into auth.users(id,raw_app_meta_data) values('${owner}','{"site_role":"administrator"}'::jsonb);\n` +
      `do $$ begin perform public.trusted_document_admission_core(${sqlJson(admission)},${sqlJson(doc)},false,'administrator','${owner}',null); end $$;\n` +
      `select j from public.claim_ingestion_jobs('general-pdf-scratch',1,45) j;\n`,
  );
}

async function stage(fixturePath: string, claimPath: string) {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
  const job = JSON.parse(await readFile(claimPath, "utf8")) as JobRow;
  if (job.document_id !== documentId || job.documents.owner_id !== owner || job.locked_by !== "general-pdf-scratch")
    throw new Error("synthetic_claim_identity_required");
  const originalBytes = Buffer.from(fixture.originalHex, "hex");
  const texts = fixture.extracted.pages.map((page) => page.text);
  const units = texts.map((text, index) => ({
    id: `native-page-${index + 1}`,
    required: true,
    dependencies: [],
    locator: `pdf-page:${index + 1}:native-text:${bytesDigest(Buffer.from(text))}`,
    nativeMapping: "unavailable" as const,
  }));
  const witness: OriginalApplicabilityWitness = {
    version: "ingestion-original-applicability-v1",
    qualification: "independently_declared_unverified",
    sourceSha256: bytesDigest(originalBytes),
    sourceByteLength: originalBytes.length,
    sourceUnits: units,
    groups: originalApplicabilityFamilies.map((family) => ({
      family,
      population: {
        tag: "known",
        requirements:
          family === "chunks"
            ? units.map((unit) => ({ id: `text-${unit.id}`, required: true, sourceEvidenceIds: [unit.id] }))
            : [],
        basis: { scope: "whole_original", kind: "independent_original_declaration" },
        reason: family === "chunks" ? null : "no_original_requirements_in_scope",
      },
    })),
  };
  const witnessBytes = generationEvidenceBytes(witness);
  const sourceExpectation: SourceExpectation = {
    version: 1,
    sourceSha256: bytesDigest(originalBytes),
    tag: "known",
    units,
    witness: { reference: "synthetic-independent-native-source-text-only", sha256: bytesDigest(witnessBytes) },
    limitation: null,
  };
  const issued = {
    documentId,
    generationId: job.lease_write_generation_id,
    jobId: job.id,
    workerId: job.locked_by!,
    firstLeaseToken: job.lease_token,
    attemptNumber: job.attempt_count,
    batchId: job.batch_id,
    authorityDigest: job.lease_authority_digest,
    predecessorGenerationId: job.lease_expected_generation_id,
  };
  const base = buildGenerationRetentionPacket({
    documentId,
    generationId: issued.generationId,
    originalBytes,
    sourceExpectation,
    sourceExpectationWitnessBytes: witnessBytes,
    extracted: fixture.extracted,
    capturedImages: fixture.capturedImages,
    persistedPages: fixture.extracted.pages.map((page) => ({
      document_id: documentId,
      page_number: page.pageNumber,
      text: page.text,
      ocr_used: page.ocrUsed ?? false,
      metadata: page.metadata ?? {},
    })),
    deferOptionalProducerDeclarations: true,
  });
  const control = attachAttemptControlEvidence({
    packet: base,
    issued,
    inventory: {
      ...issued,
      sourceSha256: base.registration.sourceSha256,
      sourceByteLength: base.registration.sourceByteLength,
      sourceExpectationDigest: base.registration.sourceExpectationSha256,
    },
  });
  const packet = attachPrerequisiteQualityDiagnostic({ packet: control, extracted: fixture.extracted, documentId });
  const inspection = generalPdfInspectionReviewSchema.parse({
    version: GENERAL_PDF_INSPECTION_VERSION,
    binding: {
      admissionEventId: job.documents.metadata!.admission_event_id as string,
      documentId,
      generationId: issued.generationId,
      jobId: job.id,
      attemptId: `${job.id}:${job.attempt_count}:${job.lease_token}`,
      leaseId: job.lease_token,
      contentSha256: bytesDigest(originalBytes),
      authorityDigest: issued.authorityDigest,
    },
    sourceSha256: bytesDigest(originalBytes),
    sourceByteLength: originalBytes.length,
    pageCount: texts.length,
    pages: texts.map((text, index) => ({ pageNumber: index + 1, text, textSha256: bytesDigest(Buffer.from(text)) })),
    pageInventory: "complete",
    activeContent: "absent",
    encryption: "not_encrypted",
    hiddenText: "consistent",
    inspectedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  });
  const input = { packet, originalBytes, witnessBytes, extracted: fixture.extracted, inspection, documentId };
  const rows = buildManagedGeneralPdfChunks(input);
  const chunkPlan = prepareNativeTextPdfCandidateChunks({ ...input, chunkRows: rows });
  const terminal = prepareManagedGeneralPdfTerminalPacket({ ...input, issued, ownerId: owner, chunkRows: rows });
  const fence = {
    job_kind: "node",
    job_id: job.id,
    document_id: documentId,
    worker_id: issued.workerId,
    lease_token: issued.firstLeaseToken,
    expected_generation_id: issued.predecessorGenerationId,
    authority_digest: issued.authorityDigest,
  };
  const statements: string[] = [
    "begin;",
    `create temporary table scratch_prior_chunks on commit drop as select id,to_jsonb(c) as body from public.document_chunks c where document_id='${documentId}' and index_generation_id is not distinct from ${issued.predecessorGenerationId ? "'" + issued.predecessorGenerationId + "'::uuid" : "null::uuid"};`,
  ];
  const priorRowsUnchanged = `do $$ begin if (select coalesce(jsonb_agg(body order by id),'[]'::jsonb) from scratch_prior_chunks) is distinct from (select coalesce(jsonb_agg(to_jsonb(c) order by id),'[]'::jsonb) from public.document_chunks c where document_id='${documentId}' and index_generation_id is not distinct from ${issued.predecessorGenerationId ? "'" + issued.predecessorGenerationId + "'::uuid" : "null::uuid"}) then raise exception 'TEST_PRIOR_ROWS_CHANGED';end if;end $$;`;
  const call = (name: string, params: Record<string, unknown>) => {
    const arguments_: Record<string, unknown> = { p_fence: fence, ...params };
    statements.push(
      `select public.${name}(${Object.entries(arguments_)
        .map(
          ([key, value]) =>
            `${key} => ${value === null ? "null" : typeof value === "string" ? "'" + value.replaceAll("'", "''") + "'" : sqlJson(value)}`,
        )
        .join(",")});`,
    );
  };
  call("begin_ingestion_generation_evidence", {
    p_generation: issued.generationId,
    p_registration: packet.registration,
    p_original_hex: fixture.originalHex,
  });
  call("declare_ingestion_generation_evidence", {
    p_generation: issued.generationId,
    p_declarations: packet.declarations,
  });
  call("retain_ingestion_generation_artifacts", { p_generation: issued.generationId, p_artifacts: packet.artifacts });
  call("record_ingestion_generation_outcomes", { p_generation: issued.generationId, p_outcomes: packet.outcomes });
  call("declare_ingestion_generation_evidence", {
    p_generation: issued.generationId,
    p_declarations: chunkPlan.declarations,
  });
  call("retain_ingestion_generation_artifacts", {
    p_generation: issued.generationId,
    p_artifacts: chunkPlan.artifacts,
  });
  call("record_ingestion_generation_outcomes", { p_generation: issued.generationId, p_outcomes: chunkPlan.outcomes });
  const finish = `public.complete_managed_general_pdf(${sqlJson(fence)},'${issued.generationId}',${sqlJson(terminal)},false)`;
  statements.push(
    `do $$ begin begin perform ${finish};raise exception 'TEST_EXPECTED_PARTIAL_POPULATION_REFUSAL'; exception when raise_exception then if sqlerrm<>'managed_general_pdf_actual_population' then raise;end if;end; if (select index_generation_id from public.documents where id='${documentId}') is distinct from ${issued.predecessorGenerationId ? "'" + issued.predecessorGenerationId + "'::uuid" : "null::uuid"} then raise exception 'TEST_PRIOR_POINTER_LOST';end if;end $$;`,
  );
  statements.push(priorRowsUnchanged);
  call("write_ingestion_base_artifacts", {
    p_generation: issued.generationId,
    p_chunks: rows.map((row) => ({
      ...row,
      embedding: Array.from({ length: 1536 }, (_, index) => (index === 0 ? 1 : 0)),
    })),
    p_images: [],
    p_table_facts: [],
    p_embedding_fields: [],
    p_index_units: [],
  });
  for (const field of ["inspectedAt", "expiresAt"] as const) {
    for (const value of [null, 123, "not-a-timestamp", "2026-02-30T00:00:00Z", undefined]) {
      const inspection: Record<string, unknown> = { ...terminal.inspection };
      if (value === undefined) delete inspection[field];
      else inspection[field] = value;
      statements.push(
        `do $$ begin begin perform public.complete_managed_general_pdf(${sqlJson(fence)},'${issued.generationId}',${sqlJson({ ...terminal, inspection })},false);raise exception 'TEST_EXPECTED_INSPECTION_FRESHNESS_REFUSAL'; exception when raise_exception then if sqlerrm<>'managed_general_pdf_inspection_binding' then raise;end if;end;end $$;`,
      );
      statements.push(priorRowsUnchanged);
    }
  }
  statements.push(
    `do $$ begin begin update public.documents set metadata=metadata||'{"corpus_scope":"australian_public"}'::jsonb where id='${documentId}';perform ${finish};raise exception 'TEST_EXPECTED_PUBLIC_SCOPE_REFUSAL'; exception when raise_exception then if sqlerrm<>'managed_general_pdf_owner_scope_required' then raise;end if;end;end $$;`,
  );
  statements.push(priorRowsUnchanged);
  statements.push(
    `do $$ begin begin update auth.users set raw_app_meta_data='{"site_role":"member"}'::jsonb where id='${owner}';perform ${finish};raise exception 'TEST_EXPECTED_REVOKED_ADMINISTRATOR_REFUSAL'; exception when raise_exception then if sqlerrm<>'managed_general_pdf_current_administrator_required' then raise;end if;end;end $$;`,
  );
  statements.push(priorRowsUnchanged);
  statements.push(
    `do $$ begin begin perform public.complete_managed_general_pdf(${sqlJson({ ...fence, lease_token: owner })},'${issued.generationId}',${sqlJson(terminal)},false);raise exception 'TEST_EXPECTED_STALE_LEASE_REFUSAL'; exception when raise_exception then if sqlerrm<>'managed_general_pdf_identity_mismatch' then raise;end if;end; if (select index_generation_id from public.documents where id='${documentId}') is distinct from ${issued.predecessorGenerationId ? "'" + issued.predecessorGenerationId + "'::uuid" : "null::uuid"} then raise exception 'TEST_PRIOR_POINTER_LOST';end if;end $$;`,
  );
  statements.push(priorRowsUnchanged);
  statements.push(`select ${finish};`);
  statements.push(
    `select public.complete_managed_general_pdf(${sqlJson(fence)},'${issued.generationId}',${sqlJson(terminal)},true);`,
  );
  statements.push(
    `do $$ begin if (select index_generation_id from public.documents where id='${documentId}') is distinct from '${issued.generationId}'::uuid or (select status from public.ingestion_jobs where id='${job.id}')<>'completed' or (select count(*) from public.document_pages where document_id='${documentId}' and index_generation_id='${issued.generationId}')<>${texts.length} or (select count(*) from public.document_chunks where document_id='${documentId}' and index_generation_id='${issued.generationId}')<>${rows.length} then raise exception 'TEST_ACTIVATION_STATE_MISMATCH';end if;end $$;`,
  );
  statements.push(process.argv.includes("--commit-success") ? "commit;" : "rollback;");
  process.stdout.write(statements.join("\n") + "\n");
}

async function main() {
  if (process.argv.includes("--seed")) await seed(arg("--fixture"));
  else if (process.argv.includes("--reclaim"))
    process.stdout.write(
      `do $$ begin if (public.request_ingestion_reindex_if_agent_idle('${documentId}','${owner}',clock_timestamp()-interval '45 minutes',1))->>'outcome'<>'queued' then raise exception 'TEST_REINDEX_NOT_QUEUED';end if;end $$;\nselect j from public.claim_ingestion_jobs('general-pdf-scratch',1,45) j;\n`,
    );
  else if (process.argv.includes("--stage")) await stage(arg("--fixture"), arg("--claim"));
  else throw new Error("synthetic_fixture_requires_explicit_seed_or_stage_and_paths");
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
