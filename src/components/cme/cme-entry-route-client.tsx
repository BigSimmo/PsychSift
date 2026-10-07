"use client";

import { CmeEvidencePanel } from "@/components/cme/cme-evidence-panel";
import { Archive, ArchiveRestore } from "lucide-react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { CmeEntryForm, type CmeEntryDraft } from "@/components/cme/cme-entry-form";
import { CmeEntryGoalPicker } from "@/components/cme/cme-entry-goal-picker";
import type { CmePlanGoal } from "@/lib/cme/plan-goals";
import { cmeEntryActionRow, CmeEntryPage } from "@/components/cme/cme-entry-page";
import { FormField } from "@/components/ui/form-field";
import {
  cn,
  fieldControlPlain,
  ignoreUnavailableActivation,
  InlineNotice,
  textMuted,
} from "@/components/ui-primitives";
import { CME_AMENDMENT_REASON_MAX, CME_AMENDMENT_REASON_MIN } from "@/lib/cme/year-close";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";

export type CmeEntryRouteClientProps = {
  readonly entry: CmeEntry | null;
  readonly set: CmeRequirementSet;
  readonly edit: boolean;
  readonly demoMode: boolean;
  /** The year's development-plan goals, for "which goal did this serve?". */
  readonly goals?: readonly CmePlanGoal[];
};

async function responseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown; message?: unknown };
    if (typeof payload.message === "string") return payload.message;
    if (typeof payload.error === "string") return payload.error;
  } catch {
    // Not JSON. Fall through to the status line below.
  }
  return `Could not update this entry (${response.status}).`;
}

function updatePayload(entry: CmeEntry, draft: CmeEntryDraft, transcribed = entry.transcribed) {
  return {
    date: draft.date,
    title: draft.title,
    allocations: draft.allocations,
    reflection: draft.reflection,
    costCents: draft.costCents,
    routineId: draft.routineId,
    documentId: draft.documentId,
    sourceUrl: draft.sourceUrl ?? null,
    buckets: draft.buckets,
    formalPeerReviewHours: draft.formalPeerReviewHours ?? 0,
    transcribed,
  };
}

export function CmeEntryRouteClient({ entry, set, edit, demoMode, goals = [] }: CmeEntryRouteClientProps) {
  const router = useRouter();
  const [archivePending, setArchivePending] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveOverride, setArchiveOverride] = useState<boolean | null>(null);
  const [archiveUndoOpen, setArchiveUndoOpen] = useState(false);
  const [confirmArchiveOpen, setConfirmArchiveOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [amendmentReason, setAmendmentReason] = useState("");
  useEffect(() => {
    if (!archiveUndoOpen) return;
    const timer = window.setTimeout(() => setArchiveUndoOpen(false), 6000);
    return () => window.clearTimeout(timer);
  }, [archiveUndoOpen]);
  const domains = set.requirements.flatMap((requirement) =>
    requirement.spec.shape === "activity-count" ? [...requirement.spec.buckets] : [],
  );

  if (!entry) return <CmeEntryPage entryId="missing" entries={[]} set={set} />;
  const archived = archiveOverride ?? Boolean(entry.archivedAt);
  const loadedEntry = { ...entry, archivedAt: archived ? (entry.archivedAt ?? "archived") : null };
  const readOnly = Boolean(set.closedAt) || archived;
  // A closed year's activities are corrected by a dated amendment with a reason, never by an
  // ordinary edit; the closing snapshot is untouched either way.
  const amendable = Boolean(set.closedAt) && !archived;

  async function patchEntry(payload: object) {
    if (demoMode) throw new Error("Demo mode is read-only. Sign in to update a private CPD record.");
    const response = await fetch(`/api/cme/entries/${loadedEntry.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(await responseError(response));
  }

  if (edit && (!readOnly || amendable)) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6" data-testid="cme-entry-edit">
        <button
          type="button"
          onClick={() => {
            if (!dirty || window.confirm("Discard your unsaved changes?")) router.push(`/cme/log/${loadedEntry.id}`);
          }}
          className="inline-flex min-h-tap items-center text-sm font-semibold text-[color:var(--clinical-accent)]"
        >
          Cancel editing
        </button>
        <h1 className="mt-3 text-xl font-semibold text-[color:var(--text)]">
          {amendable ? "Amend activity" : "Edit activity"}
        </h1>
        <p className={cn(textMuted, "mt-1 text-sm")}>
          {amendable
            ? `${set.year} is closed. Your change is recorded as a dated amendment with your reason, beside the original. The closing snapshot does not change.`
            : "Review the whole record before saving. Cancel, link navigation, closing and reloading all guard unsaved changes."}
        </p>
        {amendable ? (
          <div className="mt-4">
            <FormField
              label="Reason for this amendment"
              id="cme-entry-amendment-reason"
              required
              hint="For example: the certificate shows 4 hours, not 2."
            >
              {(field) => (
                <textarea
                  id={field.id}
                  aria-describedby={field.describedBy}
                  rows={2}
                  maxLength={CME_AMENDMENT_REASON_MAX}
                  value={amendmentReason}
                  onChange={(event) => setAmendmentReason(event.target.value)}
                  className={cn(fieldControlPlain, "h-auto min-h-16 resize-y py-2 leading-6")}
                />
              )}
            </FormField>
          </div>
        ) : null}
        {demoMode ? (
          <div className="mt-4">
            <InlineNotice tone="neutral">Demo mode is read-only. The form is shown for inspection.</InlineNotice>
          </div>
        ) : null}
        <div className="mt-6">
          <CmeEntryForm
            initialEntry={loadedEntry}
            availableDomains={domains}
            submitLabel={amendable ? "Record amendment" : "Save changes"}
            onDirtyChange={setDirty}
            onSubmit={async (draft) => {
              if (amendable) {
                const reason = amendmentReason.trim();
                if (reason.length < CME_AMENDMENT_REASON_MIN) {
                  throw new Error("Give a reason for this amendment before recording it.");
                }
                await patchEntry({ ...updatePayload(loadedEntry, draft), amendmentReason: reason });
              } else {
                await patchEntry(updatePayload(loadedEntry, draft));
              }
              router.push(`/cme/log/${loadedEntry.id}`);
              router.refresh();
            }}
          />
        </div>
      </main>
    );
  }

  async function setArchived(next: boolean) {
    setArchivePending(true);
    setArchiveError(null);
    try {
      await patchEntry({ archived: next });
      setArchiveOverride(next);
      setArchiveUndoOpen(next);
      router.refresh();
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : "Could not change archive status.");
    } finally {
      setArchivePending(false);
    }
  }

  return (
    <>
      <CmeEntryPage
        entryId={loadedEntry.id}
        entries={[loadedEntry]}
        set={set}
        editHref={!readOnly || amendable ? `/cme/log/${loadedEntry.id}?edit=1` : undefined}
        editLabel={amendable ? "Amend entry" : undefined}
        readOnly={readOnly}
        // Archive and restore live in the header's actions sheet. Archiving
        // asks first; restoring does not. Both are reversible, but archiving
        // takes the activity out of this year's totals, so it is never a
        // control sitting loose on the page where a stray tap reaches it.
        menuActions={(close) => {
          // Demo mode and a closed year are stated reasons, so the row stays
          // focusable with the reason wired to it; a save in flight is
          // transient, so that alone uses native `disabled`.
          const unavailableReason = demoMode
            ? "Sign in to archive or restore activities."
            : set.closedAt
              ? "This CPD year is closed, so its activities can't be archived or restored."
              : null;
          const label = (
            <>
              {archived ? (
                <ArchiveRestore
                  aria-hidden="true"
                  className="size-icon-sm shrink-0 text-[color:var(--clinical-accent)]"
                />
              ) : (
                <Archive aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--clinical-accent)]" />
              )}
              {archivePending ? "Saving…" : archived ? "Restore entry" : "Archive entry"}
            </>
          );
          if (unavailableReason) {
            return (
              <>
                <button
                  type="button"
                  aria-disabled="true"
                  aria-describedby="cme-entry-archive-unavailable"
                  title={unavailableReason}
                  onClick={ignoreUnavailableActivation}
                  className={cmeEntryActionRow}
                >
                  {label}
                </button>
                <span id="cme-entry-archive-unavailable" className="sr-only">
                  {unavailableReason}
                </span>
              </>
            );
          }
          return (
            <button
              type="button"
              disabled={archivePending}
              onClick={() => {
                close();
                if (archived) void setArchived(false);
                else setConfirmArchiveOpen(true);
              }}
              className={cmeEntryActionRow}
            >
              {label}
            </button>
          );
        }}
        notice={
          readOnly || (archived && archiveUndoOpen) || archiveError ? (
            <section aria-label="Archive activity" className="flex flex-col gap-2">
              {readOnly ? (
                <p className={cn(textMuted, "text-sm")}>
                  {set.closedAt
                    ? "This CPD year is closed. Correct an activity with Amend entry: the change is recorded, dated and with your reason, beside the original. Evidence is view-only."
                    : "Archived: excluded from totals, copies, exports and annual summaries. Sources and evidence are retained."}
                </p>
              ) : null}
              {archived && archiveUndoOpen ? (
                <p role="status" className="text-sm text-[color:var(--text)]">
                  Activity archived.{" "}
                  <button
                    type="button"
                    disabled={archivePending}
                    onClick={() => void setArchived(false)}
                    className="min-h-tap font-semibold underline underline-offset-2"
                  >
                    Undo archive
                  </button>
                </p>
              ) : null}
              {archiveError ? (
                <p role="alert" className="text-sm">
                  {archiveError}
                </p>
              ) : null}
            </section>
          ) : null
        }
        actions={
          <>
            <section className="mt-4" aria-label="Plan goal">
              <CmeEntryGoalPicker
                entryId={loadedEntry.id}
                goals={goals}
                initialGoalId={loadedEntry.goalId ?? null}
                readOnly={demoMode || readOnly}
              />
            </section>
            <ConfirmDialog
              open={confirmArchiveOpen}
              onCancel={() => setConfirmArchiveOpen(false)}
              onConfirm={() => {
                setConfirmArchiveOpen(false);
                void setArchived(true);
              }}
              title="Archive this activity?"
              description="It stops counting toward this year's hours and is left out of copies, exports and the annual summary. Its sources and evidence are kept, and you can restore it at any time."
              confirmLabel="Archive activity"
              tone="primary"
            />
          </>
        }
        onCopied={async () => {
          if (demoMode) throw new Error("Demo mode is read-only.");
          const response = await fetch(`/api/cme/entries/${loadedEntry.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transcribed: true }),
          });
          if (!response.ok) throw new Error(await responseError(response));
        }}
      >
        <CmeEvidencePanel
          key={loadedEntry.id}
          entryId={loadedEntry.id}
          readOnly={demoMode || readOnly}
          demoMode={demoMode}
        />
      </CmeEntryPage>
    </>
  );
}
