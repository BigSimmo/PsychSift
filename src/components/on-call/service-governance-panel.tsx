"use client";

import { ServiceStructuredPreview } from "@/components/on-call/service-structured-preview";

import { ExternalLink, Pencil } from "lucide-react";
import { useState } from "react";

import { cardSurface } from "@/components/card-recipes";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField } from "@/components/ui/form-field";
import { InlineNotice, cn, fieldControlPlain, textMuted } from "@/components/ui-primitives";
import type { ServiceAction, ServiceDetail, ServiceEntry, ServiceReport } from "@/lib/on-call/service-model";
import { formatOnCallDate } from "@/components/on-call/on-call-dates";

type ActionRunner = (action: ServiceAction) => Promise<Record<string, unknown>>;

function ReviewRow({
  entry,
  siteName,
  canReview,
  canEdit,
  onEdit,
  onAction,
}: {
  readonly entry: ServiceEntry;
  readonly siteName: string;
  readonly canReview: boolean;
  readonly canEdit: boolean;
  readonly onEdit: () => void;
  readonly onAction: ActionRunner;
}) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<"approve" | "return" | "withdraw" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmWithdrawOpen, setConfirmWithdrawOpen] = useState(false);

  async function review(decision: "approve" | "return") {
    if (busy || (decision === "return" && !comment.trim())) return;
    setBusy(decision);
    setError(null);
    try {
      await onAction({
        action: "entry.review",
        entryId: entry.id,
        expectedRevision: entry.revision,
        decision,
        comment: comment.trim(),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This review could not be recorded.");
    } finally {
      setBusy(null);
    }
  }

  async function withdraw() {
    if (busy) return;
    setBusy("withdraw");
    setError(null);
    try {
      await onAction({ action: "entry.withdraw", entryId: entry.id, expectedRevision: entry.revision });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This revision could not be withdrawn.");
    } finally {
      setBusy(null);
      setConfirmWithdrawOpen(false);
    }
  }

  return (
    <article className={cn(cardSurface, "grid gap-3 p-4")}>
      <div>
        <h4 className="break-words text-sm font-medium text-[color:var(--text-heading)]">{entry.content.title}</h4>
        <p className={cn(textMuted, "mt-0.5 text-xs")}>
          {siteName} · {entry.content.kind} · revision {entry.revision} · {entry.status.replace("_", " ")}
        </p>
      </div>
      {entry.content.body ? (
        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-[color:var(--text)]">
          {entry.content.body}
        </p>
      ) : null}
      <ServiceStructuredPreview content={entry.content} />
      {entry.content.sources.length > 0 ? (
        <div className="grid gap-1">
          {entry.content.sources.map((source) => (
            <a
              key={`${source.url}:${source.label}`}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-tap min-w-0 items-center gap-2 break-words text-sm font-semibold text-[color:var(--clinical-accent)]"
            >
              <ExternalLink aria-hidden="true" className="size-icon-sm shrink-0" />
              <span className="min-w-0 break-words">{source.label}</span>
            </a>
          ))}
        </div>
      ) : null}
      {entry.reviewComment ? (
        <InlineNotice tone="neutral">Previous review comment: {entry.reviewComment}</InlineNotice>
      ) : null}
      {entry.publishedContent ? (
        <InlineNotice tone="neutral">
          Members continue to see the previously approved revision while this revision is reviewed.
        </InlineNotice>
      ) : null}
      {canReview && entry.status === "pending_review" ? (
        <>
          <FormField
            label="Review comment"
            id={`service-review-${entry.id}`}
            hint="A return needs a reason. Approval may be left blank."
          >
            {(field) => (
              <textarea
                id={field.id}
                rows={3}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                className={cn(fieldControlPlain, "h-auto min-h-20 resize-y py-2")}
              />
            )}
          </FormField>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              variant="primary"
              busy={busy === "approve"}
              disabled={busy !== null}
              onClick={() => void review("approve")}
            >
              Approve revision
            </Button>
            <Button
              variant="secondary"
              busy={busy === "return"}
              disabled={busy !== null || !comment.trim()}
              onClick={() => void review("return")}
            >
              Return to author
            </Button>
          </div>
        </>
      ) : null}
      {(entry.status === "draft" || entry.status === "pending_review") && canEdit ? (
        <Button
          variant="ghost"
          busy={busy === "withdraw"}
          disabled={busy !== null}
          onClick={() => setConfirmWithdrawOpen(true)}
        >
          Withdraw entry from handbook
        </Button>
      ) : null}
      <ConfirmDialog
        open={confirmWithdrawOpen}
        onCancel={() => setConfirmWithdrawOpen(false)}
        onConfirm={() => void withdraw()}
        title="Withdraw entry"
        description={`Members will stop seeing "${entry.content.title}" in the service handbook, including any revision approved earlier.`}
        confirmLabel="Withdraw entry"
        busy={busy === "withdraw"}
        busyLabel="Withdrawing…"
      />
      {canEdit ? (
        <Button variant="secondary" icon={Pencil} onClick={onEdit} disabled={busy !== null}>
          Edit entry
        </Button>
      ) : null}
      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
    </article>
  );
}

function ReportRow({
  report,
  entryTitle,
  onAction,
}: {
  readonly report: ServiceReport;
  readonly entryTitle: string;
  readonly onAction: ActionRunner;
}) {
  const [resolution, setResolution] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve() {
    if (!resolution.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onAction({ action: "report.resolve", reportId: report.id, resolution: resolution.trim() });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This correction report could not be resolved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={cn(cardSurface, "grid gap-3 p-4")}>
      <div>
        <h4 className="break-words text-sm font-medium text-[color:var(--text-heading)]">{entryTitle}</h4>
        <p className={cn(textMuted, "mt-0.5 text-xs")}>Correction reported {formatOnCallDate(report.createdAt)}</p>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-[color:var(--text)]">{report.reason}</p>
      <FormField
        label="Resolution"
        id={`service-report-resolution-${report.id}`}
        hint="Record what was corrected or why no change was needed."
      >
        {(field) => (
          <textarea
            id={field.id}
            rows={3}
            value={resolution}
            onChange={(event) => setResolution(event.target.value)}
            className={cn(fieldControlPlain, "h-auto min-h-20 resize-y py-2")}
          />
        )}
      </FormField>
      <Button
        variant="primary"
        busy={busy}
        busyLabel="Resolving…"
        disabled={!resolution.trim()}
        onClick={() => void resolve()}
      >
        Resolve report
      </Button>
      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
    </article>
  );
}

export function ServiceGovernancePanel({
  detail,
  actorId,
  canEdit,
  onEdit,
  onAction,
}: {
  readonly detail: ServiceDetail;
  readonly actorId: string | null;
  readonly canEdit: boolean;
  readonly onEdit: (entry: ServiceEntry) => void;
  readonly onAction: ActionRunner;
}) {
  const reviewEntries = detail.entries.filter((entry) => entry.status === "pending_review" || entry.status === "draft");
  const openReports = detail.reports.filter((report) => report.status === "open");
  const entriesById = new Map(detail.entries.map((entry) => [entry.id, entry]));
  const sitesById = new Map(detail.sites.map((site) => [site.id, site.name]));

  return (
    <section aria-labelledby="service-governance-heading" className="grid gap-5" data-testid="service-governance">
      <div>
        <h2 id="service-governance-heading" className="text-lg font-semibold text-[color:var(--text-heading)]">
          Review and corrections
        </h2>
        <p className={cn(textMuted, "mt-1 text-sm leading-6")}>
          Clinical and legal revisions stay out of the member handbook until an independent reviewer approves them.
        </p>
      </div>

      <section aria-labelledby="service-review-queue-heading" className="grid gap-3">
        <h3 id="service-review-queue-heading" className="text-sm font-semibold text-[color:var(--text-heading)]">
          Editorial queue
        </h3>
        {reviewEntries.length === 0 ? (
          <p className={cn(textMuted, "text-sm")}>No drafts or revisions are waiting.</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {reviewEntries.map((entry) => (
              <ReviewRow
                key={`${entry.id}:${entry.revision}`}
                entry={entry}
                siteName={
                  entry.content.siteId ? (sitesById.get(entry.content.siteId) ?? "Selected site") : "Service-wide"
                }
                canReview={detail.membership.clinicalReviewer && actorId !== null && actorId !== entry.authorId}
                canEdit={canEdit}
                onEdit={() => onEdit(entry)}
                onAction={onAction}
              />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="service-corrections-heading" className="grid gap-3">
        <h3 id="service-corrections-heading" className="text-sm font-semibold text-[color:var(--text-heading)]">
          Incorrect-entry reports
        </h3>
        {openReports.length === 0 ? (
          <p className={cn(textMuted, "text-sm")}>No correction reports are open.</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {openReports.map((report) => (
              <ReportRow
                key={report.id}
                report={report}
                entryTitle={entriesById.get(report.entryId)?.content.title ?? "Handbook entry"}
                onAction={onAction}
              />
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
