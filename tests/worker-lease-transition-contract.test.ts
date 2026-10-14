import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { decodeJobTransitionResult, isMissingFunctionError } from "../worker/job-transitions";
import { sourceSegment } from "./helpers/source-contract";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerSource = readFileSync(path.join(repoRoot, "worker", "main.ts"), "utf8");
const schemaSource = readFileSync(path.join(repoRoot, "supabase", "schema.sql"), "utf8");
const behaviorSource = readFileSync(path.join(repoRoot, "worker", "behavior.ts"), "utf8");

describe("decodeJobTransitionResult", () => {
  it("commits only on an explicit ok:true", () => {
    expect(decodeJobTransitionResult({ ok: true, job_id: "j", document_id: "d" })).toEqual({ kind: "committed" });
    // PostgREST hands a single-row SETOF back as a one-element array.
    expect(decodeJobTransitionResult([{ ok: true }])).toEqual({ kind: "committed" });
  });

  it("reads an explicit ok:false as lease loss, not as failure", () => {
    // The reclaiming worker owns the outcome; this one must stand down quietly.
    expect(decodeJobTransitionResult({ ok: false, reason: "lease_lost" })).toEqual({ kind: "lease_lost" });
  });

  it("refuses to read a missing or shapeless payload as success", () => {
    // This is the defect. `(data as {ok?: boolean} | null)?.ok === false` asks only
    // "did it explicitly say no", so every one of these fell through as a commit
    // and the worker invalidated caches for a transaction it never confirmed.
    expect(decodeJobTransitionResult(null)).toEqual({ kind: "undecided", reason: "missing_result" });
    expect(decodeJobTransitionResult(undefined)).toEqual({ kind: "undecided", reason: "missing_result" });
    expect(decodeJobTransitionResult([])).toEqual({ kind: "undecided", reason: "missing_result" });
    expect(decodeJobTransitionResult({})).toEqual({ kind: "undecided", reason: "malformed_result" });
    expect(decodeJobTransitionResult({ ok: "true" })).toEqual({ kind: "undecided", reason: "malformed_result" });
    expect(decodeJobTransitionResult({ ok: 1 })).toEqual({ kind: "undecided", reason: "malformed_result" });
    expect(decodeJobTransitionResult("ok")).toEqual({ kind: "undecided", reason: "malformed_result" });
    expect(decodeJobTransitionResult(0)).toEqual({ kind: "undecided", reason: "malformed_result" });
  });

  it("matches the shape the RPCs actually return", () => {
    // Both functions build their reply with jsonb_build_object on every return
    // path, so `ok` is always present. That is what makes its absence meaningful.
    const complete = sourceSegment(
      schemaSource,
      "create or replace function public.complete_ingestion_job(p_fence jsonb, p_batch_id uuid, p_stage text)",
      "$$;",
      { label: "fenced complete_ingestion_job body" },
    );
    expect(complete).toMatch(/'ok',\s*false,\s*'reason',\s*'lease_lost'/);
    expect(complete).toMatch(/'ok',\s*true/);
    expect(complete).toContain(
      "public.assert_current_ingestion_attempt(p_fence, (p_fence->>'expected_generation_id')::uuid)",
    );
    expect(complete).toContain("locked_by=p_fence->>'worker_id'");
    expect(complete).toContain("lease_token=(p_fence->>'lease_token')::uuid and status='processing'");
    expect(complete).toContain(
      "lease_expected_generation_id is not distinct from (p_fence->>'expected_generation_id')::uuid",
    );
    expect(complete).toContain("lease_authority_digest=p_fence->>'authority_digest'");
    expect(complete).toContain("lease_expires_at > pg_catalog.clock_timestamp()");
    expect(complete).toContain("security definer set search_path = ''");
    expect(schemaSource).toContain(
      "revoke all on function public.complete_ingestion_job(jsonb, uuid, text) from public,anon,authenticated;",
    );
    expect(schemaSource).toContain(
      "grant execute on function public.complete_ingestion_job(jsonb, uuid, text) to service_role;",
    );
    expect(schemaSource).toContain(
      "revoke all on function public.complete_ingestion_job(uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;",
    );
  });
});

describe("isMissingFunctionError", () => {
  it("recognises only the function-not-found contract", () => {
    expect(isMissingFunctionError({ code: "PGRST202" })).toBe(true);
    expect(isMissingFunctionError({ message: "Could not find the function public.foo(bar)" })).toBe(true);
  });

  it("no longer matches unrelated PostgREST schema-cache errors", () => {
    // The old predicate was /could not find the function|schema cache|PGRST20\d/i.
    // A missing COLUMN (PGRST204), an ambiguous overload (PGRST203) and a missing
    // relationship (PGRST200) all mean the call was wrong — not that the function
    // is absent — and each one selected the legacy unfenced write path.
    expect(
      isMissingFunctionError({ code: "PGRST204", message: "Could not find the 'x' column in the schema cache" }),
    ).toBe(false);
    expect(isMissingFunctionError({ code: "PGRST203", message: "Could not choose the best candidate function" })).toBe(
      false,
    );
    expect(
      isMissingFunctionError({ code: "PGRST200", message: "Could not find a relationship in the schema cache" }),
    ).toBe(false);
    expect(isMissingFunctionError({ message: "could not connect to server" })).toBe(false);
    expect(isMissingFunctionError(null)).toBe(false);
  });
});

describe("worker job transitions have no unfenced fallback", () => {
  const completeJob = sourceSegment(
    workerSource,
    "async function completeJob(",
    "async function completeStrictEnrichmentJob(",
    { label: "completeJob" },
  );
  const failOrRetry = sourceSegment(workerSource, "async function failOrRetryJob(", "function workerBackoffMs(", {
    label: "failOrRetryJob",
  });
  const mutationAdapter = sourceSegment(workerSource, "const mutation = (attempt:", "async function updateJob(", {
    label: "worker mutation adapter",
  });
  const fencedMutation = sourceSegment(
    behaviorSource,
    "export async function runIngestionMutation(",
    "export function claimedJobFence(",
    { label: "shared fenced mutation" },
  );

  it("completeJob refuses to reconstruct the transaction client-side", () => {
    // The removed fallback nulled locked_by on an `.eq("id", job.id)` match, then
    // superseded siblings, refreshed the batch and invalidated caches without ever
    // checking that a row had changed.
    expect(completeJob).not.toContain('.from("ingestion_jobs")');
    expect(completeJob).not.toContain("markSupersededSiblingJobs");
    expect(completeJob).toContain('await mutation(attemptForJob(job.id), "complete_ingestion_job",');
    expect(completeJob).toMatch(/await mutation\([\s\S]*?\);\s*invalidateRagCachesForDocumentMutation/);
    expect(mutationAdapter).toContain(
      "runIngestionMutation(attempt, (rpcName, payload) => ingestionRpcClient.rpc(rpcName, payload), name, args)",
    );
    expect(fencedMutation).toContain("p_fence: attempt.fence");
    expect(fencedMutation).toContain("if (result.error) throw new Error(result.error.message)");
    expect(fencedMutation).toContain("attempt.accept(result.data)");
    expect(fencedMutation).toMatch(/catch \(error\) \{\s*attempt\.cancel\(\);\s*throw error;/);
  });

  it("failOrRetryJob refuses to demote a document it may no longer own", () => {
    // updateDocument filters by owner_id — an ownership check, not a lease check —
    // and updateJob filtered by id alone.
    const body = failOrRetry;
    expect(body).not.toContain("await updateDocument(");
    expect(body).not.toContain("await updateJob(");
    expect(body).toContain('await mutation(attemptForJob(args.job.id), "fail_or_retry_ingestion_job",');
    expect(body).not.toContain('.from("ingestion_jobs")');
    expect(fencedMutation).toContain(
      'if (name === "complete_ingestion_job" || name === "fail_or_retry_ingestion_job") attempt.cancel()',
    );
  });

  it("keeps the client-side sibling supersession deleted", () => {
    // complete_ingestion_job supersedes siblings inside its own transaction; the
    // TypeScript copy existed only to serve the fallback that is now gone.
    expect(workerSource).not.toContain("markSupersededSiblingJobs");
    expect(schemaSource).toContain("'superseded by successful index'");
  });

  it("still lets the lease-recovery path own an abandoned job", () => {
    // Failing closed is only safe because something reclaims the job afterwards.
    expect(workerSource).toContain("WORKER_STALE_AFTER_MINUTES");
  });
});
