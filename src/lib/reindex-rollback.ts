// Operator rollback of documents' committed index generation (scripts/reindex-rollback.ts).
//
// commit_document_index_generation moves documents.metadata.index_generation_id to a new
// generation; the prune trigger keeps that generation and the one it replaced. This module
// plans moving the pointer back to the previous committed generation (the most recent
// retained generation, other than the current one, that has typed document_pages rows, or chunks
// only when it predates the 13 Oct 2026 page stamps) and
// applies it through the rollback_document_index_generation RPC. Dry-run is the default.

export type RollbackScope =
  | { kind: "documents"; documentIds: string[] }
  | { kind: "committed-after"; after: string }
  | { kind: "chunker-version"; chunkerVersion: string };

export type CommittedGeneration = { generationId: string; committedAt: string };

export type RollbackPreflight = {
  openIngestionJobs: number;
  openEnrichmentJobs: number;
  pageStorageMode: string;
  targetPages: number;
  unstampedPages: number;
};

/** summaryRestored/labelsRestored come from the RPC; absent means it did not say (an older RPC). */
export type RepointResult = { ok: boolean; reason?: string; summaryRestored?: boolean; labelsRestored?: boolean };

// Narrow data-access surface so the planner is testable with an in-memory store.
export interface RollbackStore {
  /**
   * Coarse, lazily paged candidate stream for a scope. The planner applies the exact scope
   * filter and only then the document limit, so it stops pulling once the limit is reached.
   */
  candidateDocumentIds(scope: RollbackScope): AsyncIterable<string>;
  currentGeneration(documentId: string): Promise<string | null>;
  committedGenerations(documentId: string): Promise<CommittedGeneration[]>;
  chunkCount(documentId: string, generationId: string): Promise<number>;
  chunkerVersions(documentId: string, generationId: string): Promise<string[]>;
  /** Metadata only; the apply RPC repeats these checks under the document lock. */
  preflight(documentId: string, targetGeneration: string): Promise<RollbackPreflight>;
  /** True when the generation has both the metadata and the quality snapshot a rollback restores (#3732). */
  hasGenerationSnapshot(documentId: string, generationId: string): Promise<boolean>;
  repoint(documentId: string, expectedGeneration: string, targetGeneration: string): Promise<RepointResult>;
}

export type RollbackRefusal =
  | "document_not_found_or_no_current_generation"
  | "no_previous_generation"
  | "previous_generation_has_no_chunks"
  // The only other retained generation was committed AFTER the current one, so "rolling back"
  // would move the document forward again: a second run after a rollback does exactly this.
  // Pass --roll-forward to mean it (audit ING-S-N2, 24 Oct 2026).
  | "previous_generation_is_newer"
  // The database function refuses these too; the dry run reports it so apply holds no surprise.
  | "ingestion_in_progress"
  | "target_not_committed"
  | "target_snapshot_missing";

export type RollbackPlan = {
  documentId: string;
  currentGeneration: string | null;
  currentCommittedAt: string | null;
  currentChunks: number | null;
  previousGeneration: string | null;
  previousCommittedAt: string | null;
  previousChunks: number | null;
  preflight: RollbackPreflight | null;
  refusal: RollbackRefusal | null;
};

export type RollbackOutcome = RollbackPlan & {
  applied: boolean;
  applyError: string | null;
  summaryRestored?: boolean;
  labelsRestored?: boolean;
};

export const DEFAULT_ROLLBACK_LIMIT = 50;
export const MAX_ROLLBACK_LIMIT = 1000;

export function clampRollbackLimit(value: number) {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_ROLLBACK_LIMIT;
  return Math.min(Math.floor(value), MAX_ROLLBACK_LIMIT);
}

// Reads every typed page row across all pages (PostgREST caps each response at max_rows),
// and reduces them to each generation's earliest page created_at.
export async function collectCommittedGenerations(
  loadPage: (from: number, to: number) => Promise<Array<{ index_generation_id: string | null; created_at: string }>>,
  pageSize: number,
): Promise<CommittedGeneration[]> {
  const earliest = new Map<string, string>();
  for (let from = 0; ; from += pageSize) {
    const rows = await loadPage(from, from + pageSize - 1);
    for (const row of rows) {
      if (!row.index_generation_id) continue;
      const seen = earliest.get(row.index_generation_id);
      if (!seen || row.created_at < seen) earliest.set(row.index_generation_id, row.created_at);
    }
    if (rows.length < pageSize) break;
  }
  return [...earliest].map(([generationId, committedAt]) => ({ generationId, committedAt }));
}

/**
 * Audit E2E-01: adds generations that have chunks but no stamped pages. Every typed commit since
 * 13 Oct 2026 stamps its pages, so such a generation was committed before then and owns the
 * document's unstamped pages. A generation with stamped pages keeps its page date.
 */
export function mergeLegacyGenerations(
  stamped: CommittedGeneration[],
  fromChunks: CommittedGeneration[],
): CommittedGeneration[] {
  const known = new Set(stamped.map((entry) => entry.generationId));
  return [...stamped, ...fromChunks.filter((entry) => !known.has(entry.generationId))];
}

function byCommittedAtDesc(left: CommittedGeneration, right: CommittedGeneration) {
  return right.committedAt.localeCompare(left.committedAt);
}

export type RollbackPlanOptions = { allowRollForward?: boolean };

type SelectedDocument = { currentGeneration: string | null; generations?: CommittedGeneration[] };

function isNewerThan(candidate: string, reference: string | null) {
  return reference !== null && candidate.localeCompare(reference) > 0;
}

async function planDocument(
  store: RollbackStore,
  documentId: string,
  selected: SelectedDocument,
  options: RollbackPlanOptions = {},
): Promise<RollbackPlan> {
  const plan: RollbackPlan = {
    documentId,
    currentGeneration: null,
    currentCommittedAt: null,
    currentChunks: null,
    previousGeneration: null,
    previousCommittedAt: null,
    previousChunks: null,
    preflight: null,
    refusal: null,
  };
  const current = selected.currentGeneration;
  if (!current) return { ...plan, refusal: "document_not_found_or_no_current_generation" };
  plan.currentGeneration = current;
  const generations = (selected.generations ?? (await store.committedGenerations(documentId)))
    .slice()
    .sort(byCommittedAtDesc);
  plan.currentCommittedAt = generations.find((entry) => entry.generationId === current)?.committedAt ?? null;
  plan.currentChunks = await store.chunkCount(documentId, current);
  const previous = generations.find((entry) => entry.generationId !== current);
  if (!previous) return { ...plan, refusal: "no_previous_generation" };
  plan.previousGeneration = previous.generationId;
  plan.previousCommittedAt = previous.committedAt;
  plan.previousChunks = await store.chunkCount(documentId, previous.generationId);
  if (plan.previousChunks === 0) return { ...plan, refusal: "previous_generation_has_no_chunks" };
  plan.preflight = await store.preflight(documentId, previous.generationId);
  if (plan.preflight.openIngestionJobs > 0 || plan.preflight.openEnrichmentJobs > 0) {
    return { ...plan, refusal: "ingestion_in_progress" };
  }
  // Match rollback_document_index_generation: only a typed current document can fall back
  // to retained unstamped pages when the target predates typed page generations.
  if (
    plan.preflight.targetPages === 0 &&
    !(plan.preflight.pageStorageMode === "typed_exact" && plan.preflight.unstampedPages > 0)
  ) {
    return { ...plan, refusal: "target_not_committed" };
  }
  // With no commit time for the current generation the order cannot be known, so the target could
  // be newer: refuse unless the operator means to roll forward.
  if (
    !options.allowRollForward &&
    (plan.currentCommittedAt === null || isNewerThan(previous.committedAt, plan.currentCommittedAt))
  ) {
    return { ...plan, refusal: "previous_generation_is_newer" };
  }
  if (!(await store.hasGenerationSnapshot(documentId, previous.generationId))) {
    return { ...plan, refusal: "target_snapshot_missing" };
  }
  return plan;
}

async function selectDocument(
  store: RollbackStore,
  scope: RollbackScope,
  documentId: string,
): Promise<SelectedDocument | null> {
  // Capture once: filtering and the eventual expected-generation fence must name the same
  // generation, even if another worker commits while these read-only queries are in flight.
  const currentGeneration = await store.currentGeneration(documentId);
  if (scope.kind === "documents") return { currentGeneration };
  if (!currentGeneration) return null;
  if (scope.kind === "chunker-version") {
    const versions = await store.chunkerVersions(documentId, currentGeneration);
    return versions.includes(scope.chunkerVersion) ? { currentGeneration } : null;
  }
  // Commit-time proxies require the generation inventory, but not artifact counts, queue/page
  // preflight or snapshots. Reuse that inventory when the candidate passes the cutoff.
  const generations = await store.committedGenerations(documentId);
  const committedAt = generations.find((entry) => entry.generationId === currentGeneration)?.committedAt;
  return committedAt && Date.parse(committedAt) > Date.parse(scope.after) ? { currentGeneration, generations } : null;
}

export async function planReindexRollback(
  store: RollbackStore,
  scope: RollbackScope,
  limit = DEFAULT_ROLLBACK_LIMIT,
  options: RollbackPlanOptions = {},
) {
  const max = clampRollbackLimit(limit);
  const seen = new Set<string>();
  const plans: RollbackPlan[] = [];
  for await (const documentId of store.candidateDocumentIds(scope)) {
    if (seen.has(documentId)) continue;
    seen.add(documentId);
    const selected = await selectDocument(store, scope, documentId);
    if (!selected) continue;
    // The limit counts in-scope documents only, so out-of-scope candidates (for example a
    // retained non-current generation that matches) never consume it.
    plans.push(await planDocument(store, documentId, selected, options));
    if (plans.length >= max) break;
  }
  return plans;
}

// Writes only when apply is true, and only for plans with no refusal. The RPC re-checks the
// pointer, open ingestion jobs, commit evidence and chunk count under a row lock.
export async function runReindexRollback(
  store: RollbackStore,
  scope: RollbackScope,
  options: { apply?: boolean; limit?: number } & RollbackPlanOptions = {},
): Promise<RollbackOutcome[]> {
  const plans = await planReindexRollback(store, scope, options.limit, options);
  return options.apply
    ? applyRollbackPlans(store, plans)
    : plans.map((plan) => ({ ...plan, applied: false, applyError: null }));
}

// Applies exactly the given (previewed) plans. The RPC's expected-generation check uses the
// pointer captured in the preview, so any commit or rollback since the preview fails closed
// with pointer_moved instead of silently acting on a freshly computed plan.
export async function applyRollbackPlans(
  store: RollbackStore,
  plans: readonly RollbackPlan[],
): Promise<RollbackOutcome[]> {
  const outcomes: RollbackOutcome[] = [];
  for (const plan of plans) {
    if (plan.refusal || !plan.currentGeneration || !plan.previousGeneration) {
      outcomes.push({ ...plan, applied: false, applyError: null });
      continue;
    }
    try {
      const result = await store.repoint(plan.documentId, plan.currentGeneration, plan.previousGeneration);
      outcomes.push({
        ...plan,
        applied: result.ok,
        applyError: result.ok ? null : (result.reason ?? "rpc_refused"),
        summaryRestored: result.summaryRestored,
        labelsRestored: result.labelsRestored,
      });
    } catch (error) {
      outcomes.push({ ...plan, applied: false, applyError: error instanceof Error ? error.message : String(error) });
    }
  }
  return outcomes;
}

export function formatRollbackOutcome(outcome: RollbackOutcome, apply: boolean) {
  const status = outcome.refusal
    ? `REFUSED (${outcome.refusal})`
    : apply
      ? outcome.applied
        ? isNewerThan(outcome.previousCommittedAt ?? "", outcome.currentCommittedAt)
          ? "ROLLED FORWARD"
          : "ROLLED BACK"
        : `FAILED (${outcome.applyError ?? "unknown"})`
      : isNewerThan(outcome.previousCommittedAt ?? "", outcome.currentCommittedAt)
        ? "WOULD ROLL FORWARD"
        : "WOULD ROLL BACK";
  return [
    `${outcome.documentId}: ${status}`,
    `  current : ${outcome.currentGeneration ?? "none"} (${outcome.currentChunks ?? "?"} chunks, committed ${outcome.currentCommittedAt ?? "?"})`,
    `  previous: ${outcome.previousGeneration ?? "none"} (${outcome.previousChunks ?? "?"} chunks, committed ${outcome.previousCommittedAt ?? "?"})`,
    ...(outcome.preflight
      ? [
          `  preflight: ${outcome.preflight.openIngestionJobs} open ingestion jobs, ${outcome.preflight.openEnrichmentJobs} open enrichment jobs; ${outcome.preflight.targetPages} target pages, ${outcome.preflight.unstampedPages} unstamped pages (${outcome.preflight.pageStorageMode})`,
        ]
      : []),
  ].join("\n");
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseRollbackArgs(argv: string[]) {
  const valuesFor = (name: string) => {
    const values: string[] = [];
    argv.forEach((arg, index) => {
      if (arg.startsWith(`--${name}=`)) values.push(arg.slice(name.length + 3));
      else if (arg === `--${name}` && argv[index + 1]) values.push(argv[index + 1]);
    });
    return values
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter(Boolean);
  };
  const documentIds = valuesFor("document-id");
  const [after] = valuesFor("committed-after");
  const [chunkerVersion] = valuesFor("chunker-version");
  const chosen = [documentIds.length > 0, Boolean(after), Boolean(chunkerVersion)].filter(Boolean).length;
  if (chosen !== 1) {
    throw new Error(
      "Choose exactly one scope: --document-id <id[,id]>, --committed-after <ISO time> or --chunker-version <v>.",
    );
  }
  const badId = documentIds.find((id) => !uuidPattern.test(id));
  if (badId) throw new Error(`Not a document UUID: ${badId}`);
  if (after && Number.isNaN(Date.parse(after))) throw new Error(`Not a timestamp: ${after}`);
  const scope: RollbackScope = documentIds.length
    ? { kind: "documents", documentIds }
    : after
      ? { kind: "committed-after", after: new Date(after).toISOString() }
      : { kind: "chunker-version", chunkerVersion: chunkerVersion as string };
  const [limitValue] = valuesFor("limit");
  const apply = argv.includes("--apply");
  return {
    scope,
    apply,
    yes: argv.includes("--yes"),
    allowRollForward: argv.includes("--roll-forward"),
    limit: clampRollbackLimit(Number.parseInt(limitValue ?? "", 10)),
  };
}

/**
 * Which enrichment fields a rolled-back document still shows from the newer version. The rollback
 * RPC restores the summary, clinical specifics and labels when the target generation's snapshot
 * holds them; a flag that is false or missing (an older RPC) leaves that field stale.
 */
export function staleEnrichmentAfterRollback(outcome: RollbackOutcome): string[] {
  if (!outcome.applied) return [];
  return [
    ...(outcome.summaryRestored === true ? [] : ["summary and clinical specifics"]),
    ...(outcome.labelsRestored === true ? [] : ["topic labels"]),
  ];
}
