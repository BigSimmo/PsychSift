"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { floatingControl, primaryControl } from "@/components/primitive-recipes/recipes";
import {
  CARD_CLASS,
  CountTile,
  META_CLASS,
  MONO_CLASS,
  ROW_CLASS,
  SECTION_HEADING_CLASS,
} from "@/components/developer-area/hub/panel-primitives";
import { formatTimeDistance, resolveFreshnessFrom } from "@/lib/developer-area/freshness";

/**
 * `ingestion_jobs.status` is a plain `string` column
 * (`src/lib/supabase/database.types.ts`), not an enum, and the API route only
 * formally recognises `["pending", "processing"]` as "active"
 * (`ACTIVE_JOB_STATUSES` in `src/app/api/ingestion/jobs/route.ts`). This panel
 * additionally breaks out `completed` and `failed`, because "did it index" and
 * "what keeps failing" are the two facts this page exists to answer — but
 * nothing here assumes those four values are exhaustive. See `bucketJobs`.
 */
type IngestionJobRow = {
  id: string;
  status: string;
  stage: string | null;
  progress: number | null;
  error_message: string | null;
  created_at: string | null;
  updated_at: string | null;
  document_id: string | null;
  documents: { title: string | null; file_name: string | null } | null;
};

type IngestionPagination = { total: number; hasMore: boolean };

type PanelState =
  | { kind: "loading" }
  | { kind: "demo"; fetchedAt: string }
  | { kind: "unauthorized"; fetchedAt: string }
  | { kind: "fetch-error"; fetchedAt: string; message: string }
  | {
      kind: "ready";
      fetchedAt: string;
      jobs: IngestionJobRow[];
      activeJobCount: number;
      failedJobCount: number;
      hasActiveJobs: boolean;
      pollAfterMs: number | null;
      pagination: IngestionPagination | null;
    };

const ACTIVE_STATUSES = new Set(["pending", "processing"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asJobRow(value: unknown): IngestionJobRow | null {
  const row = asRecord(value);
  if (typeof row.id !== "string") return null;
  const documentsRaw = row.documents;
  const documents =
    documentsRaw !== null && typeof documentsRaw === "object"
      ? {
          title:
            typeof (documentsRaw as Record<string, unknown>).title === "string"
              ? ((documentsRaw as Record<string, unknown>).title as string)
              : null,
          file_name:
            typeof (documentsRaw as Record<string, unknown>).file_name === "string"
              ? ((documentsRaw as Record<string, unknown>).file_name as string)
              : null,
        }
      : null;
  return {
    id: row.id,
    status: typeof row.status === "string" && row.status.length > 0 ? row.status : "(status missing)",
    stage: typeof row.stage === "string" ? row.stage : null,
    progress: typeof row.progress === "number" ? row.progress : null,
    error_message: typeof row.error_message === "string" ? row.error_message : null,
    created_at: typeof row.created_at === "string" ? row.created_at : null,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
    document_id: typeof row.document_id === "string" ? row.document_id : null,
    documents,
  };
}

/**
 * Validates the shape this panel actually depends on before trusting any of
 * it. A response that does not match — even a 200 — degrades to the
 * fetch-error state rather than silently rendering an invented "zero jobs":
 * AGENTS.md's "failure behaviour must always degrade conservatively rather
 * than guess" applies to this panel exactly as much as to answer generation.
 */
function parseReadyPayload(payload: Record<string, unknown>) {
  if (!Array.isArray(payload.jobs)) return null;
  if (typeof payload.activeJobCount !== "number") return null;
  // #L15: required like activeJobCount, not defaulted to 0 — a response that
  // omits it degrades to the fetch-error state rather than silently showing
  // "0 failed" for a corpus that may have failures.
  if (typeof payload.failedJobCount !== "number") return null;
  if (typeof payload.hasActiveJobs !== "boolean") return null;
  const jobs = payload.jobs.map(asJobRow).filter((job): job is IngestionJobRow => job !== null);
  const pollAfterMs = typeof payload.pollAfterMs === "number" ? payload.pollAfterMs : null;
  const paginationRaw = asRecord(payload.pagination);
  const pagination: IngestionPagination | null =
    typeof paginationRaw.total === "number"
      ? { total: paginationRaw.total, hasMore: paginationRaw.hasMore === true }
      : null;
  return {
    jobs,
    activeJobCount: payload.activeJobCount,
    failedJobCount: payload.failedJobCount,
    hasActiveJobs: payload.hasActiveJobs,
    pollAfterMs,
    pagination,
  };
}

/**
 * Ruling I2 (plan §5): any status this panel does not recognise is shown,
 * verbatim, under its own bucket rather than dropped, keyed on row
 * identity (a `Set` of the row objects themselves) so two jobs can never
 * collide even if their other fields happen to match.
 */
function bucketJobs(jobs: IngestionJobRow[]) {
  const active = jobs.filter((job) => ACTIVE_STATUSES.has(job.status));
  const completed = jobs.filter((job) => job.status === "completed");
  const failed = jobs.filter((job) => job.status === "failed");
  const recognised = new Set<IngestionJobRow>([...active, ...completed, ...failed]);
  const other = jobs.filter((job) => !recognised.has(job));
  return { active, completed, failed, other };
}

function documentLabel(job: IngestionJobRow): string {
  return job.documents?.title || job.documents?.file_name || job.document_id || "unknown document";
}

/**
 * Per-job retry state, keyed by job id so a row keeps its outcome line even
 * after the refetch moves it from "Failed" to "Active".
 */
type RetryStatus =
  { kind: "confirming" } | { kind: "pending" } | { kind: "queued" } | { kind: "error"; message: string };

type RetryControls = {
  statusFor: (jobId: string) => RetryStatus | undefined;
  onRequest: (jobId: string) => void;
  onCancel: (jobId: string) => void;
  onConfirm: (jobId: string) => void;
};

const RETRY_SIGN_IN_MESSAGE = "Sign in as an administrator to retry. The developer key alone can't change anything.";

/**
 * Turns the retry route's response into the one line this row shows. The
 * route (`src/app/api/ingestion/jobs/[id]/retry/route.ts`) replies `{ job }`
 * on success and the shared `{ error, message, code }` envelope otherwise.
 */
function retryOutcome(status: number, payload: Record<string, unknown>): RetryStatus {
  const serverMessage = typeof payload.error === "string" && payload.error.length > 0 ? payload.error : null;
  if (status >= 200 && status < 300) return { kind: "queued" };
  if (status === 401 || status === 403) return { kind: "error", message: RETRY_SIGN_IN_MESSAGE };
  // 409 means the job already completed or a worker still holds it; the
  // server's own sentence says which, so it is shown as given.
  if (status === 409) return { kind: "error", message: serverMessage ?? "This job can't be retried right now." };
  if (status === 429) return { kind: "error", message: "Too many requests. Try again shortly." };
  return { kind: "error", message: `Retry failed: ${serverMessage ?? `the server replied with status ${status}.`}` };
}

function RetryOutcomeLine({ jobId, status }: { jobId: string; status: RetryStatus | undefined }) {
  if (status?.kind === "queued") {
    return (
      <p
        role="status"
        data-testid={`developer-ingestion-retry-queued-${jobId}`}
        className="basis-full text-sm text-[color:var(--text-heading)]"
      >
        Queued for indexing
      </p>
    );
  }
  if (status?.kind === "error") {
    return (
      <p
        role="status"
        data-testid={`developer-ingestion-retry-error-${jobId}`}
        className="basis-full text-sm text-[color:var(--text-heading)]"
      >
        {status.message}
      </p>
    );
  }
  return null;
}

function RetryConfirm({ job, pending, controls }: { job: IngestionJobRow; pending: boolean; controls: RetryControls }) {
  const promptId = `developer-ingestion-retry-prompt-${job.id}`;
  return (
    <div
      role="group"
      aria-labelledby={promptId}
      aria-busy={pending}
      data-testid={`developer-ingestion-retry-confirm-${job.id}`}
      className="grid basis-full gap-2 rounded-lg border border-[color:var(--border)] p-3"
    >
      <p id={promptId} className="text-sm leading-6 text-[color:var(--text-heading)]">
        Retry indexing {documentLabel(job)}? This re-runs indexing for this document and may use OpenAI credit.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryControl} disabled={pending} onClick={() => controls.onConfirm(job.id)}>
          Retry indexing
        </button>
        <button type="button" className={floatingControl} disabled={pending} onClick={() => controls.onCancel(job.id)}>
          Cancel
        </button>
      </div>
      {pending ? (
        <p role="status" className={META_CLASS}>
          Retrying…
        </p>
      ) : null}
    </div>
  );
}

function JobRow({ job, retry }: { job: IngestionJobRow; retry: RetryControls }) {
  const status = retry.statusFor(job.id);
  // Retry is offered on failed jobs only: the route refuses completed jobs and
  // jobs a worker still holds, so offering it anywhere else only invites a 409.
  const retryable = job.status === "failed";
  const confirming = status?.kind === "confirming" || status?.kind === "pending";
  return (
    <li data-testid={`developer-ingestion-job-${job.id}`} className={ROW_CLASS}>
      <span className="text-sm font-semibold text-[color:var(--text-heading)]">{documentLabel(job)}</span>
      <span className={MONO_CLASS}>{job.status}</span>
      {job.stage ? <span className={META_CLASS}>stage: {job.stage}</span> : null}
      {typeof job.progress === "number" ? <span className={META_CLASS}>progress: {job.progress}</span> : null}
      {job.error_message ? <span className={META_CLASS}>{job.error_message}</span> : null}
      {job.updated_at ? <span className={META_CLASS}>updated {job.updated_at}</span> : null}
      {retryable && !confirming ? (
        <button
          type="button"
          data-testid={`developer-ingestion-retry-${job.id}`}
          className={`${floatingControl} ml-auto`}
          aria-label={`Retry indexing ${documentLabel(job)}`}
          onClick={() => retry.onRequest(job.id)}
        >
          Retry
        </button>
      ) : null}
      {retryable && confirming ? (
        <RetryConfirm job={job} pending={status?.kind === "pending"} controls={retry} />
      ) : null}
      <RetryOutcomeLine jobId={job.id} status={status} />
    </li>
  );
}

function JobSection({
  testId,
  heading,
  jobs,
  emptyNote,
  retry,
}: {
  testId: string;
  heading: string;
  jobs: IngestionJobRow[];
  emptyNote: string;
  retry: RetryControls;
}) {
  return (
    <section aria-labelledby={`${testId}-heading`} className="grid gap-3">
      <h2 id={`${testId}-heading`} className={SECTION_HEADING_CLASS}>
        {heading}
      </h2>
      {jobs.length > 0 ? (
        <ul data-testid={`${testId}-list`} className="grid gap-2">
          {jobs.map((job) => (
            <JobRow key={job.id} job={job} retry={retry} />
          ))}
        </ul>
      ) : (
        <p data-testid={`${testId}-empty`} className={META_CLASS}>
          {emptyNote}
        </p>
      )}
    </section>
  );
}

/**
 * The fact plan §8 asks for — when the job data was last fetched, updating as
 * this panel polls — rendered next to the data it describes. `PanelPageShell`'s
 * own stamp cannot carry this: it is filled in by the Server Component page at
 * render time, before any client fetch has happened, so it says "revision
 * unknown" for this page and stays that way. This is the honest, live number.
 */
function CheckedAt({ fetchedAt }: { fetchedAt: string }) {
  const freshness = resolveFreshnessFrom(fetchedAt, new Date(), { status: "live" });
  if (freshness.contentAt === null) return null;
  // #L14: this client-rendered stamp followed the browser's clock while the
  // server-rendered `FreshnessStamp` above it followed the container's (UTC
  // on Railway) — an unlabelled eight-hour gap for a Perth reader on the one
  // page that polls live. Pinned to Australia/Perth so both agree regardless
  // of where either half renders, and the zone name is printed so a reader
  // never has to guess which clock produced it.
  const time = new Date(freshness.contentAt).toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Australia/Perth",
    timeZoneName: "short",
  });
  const timeDistance = formatTimeDistance(freshness.ageHours, freshness.ageMinutes);
  return (
    <p data-testid="developer-ingestion-checked-at" className={META_CLASS}>
      Job data last checked at {time} ({timeDistance}).
    </p>
  );
}

export function IngestionPanel() {
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const fetchedAt = new Date().toISOString();
    let response: Response;
    try {
      response = await fetch("/api/ingestion/jobs", { cache: "no-store" });
    } catch {
      if (!mountedRef.current) return;
      setState({
        kind: "fetch-error",
        fetchedAt,
        message: "The panel could not reach the ingestion jobs endpoint.",
      });
      return;
    }

    if (!mountedRef.current) return;
    if (response.status === 401 || response.status === 403) {
      setState({ kind: "unauthorized", fetchedAt });
      return;
    }
    if (!response.ok) {
      setState({
        kind: "fetch-error",
        fetchedAt,
        message: `The ingestion jobs endpoint could not be reached (status ${response.status}).`,
      });
      return;
    }

    let payloadRaw: unknown;
    try {
      payloadRaw = await response.json();
    } catch {
      if (!mountedRef.current) return;
      setState({
        kind: "fetch-error",
        fetchedAt,
        message:
          "Malformed response from ingestion endpoint: the jobs endpoint replied, but the body could not be parsed as JSON.",
      });
      return;
    }

    const payload = asRecord(payloadRaw);
    if (!mountedRef.current) return;
    if (payload.demoMode === true) {
      setState({ kind: "demo", fetchedAt });
      return;
    }
    const parsed = parseReadyPayload(payload);
    if (!parsed) {
      setState({
        kind: "fetch-error",
        fetchedAt,
        message: "The ingestion jobs endpoint returned an unexpected shape and could not be read.",
      });
      return;
    }
    setState({ kind: "ready", fetchedAt, ...parsed });
  }, []);

  const [retryStatuses, setRetryStatuses] = useState<Record<string, RetryStatus>>({});
  // A ref as well as state, so a second click in the same tick cannot fire a
  // second POST before React has re-rendered the disabled button.
  const retryInFlightRef = useRef(new Set<string>());

  const setRetryStatus = useCallback((jobId: string, status: RetryStatus | null) => {
    setRetryStatuses((current) => {
      const next = { ...current };
      if (status === null) delete next[jobId];
      else next[jobId] = status;
      return next;
    });
  }, []);

  const confirmRetry = useCallback(
    async (jobId: string) => {
      if (retryInFlightRef.current.has(jobId)) return;
      retryInFlightRef.current.add(jobId);
      setRetryStatus(jobId, { kind: "pending" });
      let outcome: RetryStatus;
      try {
        // Same request shape as `ClinicalDashboard`'s `retryJob`: a bare
        // same-origin POST. The CSRF guard in `src/proxy.ts` reads the
        // browser's own Fetch Metadata and Origin, so no extra header is sent;
        // the session cookie carries the administrator sign-in.
        const response = await fetch(`/api/ingestion/jobs/${encodeURIComponent(jobId)}/retry`, {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
        });
        const payload = asRecord(await response.json().catch(() => ({})));
        outcome = retryOutcome(response.status, payload);
      } catch {
        outcome = { kind: "error", message: "Retry failed: the panel could not reach the server." };
      } finally {
        retryInFlightRef.current.delete(jobId);
      }
      if (!mountedRef.current) return;
      setRetryStatus(jobId, outcome);
      if (outcome.kind === "queued") await load();
    },
    [load, setRetryStatus],
  );

  const retryControls: RetryControls = {
    statusFor: (jobId) => retryStatuses[jobId],
    onRequest: (jobId) => setRetryStatus(jobId, { kind: "confirming" }),
    onCancel: (jobId) => setRetryStatus(jobId, null),
    onConfirm: (jobId) => {
      void confirmRetry(jobId);
    },
  };

  useEffect(() => {
    // Deferred through a timer, not called directly in the effect body — same
    // shape as `ClinicalTrustCockpit`'s mount effect — so this stays a
    // subscription to an external system rather than a synchronous setState
    // inside an effect, which `react-hooks/set-state-in-effect` (correctly)
    // rejects.
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Ruling I1 (plan §3): the refresh cadence is the value the server hands
  // back (`pollAfterMs`), never a number this panel invents, and polling stops
  // the moment the server reports no active jobs — never an unconditional
  // interval that would keep hammering the endpoint after indexing finishes.
  useEffect(() => {
    if (state.kind !== "ready" || !state.hasActiveJobs || state.pollAfterMs === null) return undefined;
    const timer = window.setTimeout(() => {
      void load();
    }, state.pollAfterMs);
    return () => window.clearTimeout(timer);
  }, [state, load]);

  if (state.kind === "loading") {
    return (
      <div data-testid="developer-ingestion-panel">
        <p role="status" data-testid="developer-ingestion-loading" className={META_CLASS}>
          Loading ingestion jobs…
        </p>
      </div>
    );
  }

  if (state.kind === "demo") {
    return (
      <div data-testid="developer-ingestion-panel" className="grid gap-3">
        <div data-testid="developer-ingestion-demo" className={CARD_CLASS}>
          <p className="text-sm leading-6 text-[color:var(--text-heading)]">
            This app is not connected to a database right now (demo mode), so whether any document actually indexed is
            unknowable here — not zero jobs, unknowable.
          </p>
        </div>
        <CheckedAt fetchedAt={state.fetchedAt} />
      </div>
    );
  }

  if (state.kind === "unauthorized") {
    return (
      <div data-testid="developer-ingestion-panel" className="grid gap-3">
        <div data-testid="developer-ingestion-unauthorized" role="alert" className={CARD_CLASS}>
          <p className="text-sm leading-6 text-[color:var(--text-heading)]">
            Live ingestion job state needs an administrator sign-in. That is the normal local experience — this page
            renders in development without one, but the endpoint itself still enforces it in every environment.
          </p>
          <Link
            href="/"
            data-testid="developer-ingestion-sign-in-link"
            className="inline-flex min-h-12 w-fit items-center text-sm font-bold text-[color:var(--clinical-accent)] underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
          >
            Sign in from the app
          </Link>
        </div>
        <CheckedAt fetchedAt={state.fetchedAt} />
      </div>
    );
  }

  if (state.kind === "fetch-error") {
    return (
      <div data-testid="developer-ingestion-panel" className="grid gap-3">
        <div data-testid="developer-ingestion-fetch-error" role="alert" className={CARD_CLASS}>
          <p className="text-sm leading-6 text-[color:var(--text-heading)]">
            {state.message} This says nothing about whether any document is actually stuck — it means the check itself
            failed.
          </p>
        </div>
        <CheckedAt fetchedAt={state.fetchedAt} />
      </div>
    );
  }

  const { active, completed, failed, other } = bucketJobs(state.jobs);

  return (
    <div data-testid="developer-ingestion-panel" className="grid gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {/*
         * `activeJobCount` renders exactly as the endpoint returned it, never
         * `active.length` — the endpoint counts before pagination truncates the
         * page, so the two can legitimately disagree, and the given number is
         * the one this page must not silently override.
         */}
        <CountTile testId="developer-ingestion-count-active" value={state.activeJobCount} label="active jobs" />
        {/*
         * #L15: this tile used to derive from `failed.length`, i.e. the
         * current page (`bucketJobs(state.jobs)`), so older failures beyond
         * the newest page vanished from the one number this page exists to
         * answer. `failedJobCount` is the server's pre-pagination full count,
         * same shape as `activeJobCount` above.
         */}
        <CountTile testId="developer-ingestion-count-failed" value={state.failedJobCount} label="failed jobs" />
        <CountTile testId="developer-ingestion-count-shown" value={state.jobs.length} label="jobs shown" />
      </div>

      <CheckedAt fetchedAt={state.fetchedAt} />

      {/*
       * The administrator source pilot is administrator-only (the page itself 404s
       * everyone else), so its one in-app entry lives here, behind the same
       * administrator sign-in this loaded state already proved.
       */}
      <Link
        href="/admin/pilot"
        data-testid="developer-ingestion-source-pilot-link"
        className="inline-flex min-h-12 w-fit items-center text-sm font-bold text-[color:var(--clinical-accent)] underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
      >
        Open the administrator source pilot
      </Link>

      {state.pagination && state.pagination.hasMore ? (
        <p data-testid="developer-ingestion-more-note" className={META_CLASS}>
          Showing the first {state.jobs.length} of {state.pagination.total} jobs.
        </p>
      ) : null}

      {state.jobs.length === 0 ? (
        <div data-testid="developer-ingestion-empty" className={CARD_CLASS}>
          <p className="text-sm leading-6 text-[color:var(--text-heading)]">No ingestion jobs.</p>
        </div>
      ) : (
        <>
          <JobSection
            testId="developer-ingestion-active"
            heading={`Active · ${state.activeJobCount}`}
            jobs={active}
            emptyNote="No jobs are pending or processing right now."
            retry={retryControls}
          />
          <JobSection
            testId="developer-ingestion-completed"
            heading={`Completed · ${completed.length}`}
            jobs={completed}
            emptyNote="No jobs have completed on this page."
            retry={retryControls}
          />
          <JobSection
            testId="developer-ingestion-failed"
            heading={`Failed · ${failed.length}`}
            jobs={failed}
            emptyNote="No jobs have failed on this page."
            retry={retryControls}
          />
          {other.length > 0 ? (
            <section
              aria-labelledby="developer-ingestion-other-heading"
              className="grid gap-3"
              data-testid="developer-ingestion-other"
            >
              <h2 id="developer-ingestion-other-heading" className={SECTION_HEADING_CLASS}>
                Other status · {other.length}
              </h2>
              <p className={META_CLASS}>
                These jobs carry a status this panel does not recognise. They are shown as they are rather than dropped,
                so together with the {active.length} active, {completed.length} completed and {failed.length} failed
                jobs above, nothing from this response goes unlisted.
              </p>
              <ul data-testid="developer-ingestion-other-list" className="grid gap-2">
                {other.map((job) => (
                  <JobRow key={job.id} job={job} retry={retryControls} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
