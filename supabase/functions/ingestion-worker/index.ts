import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";

import { hasServiceRoleAuthorization } from "./auth.ts";
import { INGESTION_WORKER_RETIRED, retiredIngestionWorkerResponse } from "./retirement.ts";

declare const Supabase: {
  ai: {
    Session: new (model: string) => {
      run(input: string, options: { mean_pool: boolean; normalize: boolean }): Promise<unknown>;
    };
  };
};

type ClaimedJob = {
  id: string;
  document_id: string;
  batch_id: string | null;
  attempt_count: number;
  max_attempts: number;
  documents: {
    id: string;
    owner_id: string | null;
    title: string | null;
    metadata: Record<string, unknown> | null;
  };
};

type IngestionRpcResult = {
  ok?: boolean;
  reason?: string;
};

function isLeaseLost(result: IngestionRpcResult | null | undefined): boolean {
  return result?.ok === false && result.reason === "lease_lost";
}

const SUPABASE_DB_URL = Deno.env.get("SUPABASE_DB_URL");
if (!SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL is required");

const sql = postgres(SUPABASE_DB_URL, {
  max: 3,
  idle_timeout: 20,
  connect_timeout: 10,
});

const embeddingModel = new Supabase.ai.Session("gte-small");

function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function generateEmbedding(text: string): Promise<number[]> {
  const vector = await embeddingModel.run(text, { mean_pool: true, normalize: true });
  if (!Array.isArray(vector)) throw new Error("Embedding model returned non-array output");
  return vector as number[];
}

async function buildSummary(documentId: string): Promise<{ summary: string; sourceChunkIds: string[] }> {
  const chunks = await sql<
    {
      id: string;
      content: string;
      chunk_index: number;
    }[]
  >`
    select id, content, chunk_index
    from public.document_chunks
    where document_id = ${documentId}::uuid
    order by chunk_index asc
    limit 8
  `;

  if (chunks.length === 0) {
    return {
      summary: "No chunk content available for this document yet.",
      sourceChunkIds: [],
    };
  }

  const merged = normalizeText(chunks.map((c) => c.content ?? "").join(" "));
  const summary = merged.length > 1600 ? `${merged.slice(0, 1600)}...` : merged;

  return {
    summary,
    sourceChunkIds: chunks.map((c) => c.id),
  };
}

async function upsertDocumentSummary(job: ClaimedJob): Promise<string> {
  const docId = job.document_id;
  const ownerId = job.documents.owner_id;

  const existing = await sql<{ id: string }[]>`
    select id
    from public.document_summaries
    where document_id = ${docId}::uuid
    limit 1
  `;

  if (existing.length > 0) {
    const row = await sql<{ summary: string | null }[]>`
      select summary
      from public.document_summaries
      where document_id = ${docId}::uuid
      limit 1
    `;

    return normalizeText(row[0]?.summary ?? "");
  }

  const { summary, sourceChunkIds } = await buildSummary(docId);

  await sql`
    insert into public.document_summaries (
      document_id,
      owner_id,
      summary,
      source_chunk_ids,
      model,
      metadata,
      generated_at
    ) values (
      ${docId}::uuid,
      ${ownerId}::uuid,
      ${summary},
      ${sourceChunkIds}::uuid[],
      ${"gte-small-heuristic-summary-v1"},
      ${JSON.stringify({ generated_by: "ingestion-worker", mode: "backfill" })}::jsonb,
      now()
    )
    on conflict (document_id)
    do update set
      summary = excluded.summary,
      source_chunk_ids = excluded.source_chunk_ids,
      model = excluded.model,
      metadata = excluded.metadata,
      generated_at = now(),
      updated_at = now()
  `;

  return summary;
}

async function upsertEmbeddingFields(job: ClaimedJob, summaryText: string): Promise<void> {
  const docId = job.document_id;
  const ownerId = job.documents.owner_id;
  const title = normalizeText(job.documents.title ?? "");
  const summary = normalizeText(summaryText);

  const entries = [
    { fieldType: "document_title", content: title.length > 0 ? title : "Untitled document" },
    { fieldType: "document_summary", content: summary.length > 0 ? summary : "Summary unavailable" },
  ];

  const prepared = await Promise.all(
    entries.map(async (entry) => ({
      ...entry,
      embedding: await generateEmbedding(entry.content),
      contentHash: await sha256Hex(entry.content),
    })),
  );

  await sql.begin(async (tx) => {
    await tx`
      delete from public.document_embedding_fields
      where document_id = ${docId}::uuid
        and field_type = any(${entries.map((entry) => entry.fieldType)}::text[])
    `;

    for (const entry of prepared) {
      await tx`
        insert into public.document_embedding_fields (
          owner_id,
          document_id,
          source_chunk_id,
          field_type,
          content,
          embedding,
          metadata,
          content_hash
        ) values (
          ${ownerId}::uuid,
          ${docId}::uuid,
          null,
          ${entry.fieldType},
          ${entry.content},
          ${JSON.stringify(entry.embedding)}::vector,
          ${JSON.stringify({ generated_by: "ingestion-worker", mode: "backfill" })}::jsonb,
          ${entry.contentHash}
        )
      `;
    }
  });
}

async function markEnrichmentMetadata(documentId: string): Promise<void> {
  await sql`
    update public.documents
    set
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'enrichment_status', 'completed',
          'rag_enrichment_updated_at', now()
        ),
      updated_at = now()
    where id = ${documentId}::uuid
  `;
}

async function completeIngestionJob(job: ClaimedJob, workerId: string): Promise<IngestionRpcResult | null> {
  const [row] = await sql<Array<{ complete_ingestion_job: IngestionRpcResult }>>`
    select public.complete_ingestion_job(
      ${job.id}::uuid,
      ${job.document_id}::uuid,
      ${job.batch_id}::uuid,
      ${"indexed + enrichment backfill"},
      ${workerId}
    )
  `;
  return row?.complete_ingestion_job ?? null;
}

async function failOrRetryIngestionJob(
  job: ClaimedJob,
  workerId: string,
  shouldRetry: boolean,
  message: string,
): Promise<IngestionRpcResult | null> {
  const [row] = await sql<Array<{ fail_or_retry_ingestion_job: IngestionRpcResult }>>`
    select public.fail_or_retry_ingestion_job(
      ${job.id}::uuid,
      ${job.document_id}::uuid,
      ${job.batch_id}::uuid,
      ${shouldRetry},
      ${"indexed"},
      ${"enrichment backfill failed"},
      ${message},
      ${new Date(Date.now() + 60_000).toISOString()}::timestamptz,
      ${workerId}
    )
  `;
  return row?.fail_or_retry_ingestion_job ?? null;
}

async function processJob(job: ClaimedJob, workerId: string): Promise<"completed" | "lease_lost"> {
  const summary = await upsertDocumentSummary(job);
  await upsertEmbeddingFields(job, summary);
  await markEnrichmentMetadata(job.document_id);

  const completion = await completeIngestionJob(job, workerId);
  if (isLeaseLost(completion)) return "lease_lost";
  if (!completion || completion.ok === false) {
    throw new Error(`complete_ingestion_job did not confirm success: ${completion?.reason ?? "no result row"}`);
  }
  return "completed";
}

Deno.serve(async (req: Request) => {
  try {
    // Audit L24: this function performs no extraction, yet claims real jobs from
    // the shared queue and stamps documents `indexed` on its way through the
    // catch. Refuse before touching the queue; see ./retirement.ts.
    if (INGESTION_WORKER_RETIRED) return retiredIngestionWorkerResponse();

    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
    }
    if (!hasServiceRoleAuthorization(req.headers.get("authorization"))) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const limitRaw = url.searchParams.get("limit") ?? "10";
    const limit = Number.isFinite(Number(limitRaw)) ? Math.max(1, Math.min(50, Math.trunc(Number(limitRaw)))) : 10;
    const workerId = `edge-ingestion-worker-${crypto.randomUUID()}`;

    const claimed = await sql<ClaimedJob[]>`
      select *
      from public.claim_ingestion_jobs(${workerId}, ${limit}, 45)
    `;

    if (claimed.length === 0) {
      return Response.json({ ok: true, claimed: 0, processed: 0, failed: 0 });
    }

    let processed = 0;
    let failed = 0;
    let leaseLost = 0;
    const failures: Array<{ job_id: string; document_id: string; error: string }> = [];

    for (const job of claimed) {
      try {
        const outcome = await processJob(job, workerId);
        if (outcome === "lease_lost") {
          leaseLost += 1;
          continue;
        }
        processed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : JSON.stringify(error);
        const shouldRetry = job.attempt_count < job.max_attempts;
        const failure = await failOrRetryIngestionJob(job, workerId, shouldRetry, message);

        if (isLeaseLost(failure)) {
          leaseLost += 1;
          continue;
        }

        failed += 1;
        failures.push({ job_id: job.id, document_id: job.document_id, error: message });
      }
    }

    return Response.json({
      ok: true,
      claimed: claimed.length,
      processed,
      failed,
      lease_lost: leaseLost,
      failures,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
});
