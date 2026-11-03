/** Synthetic scratch-only SQL generator; never connects to any database. */
import { execFileSync } from "node:child_process";
import { readFile, writeFile, rm } from "node:fs/promises";
import { resolvePythonBin } from "../../src/lib/python-bin";
import {
  bytesDigest,
  generationEvidenceBytes,
  parseIssuedAttemptControl,
} from "../../src/lib/ingestion-generation-evidence";
import {
  buildGenerationRetentionPacket,
  attachAttemptControlEvidence,
  attachPrerequisiteQualityDiagnostic,
} from "../../worker/generation-evidence";
import {
  buildInternalRichPdfExpectation,
  prepareManagedFullPdfGeneration,
} from "../../worker/managed-full-pdf-terminal";
import { inspectRichPdfBytes } from "../../worker/rich-pdf-inspection-producer";
import type { RichPdfInspectionResult } from "../../worker/rich-pdf-inspection";
import type { JobRow } from "../../worker/types";
import { prepareAdministratorDocumentReadmission } from "../../src/lib/admin-document-readmission";
const ids = Array.from({ length: 6 }, (_, i) => `73000000-0000-4000-8000-00000000000${i + 1}`);
const sqlJson = (value: unknown) => "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
function arg(name: string) {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1] || process.argv[i + 1].startsWith("--"))
    throw new Error(`fixture_requires_${name}`);
  return process.argv[i + 1];
}
type Saved = { originalHex: string; result: RichPdfInspectionResult };
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
d=f.open();p=d.new_page();p.insert_text((72,72),'SYNTHETIC THRESHOLD AND ACTION REFERENCE',fontsize=14)
for x in (40,240,460):p.draw_line((x,100),(x,220))
for y in (100,140,180,220):p.draw_line((40,y),(460,y))
for y,cells in ((125,('Threshold','Action')),(165,('< 3.5','HOLD EXAMPLE')),(205,('> 3.5','REVIEW EXAMPLE'))):
 for x,t in zip((50,250),cells):p.insert_text((x,y),t,fontsize=12)
p=d.new_page();p.insert_text((72,72),'SYNTHETIC SOURCE FIGURE. Preserve all original visual evidence.',fontsize=13);p.draw_rect(f.Rect(72,140,280,240),fill=(.4,.7,.3))
s=f.open();p=s.new_page();p.insert_text((72,72),'SCAN ONLY SYNTHETIC SOURCE. Monitor example threshold and review.',fontsize=14);pix=p.get_pixmap(dpi=180);p=d.new_page();p.insert_image(p.rect,pixmap=pix)
sys.stdout.buffer.write(d.tobytes())`,
    ],
    { maxBuffer: 32 * 1024 * 1024 },
  );
}
async function seed(path: string) {
  const bytes = original();
  const sha = `sha256:${bytesDigest(bytes).slice(7)}` as const;
  const result = await inspectRichPdfBytes(
    bytes,
    {
      documentId: ids[0],
      generationId: ids[1],
      jobId: ids[2],
      leaseId: ids[3],
      admissionEventId: ids[4],
      attemptId: "synthetic",
      contentSha256: sha,
      authorityDigest: sha,
    },
    { timeoutMs: 120000 },
  );
  try {
    await writeFile(path, JSON.stringify({ originalHex: bytes.toString("hex"), result }));
  } finally {
    await Promise.all((result.extracted.temporaryPaths ?? []).map((d) => rm(d, { recursive: true, force: true })));
  }
  const doc = {
    id: ids[0],
    owner_id: null,
    file_name: "synthetic-rich.pdf",
    storage_path: "legacy-originals/synthetic-rich.pdf",
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
    `-- SCRATCH-ONLY historical shared-row fixture, not a publication operation.\nbegin;\ninsert into auth.users(id,raw_app_meta_data)values('${ids[5]}','{"site_role":"administrator"}'::jsonb) on conflict(id) do nothing;\nset local session_replication_role=replica;\ninsert into public.documents(id,owner_id,title,file_name,file_type,file_size,storage_path,content_hash,status,metadata)values('${ids[0]}',null,'Synthetic existing shared reference','${doc.file_name}','application/pdf',${doc.file_size},'${doc.storage_path}','${doc.content_hash}','indexed','{"public_corpus":true}'::jsonb);\nset local session_replication_role=origin;\ncommit;\ndo $$ begin perform set_config('request.jwt.claims',${sqlJson(claims)}::text,false);perform set_config('request.jwt.claim.sub','${ids[5]}',false);perform set_config('request.jwt.claim.role','authenticated',false);perform ${admissionCall};end $$;\nselect j from public.claim_ingestion_jobs('rich-pdf-scratch',1,45)j;\n`,
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
  const review = {
    ...saved.result.review,
    binding: {
      ...saved.result.review.binding,
      admissionEventId: job.documents.metadata.admission_event_id as string,
      documentId: job.document_id,
      generationId: issued.generationId,
      jobId: job.id,
      leaseId: job.lease_token,
      attemptId: `${job.id}:${job.attempt_count}:${job.lease_token}`,
      authorityDigest: saved.result.review.binding.authorityDigest,
    },
    inspectedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };
  review.binding.authorityDigest = job.lease_authority_digest as typeof review.binding.authorityDigest;
  const expectation = buildInternalRichPdfExpectation(originalBytes, review);
  const { extracted, capturedImages } = saved.result;
  const base = buildGenerationRetentionPacket({
    documentId: job.document_id,
    generationId: issued.generationId,
    originalBytes,
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
  const plan = prepareManagedFullPdfGeneration({
    job,
    issued,
    retentionPacket,
    originalBytes,
    review,
    extracted,
    capturedImages,
    stewardId: ids[5],
  });
  const packet = JSON.parse(generationEvidenceBytes(plan.packet).toString("utf8")) as typeof plan.packet;
  for (const u of plan.embeddingUnits) {
    const r = packet.rows[u.family].find((r) => r.id === u.id);
    if (!r) throw new Error("fixture_row_missing");
    r.embedding = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
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
  const statements = [
    "begin;",
    `create temp table prior_shared_state on commit drop as select to_jsonb(d) as document,(select coalesce(jsonb_agg(to_jsonb(c)order by id),'[]')from public.document_chunks c where document_id=d.id and index_generation_id is not distinct from d.index_generation_id) as chunks from public.documents d where d.id='${job.document_id}';`,
  ];
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
    `do $$ begin begin perform public.stage_managed_full_pdf(${sqlJson(fence)},'${issued.generationId}',${sqlJson(partial)});raise exception 'TEST_EXPECTED_PARTIAL_REFUSAL';exception when raise_exception then if sqlerrm not like 'managed_full_pdf_%' then raise;end if;end;${priorCheck}end $$;`,
  );
  call("stage_managed_full_pdf", { p_generation: issued.generationId, p_packet: packet });
  const digest = `(select packet_digest from ingestion_generation_evidence.full_pdf_stages where document_id='${job.document_id}' and generation_id='${issued.generationId}')`;
  statements.push(
    `do $$ begin begin perform public.complete_managed_full_pdf(${sqlJson({ ...fence, lease_token: ids[5] })},'${issued.generationId}',${digest},false);raise exception 'TEST_EXPECTED_STALE_REFUSAL';exception when raise_exception then if sqlerrm not like 'managed_full_pdf_%' then raise;end if;end;${priorCheck}end $$;`,
  );
  statements.push(
    `select public.complete_managed_full_pdf(${sqlJson(fence)},'${issued.generationId}',${digest},false);`,
  );
  statements.push(
    `select public.complete_managed_full_pdf(${sqlJson(fence)},'${issued.generationId}',${digest},true);`,
  );
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
      fileHash = bytesDigest(Buffer.from("synthetic-rich.pdf")),
      pathHash = bytesDigest(Buffer.from("legacy-originals/synthetic-rich.pdf"));
    const claims = {
      sub: ids[5],
      role: "authenticated",
      aal: "aal2",
      app_metadata: { site_role: "administrator" },
      amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }],
    };
    process.stdout.write(
      `do $$ begin perform set_config('request.jwt.claims',${sqlJson(claims)}::text,false);perform set_config('request.jwt.claim.sub','${ids[5]}',false);perform set_config('request.jwt.claim.role','authenticated',false);perform public.readmit_administrator_document_for_reindex('${ids[0]}',gen_random_uuid(),null,true,'${sourceSha}',${bytes.length},'${fileHash}','${pathHash}',${sqlJson(authority)},1);end $$;\nselect j from public.claim_ingestion_jobs('rich-pdf-scratch',1,45)j;\n`,
    );
  } else throw new Error("fixture_mode_required");
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
