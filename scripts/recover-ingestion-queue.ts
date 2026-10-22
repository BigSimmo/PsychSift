import { loadEnvConfig } from "@next/env";
import type { IngestionRecoveryJob } from "@/lib/ingestion-recovery";
import { confirm } from "./cli-utils";
import { applyIngestionRecoveryPlan, supabaseStageError } from "./lib/ingestion-recovery-executor";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

type RecoveryDocument = {
  status?: string | null;
  page_count?: number | null;
  chunk_count?: number | null;
  owner_id?: string | null;
};

type RawJobRow = {
  id: string;
  document_id: string;
  status: string | null;
  locked_at: string | null;
  documents: RecoveryDocument | RecoveryDocument[] | null;
};

const booleanFlags = new Set(["--apply", "--yes", "--include-stranded-queued"]);
const valueFlags = new Set(["--stale-after-minutes", "--limit", "--stranded-min-age-minutes", "--owner-id"]);

// Audit L2 (hardened after diff review): this script mutates ingestion state,
// so argument parsing fails loudly on ANY surprise —
//   - unknown/typo'd flag names ("--limt 5" used to be ignored, silently
//     recovering up to 20 jobs instead of the intended 5),
//   - a value-flag with a missing or empty value ("--limit" at the end of the
//     line, "--limit="),
//   - provided-but-malformed numeric values ("--limit 5O").
function parseArgs(argv: string[]) {
  const values = new Map<string, string>();
  const booleans = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (booleanFlags.has(token)) {
      booleans.add(token);
      continue;
    }
    const equalsIndex = token.indexOf("=");
    const name = equalsIndex >= 0 ? token.slice(0, equalsIndex) : token;
    if (!valueFlags.has(name)) throw new Error(`Unknown argument ${token}`);
    const value = equalsIndex >= 0 ? token.slice(equalsIndex + 1) : argv[index + 1];
    if (equalsIndex < 0) index += 1;
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
    values.set(name, value);
  }
  const positiveIntFor = (name: string) => {
    const raw = values.get(`--${name}`);
    if (raw === undefined) return undefined;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== raw.trim()) {
      throw new Error(`--${name} must be a positive integer (received "${raw}").`);
    }
    return parsed;
  };
  const ownerId = values.get("--owner-id");
  if (ownerId !== undefined && ownerId.trim().length === 0) {
    throw new Error("--owner-id must be a non-empty UUID when provided.");
  }
  return {
    apply: booleans.has("--apply"),
    yes: booleans.has("--yes"),
    includeStrandedQueued: booleans.has("--include-stranded-queued"),
    staleAfterMinutes: positiveIntFor("stale-after-minutes"),
    strandedMinAgeMinutes: positiveIntFor("stranded-min-age-minutes"),
    limit: positiveIntFor("limit"),
    ownerId: ownerId?.trim(),
  };
}

export async function runIngestionRecovery(argv = process.argv.slice(2)) {
  loadEnvConfig(process.cwd());
  const [
    { env, requireServerEnv },
    { buildIngestionRecoveryPlan, INGESTION_RECOVERY_JOB_STATUSES },
    { createAdminClient },
    { assertSupabaseHealthy, probeSupabaseHealth },
  ] = await Promise.all([
    import("@/lib/env"),
    import("@/lib/ingestion-recovery"),
    import("@/lib/supabase/admin"),
    import("@/lib/supabase/health"),
  ]);
  requireServerEnv();
  const args = parseArgs(argv);
  const staleAfterMinutes = args.staleAfterMinutes ?? env.WORKER_STALE_AFTER_MINUTES;
  const limit = args.limit ?? 20;
  const supabase = createAdminClient();

  console.log("=== Ingestion Queue Recovery ===");
  console.log(`Checking Supabase health...`);
  assertSupabaseHealthy(await probeSupabaseHealth(supabase), "Ingestion queue recovery");
  console.log("  Supabase is healthy.\n");

  // Built as a function, not a one-shot query: the plan is re-derived against a second read of
  // these same rows immediately before anything is written. (Audit R20/R21)
  const openJobsQuery = () => {
    const query = supabase
      .from("ingestion_jobs")
      .select("id,document_id,status,locked_at,documents!inner(status,page_count,chunk_count,owner_id)")
      .in("status", [...INGESTION_RECOVERY_JOB_STATUSES])
      .order("created_at", { ascending: true });
    return args.ownerId ? query.eq("documents.owner_id", args.ownerId) : query;
  };

  const normaliseJobRows = (rows: RawJobRow[] | null) =>
    (rows ?? []).map((job) => ({
      ...job,
      documents: Array.isArray(job.documents) ? (job.documents[0] as RecoveryDocument | undefined) : job.documents,
    })) as IngestionRecoveryJob[];

  const { data, error } = await openJobsQuery();
  if (error) throw supabaseStageError("load open ingestion jobs", error);

  const jobs = normaliseJobRows(data as RawJobRow[] | null);
  const plan = buildIngestionRecoveryPlan({ jobs, staleAfterMinutes });
  const actions = plan.actions.slice(0, limit);
  const resetDocumentIds = Array.from(
    new Set(actions.filter((action) => action.action === "retry").map((action) => action.documentId)),
  );
  const supersedeCount = actions.filter((action) => action.action === "supersede").length;
  const retryCount = actions.filter((action) => action.action === "retry").length;
  const remainingCount = Math.max(0, plan.actions.length - actions.length);

  console.log(`Stale-after threshold : ${staleAfterMinutes} min`);
  console.log(`Action limit          : ${limit}`);
  console.log(`Scanned jobs          : ${jobs.length}`);
  console.log(`Documents to reset    : ${resetDocumentIds.length}`);
  console.log(`Jobs to supersede     : ${supersedeCount}`);
  console.log(`Jobs to retry         : ${retryCount}`);
  if (remainingCount > 0) {
    console.log(`Remaining (over limit): ${remainingCount}`);
  }

  let stranded: Awaited<
    ReturnType<(typeof import("@/lib/stranded-queued-recovery"))["listStrandedQueuedDocuments"]>
  > | null = null;
  if (args.includeStrandedQueued) {
    const { listStrandedQueuedDocuments, STRANDED_QUEUED_DEFAULT_MIN_AGE_MINUTES } =
      await import("@/lib/stranded-queued-recovery");
    const strandedMinAgeMinutes = args.strandedMinAgeMinutes ?? STRANDED_QUEUED_DEFAULT_MIN_AGE_MINUTES;
    stranded = await listStrandedQueuedDocuments({
      supabase,
      minAgeMinutes: strandedMinAgeMinutes,
      limit,
      ownerId: args.ownerId ?? null,
    });
    console.log("\n=== Stranded queued-without-job recovery ===");
    console.log(`Min age                 : ${strandedMinAgeMinutes} min`);
    console.log(`Owner scope             : ${args.ownerId ?? "(all owners)"}`);
    console.log(`Stranded candidates     : ${stranded.length}`);
    for (const document of stranded) {
      console.log(`  - ${document.id} owner=${document.owner_id ?? "null"} updated_at=${document.updated_at}`);
    }
  }

  if (actions.length === 0 && (stranded?.length ?? 0) === 0) {
    console.log("\nNothing to recover. Queue looks healthy.");
    return;
  }

  let shouldApply = args.apply;
  if (!shouldApply) {
    if (args.yes) {
      shouldApply = true;
    } else {
      console.log("");
      shouldApply = await confirm("Apply these changes?");
    }
  }

  if (!shouldApply) {
    console.log("\nNo changes applied. Re-run with --apply or confirm interactively to mutate the ingestion queue.");
    return;
  }

  if (actions.length > 0) {
    await applyIngestionRecoveryPlan({
      supabase,
      actions,
      staleAfterMinutes,
      readJobs: async () => {
        const { data, error } = await openJobsQuery();
        if (error) throw supabaseStageError("re-read open ingestion jobs", error);
        return normaliseJobRows(data as RawJobRow[] | null);
      },
    });

    if (remainingCount > 0) {
      console.log(`\n${remainingCount} action(s) remain over the limit. Re-run to process the next batch.`);
    }
  }

  if (stranded && stranded.length > 0) {
    const { recoverStrandedQueuedDocuments } = await import("@/lib/stranded-queued-recovery");
    const strandedResults = await recoverStrandedQueuedDocuments({ supabase, documents: stranded });
    const enqueued = strandedResults.filter((result) => result.outcome === "enqueued").length;
    const alreadyActive = strandedResults.filter((result) => result.outcome === "already_active").length;
    const errors = strandedResults.filter((result) => result.outcome === "error");
    console.log(`\nStranded enqueued       : ${enqueued}`);
    console.log(`Stranded already active : ${alreadyActive}`);
    if (errors.length > 0) {
      console.log(`Stranded errors         : ${errors.length}`);
      for (const error of errors) {
        console.log(`  - ${error.documentId}: ${error.message}`);
      }
      throw new Error(`Stranded queued recovery reported ${errors.length} error(s).`);
    }
  }
}

if (isDirectEntrypoint(import.meta.url)) {
  runIngestionRecovery().catch((error) => {
    import("@/lib/privacy")
      .then(({ safeErrorLogDetails }) => {
        console.error("Ingestion queue recovery failed", safeErrorLogDetails(error));
        process.exitCode = 1;
      })
      .catch(() => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
      });
  });
}
