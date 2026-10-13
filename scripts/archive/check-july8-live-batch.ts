import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { isDirectEntrypoint } from "../lib/is-entrypoint.mjs";

loadEnvConfig(process.cwd());

const R17_INDEX = "ingestion_jobs_one_open_per_document_uidx";
export const R17_PROBE_STAGE = "july8-live-batch-probe";
const LEGACY_R17_PROBE_JOB_IDS = [
  "00000000-0000-0000-0000-000000000097",
  "00000000-0000-0000-0000-000000000096",
] as const;
const PROBE_JOB_ID = "00000000-0000-0000-0000-000000000099";
const PROBE_DOC_ID = "00000000-0000-0000-0000-000000000098";

type DriftIndex = {
  name?: unknown;
  def?: unknown;
};

type DriftSnapshot = {
  indexes?: DriftIndex[];
};

export function normalizeIndexDef(def: string) {
  return def.replace(/\s+/g, " ").trim().toLowerCase();
}

export function isExpectedR17IndexDef(def: string) {
  const normalized = normalizeIndexDef(def);
  if (!normalized.includes("create unique index")) return false;
  if (!normalized.includes("ingestion_jobs")) return false;
  if (!normalized.includes("(document_id)")) return false;

  const whereIdx = normalized.indexOf(" where ");
  if (whereIdx === -1) return false;
  const whereClause = normalized.slice(whereIdx + " where ".length);

  // Reject broader predicates that block reindex behind a stale failed job.
  for (const status of ["failed", "completed", "cancelled", "queued", "indexed"]) {
    if (whereClause.includes(status)) return false;
  }

  let statuses: string[] = [];
  const inMatch = whereClause.match(/status\s+in\s*\(([^)]+)\)/);
  const anyMatch = whereClause.match(/status\s*=\s*any\s*\(\s*(?:array\s*)?\[([^\]]+)\]/);

  if (inMatch) {
    statuses = inMatch[1].split(",").map((value) =>
      value
        .split("::")[0]
        .trim()
        .replace(/^['"]|['"]$/g, ""),
    );
  } else if (anyMatch) {
    statuses = anyMatch[1].split(",").map((value) =>
      value
        .split("::")[0]
        .trim()
        .replace(/^['"]|['"]$/g, ""),
    );
  } else {
    return false;
  }

  statuses = statuses.sort();
  return statuses.length === 2 && statuses[0] === "pending" && statuses[1] === "processing";
}

export function isR17IndexUniqueViolation(error: { code?: string | null; message: string }) {
  if (error.code !== "23505") return false;
  const message = error.message.toLowerCase();
  return message.includes(R17_INDEX) || message.includes("one_open_per_document");
}

type AdminClient = ReturnType<Awaited<typeof import("@/lib/supabase/admin")>["createAdminClient"]>;

function isSignatureError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("could not find the function") ||
    lower.includes("does not exist") ||
    lower.includes("unknown argument") ||
    lower.includes("not found in the schema cache")
  );
}

async function checkFailClosedRetrieval(supabase: AdminClient) {
  const { data, error } = await supabase.rpc(
    "retrieval_owner_matches" as never,
    {
      owner_filter: null,
      row_owner_id: PROBE_DOC_ID,
    } as never,
  );

  if (error) {
    throw new Error(`retrieval_owner_matches probe failed: ${error.message}`);
  }

  if (data === true) {
    throw new Error(
      "retrieval_owner_matches still fail-OPEN on NULL owner_filter — apply 20260708160001_retrieval_owner_matches_fail_closed.sql",
    );
  }

  if (data !== false) {
    throw new Error(`retrieval_owner_matches returned unexpected value: ${String(data)}`);
  }

  console.log("[July8 Live Batch] PASS: retrieval_owner_matches is fail-closed on NULL.");
}

async function checkJsonbMergeDeep(supabase: AdminClient) {
  const { data, error } = await supabase.rpc(
    "jsonb_merge_deep" as never,
    {
      target_obj: { a: 1, nested: { keep: true } },
      patch_obj: { b: 2, nested: { add: "x" } },
    } as never,
  );

  if (error) {
    if (isSignatureError(error.message)) {
      throw new Error("jsonb_merge_deep RPC missing — apply 20260708310000_r5_document_metadata_merge.sql");
    }
    throw new Error(`jsonb_merge_deep probe failed: ${error.message}`);
  }

  const merged = data as { a?: number; b?: number; nested?: { keep?: boolean; add?: string } } | null;
  if (merged?.a !== 1 || merged?.b !== 2 || merged?.nested?.keep !== true || merged?.nested?.add !== "x") {
    throw new Error("jsonb_merge_deep returned an unexpected merge result.");
  }

  console.log("[July8 Live Batch] PASS: jsonb_merge_deep is live.");
}

async function checkWorkerLeaseFence(supabase: AdminClient) {
  const { data, error } = await supabase.rpc("complete_ingestion_job", {
    p_job_id: PROBE_JOB_ID,
    p_document_id: PROBE_DOC_ID,
    p_stage: "indexed",
    p_worker_id: "july8-live-batch-probe",
  });

  if (error) {
    if (isSignatureError(error.message)) {
      throw new Error(
        "complete_ingestion_job does not accept p_worker_id — apply 20260708130000_ingestion_concurrency_rpc_hardening.sql before redeploying the worker",
      );
    }
    throw new Error(`complete_ingestion_job probe failed: ${error.message}`);
  }

  const payload = data as { ok?: boolean; reason?: string } | null;
  if (payload?.ok !== false) {
    throw new Error(
      `complete_ingestion_job probe expected ok:false for a missing job, got: ${JSON.stringify(payload)}`,
    );
  }

  console.log("[July8 Live Batch] PASS: complete_ingestion_job accepts p_worker_id lease fence.");
}

async function deleteR17ProbeJobIds(supabase: AdminClient, ids: readonly string[], context: string) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return;
  }

  const { error } = await supabase.from("ingestion_jobs").delete().in("id", uniqueIds);
  if (error) {
    throw new Error(`R17 probe: ${context} cleanup failed: ${error.message}`);
  }
}

async function sweepStrandedR17ProbeRows(supabase: AdminClient) {
  const { error } = await supabase
    .from("ingestion_jobs")
    .delete()
    .eq("stage", R17_PROBE_STAGE)
    .in("status", ["pending", "processing"]);
  if (error) {
    throw new Error(`R17 probe: could not sweep stranded probe rows: ${error.message}`);
  }
}

async function assertNoStrandedR17ProbeRows(supabase: AdminClient) {
  const { data, error } = await supabase
    .from("ingestion_jobs")
    .select("id")
    .eq("stage", R17_PROBE_STAGE)
    .in("status", ["pending", "processing"])
    .limit(1);
  if (error) {
    throw new Error(`R17 probe: could not verify probe cleanup: ${error.message}`);
  }
  if (data?.length) {
    throw new Error(`R17 probe: stranded probe job ${data[0]?.id} remains after cleanup — manual delete required`);
  }
}

async function prepareR17ProbeCleanup(supabase: AdminClient) {
  await deleteR17ProbeJobIds(supabase, LEGACY_R17_PROBE_JOB_IDS, "legacy");
  await sweepStrandedR17ProbeRows(supabase);
}

async function findR17ProbeDocument(supabase: AdminClient) {
  const pageSize = 100;
  let page = 0;

  while (true) {
    const from = page * pageSize;
    const to = from + pageSize - 1;

    const { data: docs, error } = await supabase.from("documents").select("id").order("id").range(from, to);

    if (error) {
      throw new Error(`R17 probe: could not list documents: ${error.message}`);
    }
    if (!docs?.length) {
      break;
    }

    for (const doc of docs) {
      const { data: openJobs, error: openError } = await supabase
        .from("ingestion_jobs")
        .select("id")
        .eq("document_id", doc.id)
        .in("status", ["pending", "processing"])
        .limit(1);
      if (openError) {
        throw new Error(`R17 probe: open-job lookup failed: ${openError.message}`);
      }
      if (!openJobs?.length) {
        return doc.id;
      }
    }

    page++;
  }

  throw new Error("R17 probe: could not find a document without open ingestion jobs");
}

async function checkR17IndexEnforcement(supabase: AdminClient) {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await prepareR17ProbeCleanup(supabase);

    const documentId = await findR17ProbeDocument(supabase);
    const primaryJobId = randomUUID();
    const duplicateJobId = randomUUID();
    const nextRunAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const baseRow = {
      document_id: documentId,
      status: "pending" as const,
      stage: R17_PROBE_STAGE,
      progress: 0,
      next_run_at: nextRunAt,
    };

    const { error: firstError } = await supabase.from("ingestion_jobs").insert({
      id: primaryJobId,
      ...baseRow,
    });

    if (firstError) {
      if (isR17IndexUniqueViolation(firstError) && attempt < maxAttempts) {
        console.log(
          `[July8 Live Batch] Race detected on doc ${documentId} (attempt ${attempt}/${maxAttempts}). Retrying...`,
        );
        continue;
      }
      throw new Error(`R17 probe: could not insert primary open job: ${firstError.message}`);
    }

    try {
      const { error: duplicateError } = await supabase.from("ingestion_jobs").insert({
        id: duplicateJobId,
        ...baseRow,
      });

      if (!duplicateError) {
        await deleteR17ProbeJobIds(supabase, [duplicateJobId], "unexpected duplicate");
        throw new Error(
          `${R17_INDEX} is not enforcing uniqueness — duplicate open job insert succeeded for document ${documentId}`,
        );
      }

      if (!isR17IndexUniqueViolation(duplicateError)) {
        throw new Error(
          `R17 probe: duplicate insert must violate ${R17_INDEX}, not a generic key conflict: ${duplicateError.message}`,
        );
      }

      // Success, break out of loop
      break;
    } finally {
      await deleteR17ProbeJobIds(supabase, [primaryJobId, duplicateJobId], "enforcement");
    }
  }

  await assertNoStrandedR17ProbeRows(supabase);
}

async function checkR17Index(supabase: AdminClient) {
  const { data, error } = await supabase.rpc("schema_drift_snapshot" as never);
  if (error) {
    throw new Error(`schema_drift_snapshot unavailable — cannot verify ${R17_INDEX}: ${error.message}`);
  }

  const indexes = (data as DriftSnapshot | null)?.indexes ?? [];
  const entry = indexes.find((index) => index?.name === R17_INDEX);
  if (!entry) {
    throw new Error(
      `${R17_INDEX} missing on live — apply 20260708170000_ingestion_jobs_one_open_per_document.sql (or manual CONCURRENTLY + repair 20260708170000)`,
    );
  }

  const definition = typeof entry.def === "string" ? entry.def : "";
  if (!isExpectedR17IndexDef(definition)) {
    throw new Error(
      `${R17_INDEX} definition mismatch — expected partial unique index on ingestion_jobs(document_id) for open statuses; got: ${definition || "<empty>"}`,
    );
  }

  await checkR17IndexEnforcement(supabase);
  console.log("[July8 Live Batch] PASS: R17 partial unique index is live, valid, and enforcing.");
}

async function main() {
  const { env, requireServerEnv } = await import("@/lib/env");
  const { checkSupabaseProjectConfig, expectedSupabaseProject, formatSupabaseProjectCheck } =
    await import("@/lib/supabase/project");

  requireServerEnv();

  const projectCheck = checkSupabaseProjectConfig(
    {
      NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_PROJECT_REF: env.SUPABASE_PROJECT_REF,
      SUPABASE_PROJECT_NAME: env.SUPABASE_PROJECT_NAME,
      SUPABASE_STAGING_PROJECT_REF: env.SUPABASE_STAGING_PROJECT_REF,
      SUPABASE_STAGING_PROJECT_NAME: env.SUPABASE_STAGING_PROJECT_NAME,
    },
    { requireMetadata: true },
  );

  if (projectCheck.status === "missing" || projectCheck.status === "mismatch") {
    throw new Error(formatSupabaseProjectCheck(projectCheck));
  }

  if (projectCheck.observed.environment !== "production") {
    throw new Error(
      `[July8 Live Batch] must target production ${expectedSupabaseProject.name} (${expectedSupabaseProject.ref}), not staging ${projectCheck.expected.ref}.`,
    );
  }

  const { createAdminClient } = await import("@/lib/supabase/admin");
  const supabase = createAdminClient();
  await checkFailClosedRetrieval(supabase);
  await checkJsonbMergeDeep(supabase);
  await checkWorkerLeaseFence(supabase);
  await checkR17Index(supabase);
  console.log("[July8 Live Batch] PASS: all July 8 batch probes green.");
}

if (isDirectEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error("[July8 Live Batch] FAIL:", error instanceof Error ? error.message : error);
    console.error("[July8 Live Batch] Runbook: docs/archive/operator-apply-july8-batch.md");
    process.exit(1);
  });
}
