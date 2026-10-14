/**
 * Retirement guard for the dormant `ingestion-worker` Edge Function (audit L24).
 *
 * This function is still deployable (`[functions.ingestion-worker] verify_jwt =
 * true` in supabase/config.toml) and `public.invoke_ingestion_worker(integer)`
 * is a live SECURITY DEFINER RPC that POSTs to it. It claims real rows from the
 * same `claim_ingestion_jobs` queue the container worker uses, but it performs
 * NO extraction: it reads existing chunks, builds a heuristic summary, and
 * embeds title/summary with a 384-dimension model whose output cannot be
 * inserted into `vector(1536)`. Every claimed job therefore lands in the catch,
 * where `fail_or_retry_ingestion_job` is called with a hardcoded `indexed`
 * document status — so a newly uploaded guideline can be stamped `indexed` with
 * nothing retrievable, while the container worker's retry budget for that
 * document is spent on a path that cannot succeed.
 *
 * Until the function and its RPC are removed by a migration (out of scope for
 * this change — this ships no SQL), the endpoint refuses every request with 410
 * BEFORE it touches the queue. That is the whole guard: no claim, no lease, no
 * status stamp, so it cannot mark a never-extracted document as indexed.
 */
export const INGESTION_WORKER_RETIRED: boolean = true;

export const INGESTION_WORKER_RETIREMENT_MESSAGE =
  "The ingestion-worker Edge Function is retired. It performs no extraction, so it must not " +
  "claim ingestion jobs or stamp document status. The container worker owns ingestion.";

export function retiredIngestionWorkerResponse(): Response {
  return Response.json(
    { ok: false, code: "ingestion_worker_retired", error: INGESTION_WORKER_RETIREMENT_MESSAGE },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
