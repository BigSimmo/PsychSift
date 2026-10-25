"use client";

import Link from "next/link";
import { Activity, ExternalLink, Loader2, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";

import { StatusBadge } from "@/components/clinical-dashboard/badges";
import { cleanDisplayTitle } from "@/components/clinical-dashboard/display-text";
import {
  fallbackSetupChecks,
  type IngestionQualityReviewItem,
  type IngestionQualityReviewType,
  type SetupCheck,
  type SetupCheckStatus,
} from "@/components/clinical-dashboard/document-manager-contracts";
import {
  cn,
  EmptyState,
  floatingControl,
  metadataPillDensity,
  panelSubtle,
  sourceCard,
  textMuted,
  toneDanger,
  toneInfo,
  toneNeutral,
  toneSuccess,
  toneWarning,
} from "@/components/ui-primitives";
import { announce } from "@/components/ui/live-announcer";
import type { ImportBatch, IngestionJob } from "@/lib/types";
import { emptyStates } from "@/lib/ui-copy";

export {
  fallbackSetupChecks,
  hasReadyPublicSearchSetup,
  hasReadyRequiredPublicSearchConfig,
} from "@/components/clinical-dashboard/document-manager-contracts";
export type {
  IngestionQualityReviewItem,
  IngestionQualityReviewType,
  SetupCheck,
  SetupCheckStatus,
} from "@/components/clinical-dashboard/document-manager-contracts";

export type IndexingMonitorFilter = "all" | "active" | "failed";

function setupBadgeClasses(status: SetupCheckStatus) {
  if (status === "ready") return toneSuccess;
  if (status === "needs_setup") return toneWarning;
  return toneNeutral;
}

function setupBadgeLabel(status: SetupCheckStatus) {
  if (status === "ready") return "Ready";
  if (status === "needs_setup") return "Needs setup";
  return "Unknown";
}

export function SetupChecklist({ checks }: { checks: SetupCheck[] }) {
  const items = checks.length > 0 ? checks : fallbackSetupChecks;

  return (
    <div className={cn(panelSubtle, "p-3")}>
      <p className="text-sm font-semibold text-[color:var(--text)]">First-run setup checklist</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.id} className={cn(sourceCard, "min-h-10 px-3 py-2")}>
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="min-w-0 truncate text-xs font-semibold text-[color:var(--text)]">{item.label}</span>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-2xs font-bold",
                  setupBadgeClasses(item.status),
                )}
              >
                {setupBadgeLabel(item.status)}
              </span>
            </div>
            <p className={cn("mt-1 line-clamp-2 text-xs leading-5", textMuted)}>{item.detail}</p>
          </div>
        ))}
      </div>
      <p className={cn("mt-3 text-xs leading-5", textMuted)}>
        Setup status is read-only and never exposes secret values. Worker status is inferred from recent ingestion
        activity.
      </p>
    </div>
  );
}

function jobDocumentTitle(job: IngestionJob) {
  return job.documents?.title ?? job.documents?.file_name ?? "Document";
}

/**
 * Announces a job only when it finishes or fails. Each row used to carry its own
 * polite live region with the percentage, so every poll during a batch queued an
 * announcement per row for up to ten rows. The progress bar already exposes the
 * value on demand; the transitions are what a screen-reader user needs to hear.
 */
function useJobOutcomeAnnouncements(jobs: IngestionJob[]) {
  const previousStatus = useRef<Map<string, IngestionJob["status"]> | null>(null);
  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = new Map(jobs.map((job) => [job.id, job.status]));
    // The first list is what was already there, not a change.
    if (!previous) return;
    for (const job of jobs) {
      const before = previous.get(job.id);
      if (before === undefined || before === job.status) continue;
      if (job.status === "completed") announce(`${jobDocumentTitle(job)}: indexing completed`);
      else if (job.status === "failed") announce(`${jobDocumentTitle(job)}: indexing failed`);
    }
  }, [jobs]);
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function IndexingMonitor({
  jobs,
  batches,
  filter,
  actionId,
  onRetry,
  onReindex,
  onEnrich,
}: {
  jobs: IngestionJob[];
  batches: ImportBatch[];
  filter: IndexingMonitorFilter;
  actionId: string | null;
  onRetry: (jobId: string) => void;
  onReindex: (documentId: string) => void;
  onEnrich: (documentId: string) => void;
}) {
  useJobOutcomeAnnouncements(jobs);
  const visibleJobs = jobs.filter((job) => indexingWorkMatchesFilter(job, filter));
  const visibleBatches = batches.filter((batch) => indexingWorkMatchesFilter(batch, filter));
  const filterTitle =
    filter === "active" ? "Active indexing work" : filter === "failed" ? "Failed indexing work" : "All indexing work";

  if (visibleJobs.length === 0 && visibleBatches.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title={
          filter === "failed"
            ? emptyStates.ingestionJobs.noneFailed
            : filter === "active"
              ? emptyStates.ingestionJobs.noneActive
              : emptyStates.ingestionJobs.none
        }
        body={
          filter === "failed"
            ? "Failed jobs and batches appear here when indexing needs review."
            : filter === "active"
              ? "Queued and processing jobs appear here while indexing is running."
              : "Queued ingestion work and worker progress appear here."
        }
        live="polite"
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className={cn(panelSubtle, "p-3")}>
        <p className="text-sm font-semibold text-[color:var(--text)]">{filterTitle}</p>
        <p className={cn("mt-1 text-xs", textMuted)}>
          {visibleJobs.length} job{visibleJobs.length === 1 ? "" : "s"} · {visibleBatches.length} batch
          {visibleBatches.length === 1 ? "" : "es"}
        </p>
      </div>

      {visibleBatches.slice(0, 3).map((batch) => (
        <div key={batch.id} className={cn(panelSubtle, "p-3")}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[color:var(--text)]">{batch.name}</p>
              <p className={cn("mt-1 text-xs leading-5", textMuted)}>
                {batch.total_files} files · {formatBytes(batch.total_bytes)} · {batch.queued_files} queued ·{" "}
                {batch.skipped_files} exact copies skipped · {batch.failed_files} failed
              </p>
            </div>
            <StatusBadge status={batch.status} />
          </div>
        </div>
      ))}

      <p className={cn("text-xs leading-5", textMuted)}>
        Keep `npm run worker` open while jobs are pending or processing. Failed jobs can be retried after fixing the
        cause.
      </p>

      {visibleJobs.slice(0, 10).map((job) => {
        const documentTitle = jobDocumentTitle(job);
        const busy = actionId === job.id || actionId === job.document_id;
        return (
          <div key={job.id} className={cn(panelSubtle, "p-3")}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[color:var(--text)]">{documentTitle}</p>
                <p className={cn("mt-1 truncate text-xs", textMuted)}>{job.stage}</p>
              </div>
              <StatusBadge status={job.status} />
            </div>
            <div
              role="progressbar"
              aria-label={`${documentTitle} indexing progress`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={job.progress}
              className="mt-3 h-2 overflow-hidden rounded-full bg-[color:var(--surface-inset)]"
            >
              <div className="h-full rounded-full bg-[color:var(--primary)]" style={{ width: `${job.progress}%` }} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className={cn("text-xs", textMuted)}>
                Attempt {job.attempt_count ?? 0}/{job.max_attempts ?? 3}
              </span>
              {job.status === "failed" && (
                <button
                  type="button"
                  onClick={() => onRetry(job.id)}
                  disabled={busy}
                  className={cn(floatingControl, "px-3 text-xs")}
                >
                  {busy ? (
                    <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw aria-hidden="true" className="h-4 w-4" />
                  )}
                  Retry
                </button>
              )}
              <button
                type="button"
                onClick={() => onReindex(job.document_id)}
                disabled={busy || job.status === "processing"}
                className={cn(floatingControl, "px-3 text-xs")}
              >
                {busy ? (
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw aria-hidden="true" className="h-4 w-4" />
                )}
                Reindex
              </button>
              <button
                type="button"
                onClick={() => onEnrich(job.document_id)}
                disabled={busy || job.status === "processing"}
                className={cn(floatingControl, "px-3 text-xs")}
              >
                {busy ? (
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles aria-hidden="true" className="h-4 w-4" />
                )}
                Enrich
              </button>
            </div>
            {job.error_message && (
              <p className={cn("mt-2 line-clamp-2 text-xs leading-5", textMuted)}>{job.error_message}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

const qualityReviewLabels: Record<IngestionQualityReviewType, string> = {
  failed_ocr: "OCR",
  low_extraction_confidence: "Extraction",
  missing_tables: "Tables",
  image_only_pages: "Image-only",
  failed_job: "Failed job",
  manual_review: "Manual review",
};

function qualityReviewTone(severity: IngestionQualityReviewItem["severity"]) {
  if (severity === "danger") return toneDanger;
  if (severity === "warning") return toneWarning;
  return toneInfo;
}

export function IngestionQualityConsole({
  items,
  actionId,
  onRetry,
  onReindex,
  onEnrich,
}: {
  items: IngestionQualityReviewItem[];
  actionId: string | null;
  onRetry: (jobId: string) => void;
  onReindex: (documentId: string) => void;
  onEnrich: (documentId: string) => void;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title={emptyStates.ingestionQuality.title}
        body={emptyStates.ingestionQuality.body}
        live="polite"
      />
    );
  }

  const counts = items.reduce<Record<IngestionQualityReviewType, number>>(
    (current, item) => ({ ...current, [item.type]: current[item.type] + 1 }),
    {
      failed_ocr: 0,
      low_extraction_confidence: 0,
      missing_tables: 0,
      image_only_pages: 0,
      failed_job: 0,
      manual_review: 0,
    },
  );

  return (
    <div className="space-y-3">
      <div className={cn(panelSubtle, "p-3")}>
        <p className="text-sm font-semibold text-[color:var(--text)]">Ingestion quality review</p>
        <p className={cn("mt-1 text-xs leading-5", textMuted)}>
          {items.length} item{items.length === 1 ? "" : "s"} need manual review across the loaded library.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(Object.keys(counts) as IngestionQualityReviewType[]).map((type) => (
            <span key={type} className={metadataPillDensity.dense}>
              {qualityReviewLabels[type]}: {counts[type]}
            </span>
          ))}
        </div>
      </div>

      <div className="grid gap-2">
        {items.slice(0, 12).map((item) => {
          const busy = actionId === item.jobId || actionId === item.documentId;
          return (
            <article key={item.id} className={cn(sourceCard, "p-3")}>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn(metadataPillDensity.compact, qualityReviewTone(item.severity))}>
                      {qualityReviewLabels[item.type]}
                    </span>
                    {item.qualityScore !== null ? (
                      <span className={cn(metadataPillDensity.compact, "nums")}>
                        index {item.qualityScore.toFixed(2)}
                      </span>
                    ) : null}
                    {item.extractionQuality ? (
                      <span className={metadataPillDensity.compact}>extraction:{item.extractionQuality}</span>
                    ) : null}
                  </div>
                  <p className="mt-2 truncate text-sm font-semibold text-[color:var(--text)]">
                    {cleanDisplayTitle(item.documentTitle)}
                  </p>
                  <p className={cn("mt-1 text-xs leading-5", textMuted)}>
                    {item.title}: {item.detail}
                  </p>
                  {item.reasons.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {item.reasons.slice(0, 4).map((reason) => (
                        <span key={reason} className={metadataPillDensity.dense}>
                          {reason}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/documents/${item.documentId}`} className={cn(floatingControl, "px-3 text-xs")}>
                    <ExternalLink aria-hidden="true" className="h-4 w-4" />
                    Open
                  </Link>
                  {item.jobId ? (
                    <button
                      type="button"
                      onClick={() => item.jobId && onRetry(item.jobId)}
                      disabled={busy}
                      className={cn(floatingControl, "px-3 text-xs")}
                    >
                      {busy ? (
                        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw aria-hidden="true" className="h-4 w-4" />
                      )}
                      Retry
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onReindex(item.documentId)}
                    disabled={busy}
                    className={cn(floatingControl, "px-3 text-xs")}
                  >
                    {busy ? (
                      <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw aria-hidden="true" className="h-4 w-4" />
                    )}
                    Reindex
                  </button>
                  <button
                    type="button"
                    onClick={() => onEnrich(item.documentId)}
                    disabled={busy}
                    className={cn(floatingControl, "px-3 text-xs")}
                  >
                    {busy ? (
                      <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles aria-hidden="true" className="h-4 w-4" />
                    )}
                    Enrich
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function indexingWorkMatchesFilter(item: Pick<IngestionJob | ImportBatch, "status">, filter: IndexingMonitorFilter) {
  if (filter === "all") return true;
  if (filter === "active") return item.status === "pending" || item.status === "processing" || item.status === "queued";
  return item.status === "failed";
}
