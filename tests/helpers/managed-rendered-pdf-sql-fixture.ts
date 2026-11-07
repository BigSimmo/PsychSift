/** Synthetic scratch-only SQL generator; never connects to any database. */
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolvePythonBin } from "../../src/lib/python-bin";
import type { ContentSha256 } from "../../src/lib/document-ingress-safety";
import {
  bytesDigest,
  generationEvidenceBytes,
  parseIssuedAttemptControl,
  generationEvidenceDigest,
} from "../../src/lib/ingestion-generation-evidence";
import {
  buildGenerationRetentionPacket,
  attachAttemptControlEvidence,
  attachPrerequisiteQualityDiagnostic,
} from "../../worker/generation-evidence";
import {
  buildInternalRenderedPdfExpectation,
  prepareManagedRenderedPdfGeneration,
  captureManagedRenderedPdfArtifacts,
} from "../../worker/managed-rendered-pdf-terminal";
import { inspectRenderedPdfOriginal, type RenderedPdfInspection } from "../../worker/rendered-pdf-inspection-producer";
import {
  validateRenderedPdfReview,
  renderedPdfReviewDigest,
  type RenderedPdfReview,
} from "../../worker/rendered-pdf-review";
import type { JobRow } from "../../worker/types";
import { prepareAdministratorDocumentReadmission } from "../../src/lib/admin-document-readmission";
import { prepareManagedPdfSummaryContext, prepareManagedPdfSummaryProjection } from "../../worker/managed-pdf-summary";
import { normalizeSourceAnchoredSummary } from "../../supabase/functions/_shared/source-anchored-summary";
// Repeatable scratch runs must not reuse an immutable readmission correlation.
const prefixIndex = process.argv.indexOf("--id-prefix");
const idPrefix = prefixIndex < 0 ? "7a000000" : process.argv[prefixIndex + 1];
if (!idPrefix || !/^[a-f0-9]{8}$/.test(idPrefix)) throw new Error("fixture_id_prefix_invalid");
const ids = Array.from({ length: 6 }, (_, i) => `${idPrefix}-0000-4000-8000-00000000000${i + 1}`);
const sqlJson = (value: unknown) => "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
const sqlText = (value: string) => "'" + value.replaceAll("'", "''") + "'";
function arg(name: string) {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1] || process.argv[i + 1].startsWith("--"))
    throw new Error(`fixture_requires_${name}`);
  return process.argv[i + 1];
}
type Saved = { originalHex: string; sourcePath: string; inspection: RenderedPdfInspection; review: RenderedPdfReview };
const authority = {
  version: 1,
  sourceRole: "clinical_guideline",
  authorityBasis: "administrator_template",
  licencePolicy: "review_required",
  rightsEvidenceRef: "synthetic:current-steward-reindex-action",
  publisher: "Synthetic publisher",
  jurisdiction: "Australia/WA",
  publicationDate: null,
  effectiveDate: null,
  reviewDate: null,
  expiryDate: null,
  currentness: "unknown",
  supersedesDocumentId: null,
  purpose: "clinical_retrieval",
  supportedFeatures: ["images", "tables", "text"],
  providerProcessing: "permitted",
};
function original() {
  return execFileSync(
    resolvePythonBin(),
    [
      "-c",
      `import pymupdf as f,sys
D=f.open();p=D.new_page(width=300,height=300)
p.insert_text((20,30),'Synthetic reference action.',fontsize=12)
p.insert_text((20,75),'Header A    Header B',fontsize=10)
p.insert_text((20,95),'Example     Review',fontsize=10)
p.draw_rect(f.Rect(15,55,250,110));p.draw_line((130,55),(130,110));p.draw_line((15,80),(250,80))
p.insert_text((20,150),'Alpha -> Beta',fontsize=12);p.draw_line((70,145),(110,145))
sys.stdout.buffer.write(D.tobytes())`,
    ],
    { maxBuffer: 8 * 1024 * 1024 },
  );
}
async function seed(file: string) {
  const bytes = original(),
    sha = bytesDigest(bytes);
  const folder = await mkdtemp(path.join(os.tmpdir(), "managed-rendered-sql-"));
  const sourcePath = path.join(folder, "synthetic-rendered.pdf");
  await writeFile(sourcePath, bytes);
  const inspection = await inspectRenderedPdfOriginal(sourcePath, folder, sha, { timeoutMs: 120000 });
  const manual = (text: string, region: [number, number, number, number]) => ({
    origin: "manual_render_transcription" as const,
    region,
    text,
  });
  const render = inspection.renderPages[0]!;
  const bounds: [number, number, number, number] = [0, 0, render.artifact.width, render.artifact.height];
  const review: RenderedPdfReview = {
    version: "administrator-rendered-pdf-inspection-v1",
    verificationScope: "source_anchored_render_review_not_clinical_signoff",
    authority: "render_review_only_no_ingestion_provider_publication_or_clinical_approval",
    sourceSha256: sha,
    sourceByteLength: bytes.length,
    pageCount: 1,
    nativeLayerDisposition: "excluded_from_admitted_evidence",
    originalNativeConflict: "unresolved",
    runtime: inspection.runtime,
    rasterContainer: { sha256: inspection.rasterContainer.sha256, byteLength: inspection.rasterContainer.byteLength },
    reviewer: {
      reviewerId: ids[5]!,
      reviewedAt: new Date(Date.now() - 1000).toISOString(),
      referenceSha256: bytesDigest(Buffer.from("synthetic-only-render-review-not-owner-approval")),
    },
    pageCoverage: "reviewed_complete",
    pages: [
      {
        pageNumber: 1,
        fullPageReviewed: true,
        coordinateSpace: "render_pixels",
        originalGeometrySha256: generationEvidenceDigest(render.originalGeometry),
        render: {
          sha256: render.artifact.sha256,
          byteLength: render.artifact.byteLength,
          width: render.artifact.width,
          height: render.artifact.height,
        },
        ocrTextSha256: bytesDigest(Buffer.from(inspection.extraction.pages[0]!.text)),
        ocrTextByteLength: Buffer.byteLength(inspection.extraction.pages[0]!.text),
        textCoverage: "reviewed_complete",
        text: [manual("Synthetic reference action.", bounds)],
        tables: {
          status: "reviewed_complete",
          records: [
            {
              id: "example-table",
              region: bounds,
              relationships: "reviewed_complete",
              rows: [
                {
                  rowIndex: 0,
                  cells: [
                    { columnIndex: 0, content: manual("Header A", bounds) },
                    { columnIndex: 1, content: manual("Header B", bounds) },
                  ],
                },
                {
                  rowIndex: 1,
                  cells: [
                    { columnIndex: 0, content: manual("Example", bounds) },
                    { columnIndex: 1, content: manual("Review", bounds) },
                  ],
                },
              ],
            },
          ],
        },
        diagrams: {
          status: "reviewed_complete",
          records: [
            {
              id: "example-diagram",
              region: bounds,
              relationships: "reviewed_complete",
              nodes: [
                { id: "alpha", content: manual("Alpha", bounds) },
                { id: "beta", content: manual("Beta", bounds) },
              ],
              edges: [
                {
                  id: "next",
                  fromNodeId: "alpha",
                  toNodeId: "beta",
                  direction: "directed",
                  label: null,
                  region: bounds,
                },
              ],
            },
          ],
        },
        unresolvedHolds: [],
      },
    ],
  };
  await validateRenderedPdfReview({
    review,
    inspection,
    sourcePath,
    originalBytes: bytes,
    approvedReviewSha256: new Set([renderedPdfReviewDigest(review)]),
  });
  await writeFile(
    file,
    JSON.stringify({ originalHex: bytes.toString("hex"), sourcePath, inspection, review } satisfies Saved),
  );
  const doc = {
    id: ids[0],
    owner_id: null,
    file_name: "synthetic-rendered.pdf",
    storage_path: "legacy-originals/synthetic-rendered.pdf",
    file_type: "application/pdf" as const,
    file_size: bytes.length,
    content_hash: sha.slice(7),
    metadata: { public_corpus: true },
  };
  const payload = prepareAdministratorDocumentReadmission(
    { administratorId: ids[5], correlationId: ids[4], maxAttempts: 1, authority, document: doc },
    bytes,
  );
  const claims = {
    sub: ids[5],
    role: "authenticated",
    aal: "aal2",
    app_metadata: { site_role: "administrator" },
    amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }],
  };
  const admissionCall = `public.readmit_administrator_document_for_reindex(${Object.entries(payload)
    .map(
      ([k, v]) =>
        `${k}=>${v === null ? "null" : typeof v === "object" ? sqlJson(v) : typeof v === "string" ? "'" + v.replaceAll("'", "''") + "'" : String(v)}`,
    )
    .join(",")})`;
  process.stdout.write(
    `-- SCRATCH-ONLY historical shared-row fixture, not a publication operation.\nbegin;\ninsert into auth.users(id,raw_app_meta_data)values('${ids[5]}','{"site_role":"administrator"}'::jsonb) on conflict(id) do nothing;\nset local session_replication_role=replica;\ninsert into public.documents(id,owner_id,title,file_name,file_type,file_size,storage_path,content_hash,status,metadata)values('${ids[0]}',null,'Synthetic existing shared reference','${doc.file_name}','application/pdf',${doc.file_size},'${doc.storage_path}','${doc.content_hash}','indexed','{"public_corpus":true}'::jsonb);\nset local session_replication_role=origin;\ncommit;\ndo $$ begin perform set_config('request.jwt.claims',${sqlJson(claims)}::text,false);perform set_config('request.jwt.claim.sub','${ids[5]}',false);perform set_config('request.jwt.claim.role','authenticated',false);perform ${admissionCall};end $$;\nselect j from public.claim_ingestion_jobs('rendered-pdf-scratch',1,45)j;\n`,
  );
}
async function stage(path: string, claimPath: string) {
  const saved = JSON.parse(await readFile(path, "utf8")) as Saved;
  const job = JSON.parse(await readFile(claimPath, "utf8")) as JobRow;
  if (job.document_id !== ids[0] || job.documents.owner_id !== null || job.documents.metadata?.public_corpus !== true)
    throw new Error("synthetic_shared_source_required");
  const originalBytes = Buffer.from(saved.originalHex, "hex");
  const issued = parseIssuedAttemptControl({
    documentId: job.document_id,
    generationId: job.lease_write_generation_id,
    jobId: job.id,
    workerId: job.locked_by,
    firstLeaseToken: job.lease_token,
    attemptNumber: job.attempt_count,
    batchId: job.batch_id,
    authorityDigest: job.lease_authority_digest,
    predecessorGenerationId: job.lease_expected_generation_id,
  });
  // This allowlist exists only in this synthetic fixture, never operator input.
  const acceptedReview = await validateRenderedPdfReview({
    review: saved.review,
    inspection: saved.inspection,
    sourcePath: saved.sourcePath,
    originalBytes,
    approvedReviewSha256: new Set([renderedPdfReviewDigest(saved.review)]),
  });
  const expectation = buildInternalRenderedPdfExpectation(acceptedReview);
  const { extracted, capturedImages } = await captureManagedRenderedPdfArtifacts(acceptedReview);
  const base = buildGenerationRetentionPacket({
    documentId: job.document_id,
    generationId: issued.generationId,
    originalBytes,
    renderedReview: acceptedReview,
    renderedRasterBytes: await readFile(saved.inspection.rasterContainer.path),
    ...expectation,
    extracted,
    capturedImages,
    persistedPages: extracted.pages.map((p) => ({
      document_id: job.document_id,
      page_number: p.pageNumber,
      text: p.text,
      ocr_used: p.ocrUsed ?? false,
      metadata: p.metadata ?? {},
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
  const retentionPacket = attachPrerequisiteQualityDiagnostic({
    packet: control,
    extracted,
    documentId: job.document_id,
  });
  const plan = await prepareManagedRenderedPdfGeneration({
    job,
    issued,
    retentionPacket,
    originalBytes,
    acceptedReview,
    binding: {
      admissionEventId: job.documents.metadata!.admission_event_id as string,
      documentId: job.document_id,
      generationId: issued.generationId,
      jobId: job.id,
      leaseId: job.lease_token,
      attemptId: `${job.id}:${job.attempt_count}:${job.lease_token}`,
      contentSha256: bytesDigest(originalBytes) as ContentSha256,
      authorityDigest: job.lease_authority_digest as ContentSha256,
    },
    capturedImages,
    stewardId: ids[5],
  });
  const packet = JSON.parse(generationEvidenceBytes(plan.packet).toString("utf8")) as Omit<
    typeof plan.packet,
    "version"
  > & { version: string; summaryProjection?: ReturnType<typeof prepareManagedPdfSummaryProjection> };
  for (const u of plan.embeddingUnits) {
    const r = packet.rows[u.family].find((r) => r.id === u.id);
    if (!r) throw new Error("fixture_row_missing");
    r.embedding = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
  }
  const withSummary = true;
  if (withSummary) {
    const context = prepareManagedPdfSummaryContext({
      document: {
        id: job.document_id,
        title: job.documents.title ?? "Synthetic reference",
        file_name: job.documents.file_name,
        source_path: null,
      },
      packet,
    });
    const { authority: summaryAuthority } = context.plan;
    const chunk = summaryAuthority.selectedChunks[0];
    if (!chunk) throw new Error("fixture_summary_source_required");
    const claimText = "Synthetic reference action.";
    const item = {
      text: claimText,
      source_chunk_ids: [chunk.id],
      source_image_ids: [],
      pages: chunk.page_number ? [chunk.page_number] : [],
      evidence_type: "text",
      support: "direct",
    };
    const summary = `- ${claimText}`;
    const payload = normalizeSourceAnchoredSummary(
      {
        summary_kind: "structured",
        summary_version: "source-anchored-summary-v1",
        document_id: job.document_id,
        index_generation_id: issued.generationId,
        model: summaryAuthority.expectedStructuredModel,
        model_version: summaryAuthority.expectedStructuredModelVersion,
        generated_at: new Date().toISOString(),
        source_chunk_ids: summaryAuthority.selectedChunks.map((row) => row.id),
        source_image_ids: summaryAuthority.selectedImages.map((row) => row.id),
        summary,
        clinical_specifics: {
          profile: {
            overview: summary,
            applies_to: [],
            key_clinical_actions: [item],
            medication_dose_monitoring: [],
            thresholds_timing: [],
            escalation_risk_warnings: [],
            required_forms_documentation: [],
            not_covered: [],
            important_tables_images: [],
            best_questions: [],
            source_quality_notes: [],
          },
          actions: [claimText],
          thresholds_timing: [],
          medication_monitoring: [],
          risk_escalation: [],
          documentation_forms: [],
          exceptions_gaps: [],
        },
        labels: [{ label: "synthetic", label_type: "topic", confidence: 0.9 }],
        heuristic_fallback: false,
      },
      summaryAuthority,
    );
    packet.summaryProjection = prepareManagedPdfSummaryProjection(
      context,
      {
        payload,
        providerEvidence: {
          requestedModel: payload.model,
          providerModel: "synthetic-offline-model",
          requestId: "synthetic-offline-request",
        },
      },
      null,
    );
    packet.version = "managed-rendered-pdf-packet-v1";
    packet.deferredOptionalFamilies = packet.deferredOptionalFamilies.filter((family) => family !== "model_summary");
  }
  const fence = {
    job_kind: "node",
    job_id: job.id,
    document_id: job.document_id,
    worker_id: job.locked_by,
    lease_token: job.lease_token,
    expected_generation_id: job.lease_expected_generation_id,
    authority_digest: job.lease_authority_digest,
  };
  const statements = ["begin;"];
  if (withSummary)
    statements.push(
      `insert into public.document_summaries(document_id,owner_id,summary,metadata) values('${job.document_id}',null,'Synthetic predecessor summary',${sqlJson(issued.predecessorGenerationId ? { index_generation_id: issued.predecessorGenerationId } : {})}) on conflict(document_id) do nothing;`,
      `insert into public.document_labels(document_id,owner_id,label,label_type,source,metadata) values('${job.document_id}',null,'synthetic predecessor','topic','generated',${sqlJson(issued.predecessorGenerationId ? { index_generation_id: issued.predecessorGenerationId } : {})}),('${job.document_id}',null,'synthetic manual','custom','manual','{}') on conflict(document_id,label_type,label,source) do nothing;`,
    );
  statements.push(
    `create temp table prior_shared_state on commit drop as select to_jsonb(d) as document,(select coalesce(jsonb_agg(to_jsonb(c)order by id),'[]')from public.document_chunks c where document_id=d.id and index_generation_id is not distinct from d.index_generation_id) as chunks,(select to_jsonb(s) from public.document_summaries s where document_id=d.id) as summary,(select coalesce(jsonb_agg(to_jsonb(l)order by id),'[]')from public.document_labels l where document_id=d.id) as labels from public.documents d where d.id='${job.document_id}';`,
  );
  const call = (name: string, params: Record<string, unknown>) => {
    const arguments_: Record<string, unknown> = { p_fence: fence, ...params };
    statements.push(
      `select public.${name}(${Object.entries(arguments_)
        .map(
          ([k, v]) =>
            `${k}=>${v === null ? "null" : typeof v === "object" ? sqlJson(v) : typeof v === "string" ? "'" + v.replaceAll("'", "''") + "'" : String(v)}`,
        )
        .join(",")});`,
    );
  };
  call("begin_ingestion_generation_evidence", {
    p_generation: issued.generationId,
    p_registration: retentionPacket.registration,
    p_original_hex: saved.originalHex,
  });
  call("declare_ingestion_generation_evidence", {
    p_generation: issued.generationId,
    p_declarations: retentionPacket.declarations,
  });
  call("retain_ingestion_generation_artifacts", {
    p_generation: issued.generationId,
    p_artifacts: retentionPacket.artifacts,
  });
  call("record_ingestion_generation_outcomes", {
    p_generation: issued.generationId,
    p_outcomes: retentionPacket.outcomes,
  });
  const priorCheck = `if (select index_generation_id from public.documents where id='${job.document_id}') is distinct from ${issued.predecessorGenerationId ? "'" + issued.predecessorGenerationId + "'::uuid" : "null::uuid"} or (select owner_id from public.documents where id='${job.document_id}') is not null or (select metadata->'public_corpus' from public.documents where id='${job.document_id}') is distinct from 'true'::jsonb then raise exception 'TEST_PRIOR_SHARED_STATE_LOST';end if;`;
  const partial = { ...packet, rows: { ...packet.rows, images: [] } };
  statements.push(
    `do $$ begin begin perform public.stage_managed_full_pdf(${sqlJson(fence)},'${issued.generationId}',${sqlJson(partial)});raise exception 'TEST_EXPECTED_PARTIAL_REFUSAL';exception when raise_exception then if sqlerrm not like 'managed_rendered_pdf_%' then raise;end if;end;${priorCheck}end $$;`,
  );
  if (withSummary) {
    const invalid = (name: string, mutate: (value: Record<string, unknown>) => void) => {
      const changed = JSON.parse(JSON.stringify(packet)) as Record<string, unknown>;
      mutate(changed);
      statements.push(
        `do $$ begin begin perform public.stage_managed_full_pdf(${sqlJson(fence)},'${issued.generationId}',${sqlJson(changed)});raise exception 'TEST_EXPECTED_${name}_REFUSAL';exception when raise_exception then if sqlerrm not like 'managed_full_pdf_summary_%' then raise;end if;end;${priorCheck}end $$;`,
      );
    };
    // JSON path mutations keep each negative case independent and synthetic.
    const set = (value: Record<string, unknown>, path: string[], replacement: unknown) => {
      let cursor = value;
      for (const key of path.slice(0, -1)) cursor = cursor[key] as Record<string, unknown>;
      cursor[path[path.length - 1]] = replacement;
    };
    invalid("CROSS_DOCUMENT", (value) => set(value, ["summaryProjection", "summary", "document_id"], ids[5]));
    invalid("WRONG_OWNER", (value) => set(value, ["summaryProjection", "summary", "owner_id"], ids[5]));
    invalid("WRONG_GENERATION", (value) =>
      set(value, ["summaryProjection", "summary", "metadata", "index_generation_id"], ids[5]),
    );
    invalid("INCOMPLETE", (value) =>
      set(value, ["summaryProjection", "summary", "metadata", "source_anchored_summary_projection_complete_v1"], false),
    );
    invalid("NESTED_ANCHOR", (value) => {
      set(
        value,
        [
          "summaryProjection",
          "summary",
          "metadata",
          "source_anchored_summary_v1",
          "clinical_specifics",
          "profile",
          "key_clinical_actions",
          "0",
          "source_chunk_ids",
        ],
        [ids[5]],
      );
      set(
        value,
        [
          "summaryProjection",
          "summary",
          "clinical_specifics",
          "profile",
          "key_clinical_actions",
          "0",
          "source_chunk_ids",
        ],
        [ids[5]],
      );
    });
    invalid("PROVIDER", (value) =>
      set(value, ["summaryProjection", "summary", "metadata", "managed_summary_provider_evidence", "requestId"], null),
    );
    invalid("REQUEST_HASH", (value) =>
      set(value, ["summaryProjection", "summary", "metadata", "managed_summary_request_sha256"], "sha256:invalid"),
    );
    invalid("LABEL_ANCHOR", (value) =>
      set(value, ["summaryProjection", "labels", "0", "metadata", "source_chunk_ids"], [ids[5]]),
    );
  }
  const mutateRender = (name: string, mutate: (p: typeof packet) => void) => {
    const bad = structuredClone(packet);
    mutate(bad);
    statements.push(
      `do $$ begin begin perform public.stage_managed_full_pdf(${sqlJson(fence)},'${issued.generationId}',${sqlJson(bad)});raise exception 'TEST_RENDER_${name}_ACCEPTED';exception when raise_exception then if sqlerrm not like 'managed_rendered_pdf_%' then raise;end if;end;${priorCheck}end $$;`,
    );
  };
  mutateRender("REVIEW_DIGEST", (p) => {
    p.inspection.reviewSha256 = `sha256:${"0".repeat(64)}`;
  });
  mutateRender("NATIVE_EXTRA", (p) => {
    Object.assign(p.inspection, { hiddenText: "consistent" });
  });
  mutateRender("BINDING", (p) => {
    p.inspection.binding = { ...p.inspection.binding, documentId: ids[5]! };
  });
  mutateRender("WRONG_OWNER", (p) => {
    p.identity.documentOwnerId = ids[5]!;
  });
  mutateRender("RENDER_ANCHOR", (p) => {
    p.inspection.pages[0]!.renderSha256 = `sha256:${"0".repeat(64)}`;
  });
  mutateRender("MISSING_DIAGRAM", (p) => {
    p.inspection.diagrams = [];
  });
  call("stage_managed_full_pdf", { p_generation: issued.generationId, p_packet: packet });
  const digest = `(select packet_digest from ingestion_generation_evidence.full_pdf_stages where document_id='${job.document_id}' and generation_id='${issued.generationId}')`;
  statements.push(
    `do $$ begin begin perform public.complete_managed_full_pdf(${sqlJson({ ...fence, lease_token: ids[5] })},'${issued.generationId}',${digest},false);raise exception 'TEST_EXPECTED_STALE_REFUSAL';exception when raise_exception then if sqlerrm not like 'managed_full_pdf_%' then raise;end if;end;${priorCheck}end $$;`,
  );
  if (withSummary) {
    const changed = JSON.parse(JSON.stringify(packet)) as typeof packet;
    if (!changed.summaryProjection) throw new Error("fixture_summary_required");
    // Alter a valid metadata field: validation passes, immutable staging refuses.
    (changed.summaryProjection.summary.metadata as Record<string, unknown>).managed_summary_request_sha256 =
      `sha256:${"a".repeat(64)}`;
    statements.push(
      `do $$ begin begin perform public.stage_managed_full_pdf(${sqlJson(fence)},'${issued.generationId}',${sqlJson(changed)});raise exception 'TEST_STAGE_TAMPER_ALLOWED';exception when raise_exception then if sqlerrm<>'managed_full_pdf_immutable_stage' then raise;end if;end;end $$;`,
      `create function pg_temp.reject_summary_job_completion() returns trigger language plpgsql as $$ begin if new.id='${job.id}'::uuid and new.status='completed' then raise exception 'TEST_INJECTED_JOB_COMPLETION_FAILURE' using errcode='23514';end if;return new;end $$;`,
      `create trigger synthetic_reject_summary_completion before update on public.ingestion_jobs for each row execute function pg_temp.reject_summary_job_completion();`,
      `do $$ begin begin perform public.complete_managed_full_pdf(${sqlJson(fence)},'${issued.generationId}',${digest},false);raise exception 'TEST_EXPECTED_COMPLETION_FAILURE';exception when check_violation then if sqlerrm<>'TEST_INJECTED_JOB_COMPLETION_FAILURE' then raise;end if;end;if (select to_jsonb(d)from public.documents d where id='${job.document_id}')is distinct from(select document from prior_shared_state) or (select to_jsonb(s)from public.document_summaries s where document_id='${job.document_id}')is distinct from(select summary from prior_shared_state) or (select coalesce(jsonb_agg(to_jsonb(l)order by id),'[]')from public.document_labels l where document_id='${job.document_id}')is distinct from(select labels from prior_shared_state) or exists(select 1 from public.document_chunks where document_id='${job.document_id}' and index_generation_id='${issued.generationId}') or exists(select 1 from ingestion_generation_evidence.retained_artifacts where document_id='${job.document_id}' and generation_id='${issued.generationId}' and unit_key='preseal_checkpoint')then raise exception 'TEST_SUMMARY_COMPLETION_NOT_ATOMIC';end if;end $$;`,
      "drop trigger synthetic_reject_summary_completion on public.ingestion_jobs;",
    );
  }
  // Readmission leaves live ranking fields untouched until the terminal applies them.
  statements.push(
    `do $$ begin if (select not ingestion_generation_evidence.pending_reindex_authority_valid(metadata) or metadata#>>'{pending_reindex_authority,values,publisher}' is distinct from ${sqlText(authority.publisher)} or exists(select 1 from jsonb_each(metadata->'pending_reindex_authority'->'prior') prior where coalesce(metadata->prior.key,'null'::jsonb) is distinct from prior.value) from public.documents where id='${job.document_id}') then raise exception 'TEST_READMISSION_WROTE_LIVE_RANKING_FIELDS';end if;end $$;`,
  );
  statements.push(
    `select public.complete_managed_full_pdf(${sqlJson(fence)},'${issued.generationId}',${digest},false);`,
  );
  statements.push(
    `select public.complete_managed_full_pdf(${sqlJson(fence)},'${issued.generationId}',${digest},true);`,
  );
  statements.push(
    `do $$ begin if (select metadata ? 'pending_reindex_authority' or metadata->>'publisher' is distinct from ${sqlText(authority.publisher)} or metadata->>'source_role' is distinct from ${sqlText(authority.sourceRole)} or metadata->>'licence_policy' is distinct from ${sqlText(authority.licencePolicy)} or metadata->>'document_status' is distinct from ${sqlText(authority.currentness)} or metadata->>'jurisdiction' is distinct from ${sqlText(authority.jurisdiction)} from public.documents where id='${job.document_id}') then raise exception 'TEST_PENDING_RANKING_FIELDS_NOT_APPLIED';end if;end $$;`,
  );
  if (withSummary) {
    statements.push(
      `do $$ declare p jsonb;begin select packet into strict p from ingestion_generation_evidence.full_pdf_stages where document_id='${job.document_id}' and generation_id='${issued.generationId}';if not ingestion_generation_evidence.full_pdf_rows_match('${job.document_id}','${issued.generationId}',p) or not exists(select 1 from public.document_labels where document_id='${job.document_id}' and source='manual' and label='synthetic manual')then raise exception 'TEST_ACTIVE_SUMMARY_OR_MANUAL_LABEL_LOST';end if;end $$;`,
      `do $$ begin begin update public.document_summaries set summary='Synthetic tamper' where document_id='${job.document_id}';begin perform public.complete_managed_full_pdf(${sqlJson(fence)},'${issued.generationId}',${digest},true);raise exception 'TEST_SUMMARY_TAMPER_ALLOWED';exception when raise_exception then if sqlerrm<>'managed_full_pdf_completed_read_mismatch' then raise;end if;end;raise exception 'TEST_RESTORE_SUMMARY';exception when raise_exception then if sqlerrm<>'TEST_RESTORE_SUMMARY' then raise;end if;end;end $$;`,
      `do $$ begin begin update public.document_labels set metadata='{}' where document_id='${job.document_id}' and source='generated';begin perform public.complete_managed_full_pdf(${sqlJson(fence)},'${issued.generationId}',${digest},true);raise exception 'TEST_LABEL_TAMPER_ALLOWED';exception when raise_exception then if sqlerrm<>'managed_full_pdf_completed_read_mismatch' then raise;end if;end;raise exception 'TEST_RESTORE_LABEL';exception when raise_exception then if sqlerrm<>'TEST_RESTORE_LABEL' then raise;end if;end;end $$;`,
    );
    if (issued.predecessorGenerationId)
      statements.push(
        `do $$ declare expected jsonb;actual jsonb;expected_labels jsonb;actual_labels jsonb;begin select summary-array['id','document_id','owner_id','created_at','updated_at'] into expected from prior_shared_state;select coalesce(jsonb_agg(value-array['id','document_id','owner_id','created_at','updated_at'] order by value->>'label_type',value->>'label'),'[]') into expected_labels from prior_shared_state,jsonb_array_elements(labels) where value->>'source'='generated';select summary,labels into actual,actual_labels from public.document_index_generation_snapshots where document_id='${job.document_id}' and index_generation_id='${issued.predecessorGenerationId}';if actual is distinct from expected or actual_labels is distinct from expected_labels then raise exception 'TEST_PREDECESSOR_SUMMARY_OR_LABEL_SNAPSHOT_LOST';end if;end $$;`,
      );
  }
  const firstImage = packet.rows.images[0];
  if (firstImage)
    statements.push(
      `select public.read_managed_pdf_image('${firstImage.id}','${job.document_id}','${issued.generationId}');`,
    );
  statements.push(
    `do $$ begin if (select owner_id from public.documents where id='${job.document_id}')is not null or (select metadata->'public_corpus' from public.documents where id='${job.document_id}')is distinct from 'true'::jsonb or (select index_generation_id from public.documents where id='${job.document_id}')is distinct from '${issued.generationId}'::uuid then raise exception 'TEST_SHARED_SCOPE_OR_ACTIVATION_LOST';end if;end $$;`,
  );
  statements.push(
    `do $$ declare legacy_job uuid;legacy_claim jsonb;legacy_fence jsonb;begin begin insert into public.ingestion_jobs(document_id,status,stage,progress,max_attempts) values('${job.document_id}','pending','synthetic legacy queue without fresh action',0,1)returning id into legacy_job;select claim_row into strict legacy_claim from public.claim_ingestion_jobs('rich-legacy-reuse-negative',1,45)claim_row where claim_row->>'id'=legacy_job::text;legacy_fence:=jsonb_build_object('job_kind','node','job_id',legacy_claim->'id','document_id',legacy_claim->'document_id','worker_id',legacy_claim->'locked_by','lease_token',legacy_claim->'lease_token','expected_generation_id',legacy_claim->'lease_expected_generation_id','authority_digest',legacy_claim->'lease_authority_digest');begin perform public.read_administrator_reindex_authority(legacy_fence,(legacy_claim->>'lease_write_generation_id')::uuid);raise exception 'TEST_OLD_ADMISSION_REUSED';exception when raise_exception then if sqlerrm<>'readmission_authority_identity_mismatch'then raise;end if;end;raise exception 'TEST_RESTORE_LEGACY_QUEUE_FIXTURE';exception when raise_exception then if sqlerrm<>'TEST_RESTORE_LEGACY_QUEUE_FIXTURE'then raise;end if;end;end $$;`,
  );
  if (process.argv.includes("--lifecycle-check"))
    statements.push(
      `do $$ begin begin delete from ingestion_generation_evidence.full_pdf_stages where document_id='${job.document_id}';raise exception 'TEST_DIRECT_STAGE_DELETE_ALLOWED';exception when check_violation then null;end;begin delete from public.documents where id='${job.document_id}';if exists(select 1 from ingestion_generation_evidence.full_pdf_stages where document_id='${job.document_id}')then raise exception 'TEST_STAGE_ORPHANED';end if;raise exception 'TEST_RESTORE_LIFECYCLE_FIXTURE';exception when raise_exception then if sqlerrm<>'TEST_RESTORE_LIFECYCLE_FIXTURE'then raise;end if;end;end $$;`,
    );
  statements.push(process.argv.includes("--commit-success") ? "commit;" : "rollback;");
  process.stdout.write(statements.join("\n") + "\n");
}
async function main() {
  if (process.argv.includes("--seed")) await seed(arg("--fixture"));
  else if (process.argv.includes("--stage")) await stage(arg("--fixture"), arg("--claim"));
  else if (process.argv.includes("--reclaim")) {
    const saved = JSON.parse(await readFile(arg("--fixture"), "utf8")) as Saved;
    const bytes = Buffer.from(saved.originalHex, "hex");
    const sourceSha = bytesDigest(bytes),
      fileHash = bytesDigest(Buffer.from("synthetic-rendered.pdf")),
      pathHash = bytesDigest(Buffer.from("legacy-originals/synthetic-rendered.pdf"));
    const claims = {
      sub: ids[5],
      role: "authenticated",
      aal: "aal2",
      app_metadata: { site_role: "administrator" },
      amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }],
    };
    process.stdout.write(
      `do $$ begin perform set_config('request.jwt.claims',${sqlJson(claims)}::text,false);perform set_config('request.jwt.claim.sub','${ids[5]}',false);perform set_config('request.jwt.claim.role','authenticated',false);perform public.readmit_administrator_document_for_reindex('${ids[0]}',gen_random_uuid(),null,true,'${sourceSha}',${bytes.length},'${fileHash}','${pathHash}',${sqlJson(authority)},1);end $$;\nselect j from public.claim_ingestion_jobs('rendered-pdf-scratch',1,45)j;\n`,
    );
  } else throw new Error("fixture_mode_required");
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
