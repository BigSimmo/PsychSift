"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useCmeSample } from "@/components/cme/cme-sample-context";
import { CmeEntryForm, type CmeEntryDraft, type CmeEntryFormProps } from "@/components/cme/cme-entry-form";
import { CME_NEW_ENTRY_DRAFT_KEY } from "@/components/cme/cme-new-entry-route";
import { CME_SAVED_NOTICE_MS, CmeSavedLogNotice } from "@/components/cme/cme-saved-log-notice";
import { Sheet } from "@/components/ui/sheet";
import { cn, InlineNotice, primaryControl, textMuted } from "@/components/ui-primitives";
import type { CmeDraftPayload } from "@/lib/cme/drafts";
import { cmeSaveErrorText } from "@/lib/cme/load-state";
import { routinesDueOn, type CmeRoutine } from "@/lib/cme/routines";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";
import { perthCalendarDate } from "@/lib/perth-time";
type InitialEntry = NonNullable<CmeEntryFormProps["initialEntry"]>;
type LogAgainChoice = { id: string; label: string; detail: string; entry: InitialEntry };

/** Due routines first, then recent distinct titles. No choice records anything. */
function logAgainChoices(
  routines: readonly CmeRoutine[],
  entries: readonly CmeEntry[],
  now: Date,
  date: string,
): LogAgainChoice[] {
  const dueIds = new Set(routinesDueOn(routines, now).map(({ id }) => id));
  const activeRoutines = routines
    .filter(({ archivedAt }) => !archivedAt)
    .sort((a, b) => Number(dueIds.has(b.id)) - Number(dueIds.has(a.id)));
  const choices: LogAgainChoice[] = activeRoutines.map((routine) => ({
    id: `routine-${routine.id}`,
    label: routine.title,
    detail: dueIds.has(routine.id) ? "Routine due" : "Routine",
    entry: {
      date,
      title: routine.title,
      sourceUrl: null,
      allocations: routine.usualAllocations,
      reflection: "",
      costCents: null,
      routineId: routine.id,
      documentId: null,
      buckets: [],
      formalPeerReviewHours: 0,
    },
  }));
  const seen = new Set(choices.map(({ label }) => label.trim().toLocaleLowerCase("en-AU")));
  for (const entry of [...entries]
    .filter((item) => !item.archivedAt && item.date.startsWith(date.slice(0, 4)))
    .sort((a, b) => b.date.localeCompare(a.date))) {
    const key = entry.title.trim().toLocaleLowerCase("en-AU");
    if (seen.has(key)) continue;
    seen.add(key);
    choices.push({
      id: `entry-${entry.id}`,
      label: entry.title,
      detail: "Logged before",
      entry: {
        date,
        title: entry.title,
        sourceUrl: entry.sourceUrl ?? null,
        allocations: entry.allocations,
        reflection: "",
        costCents: null,
        routineId: null,
        documentId: null,
        buckets: entry.buckets,
        formalPeerReviewHours: 0,
      },
    });
    if (choices.length >= 5) break;
  }
  return choices.slice(0, 5);
}

async function quickLogSaveError(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (payload && typeof payload === "object") {
      const { message, error } = payload as { message?: unknown; error?: unknown };
      if (typeof message === "string" && message.trim()) return message;
      if (typeof error === "string" && error.trim()) return error;
    }
  } catch {
    // Not JSON. Fall through to the status line.
  }
  return `Could not save this entry (${response.status}).`;
}

/**
 * The "+ Log" button and the panel it opens: the quickest way to record an
 * activity from wherever the owner already is in CME.
 *
 * The panel is the same `CmeEntryForm` as the full new-entry page — the same
 * validation, the same single-category shortcut, the same draft kept for the
 * tab — so the two can never disagree about what a valid entry is. It saves
 * with one POST to `/api/cme/entries`, closes, refreshes the page underneath
 * so totals move at once, and says "Saved to your log".
 *
 * The button is fixed bottom-right, clear of the phone's home indicator. CME
 * pages have no bottom search dock, so it never sits on top of a composer.
 */
export function CmeQuickLog({
  set,
  routines = [],
  entries = [],
  nowIso,
  demoMode = false,
}: {
  set: CmeRequirementSet;
  routines?: readonly CmeRoutine[];
  entries?: readonly CmeEntry[];
  nowIso?: string;
  demoMode?: boolean;
}) {
  const router = useRouter();
  const sample = useCmeSample();
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [selected, setSelected] = useState<InitialEntry | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [actionContainer, setActionContainer] = useState<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const domains = set.requirements.flatMap((requirement) =>
    requirement.spec.shape === "activity-count" ? [...requirement.spec.buckets] : [],
  );
  const now = nowIso ? new Date(nowIso) : new Date();
  const today = perthCalendarDate(now);
  const initialDate = today.startsWith(`${set.year}-`) ? today : `${set.year}-01-01`;
  const choices = logAgainChoices(routines, entries, now, initialDate);

  useEffect(() => {
    if (savedNotice === null) return;
    const timer = window.setTimeout(() => setSavedNotice(null), CME_SAVED_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [savedNotice]);

  async function saveEntry(entry: CmeEntryDraft) {
    if (demoMode) throw new Error("Demo mode is read-only. Sign in to save this activity to a private CPD record.");
    const response = await fetch("/api/cme/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...entry, requestId }),
    });
    if (!response.ok) throw new Error(await quickLogSaveError(response));
    const payload = (await response.json().catch(() => null)) as { entry?: { id?: string } } | null;
    setOpen(false);
    setSavedNotice(payload?.entry?.id ?? "");
    setUndoError(null);
    setSelected(null);
    // A fresh request id per saved entry: the API treats a repeated id as the
    // same save, which is what protects a double tap, not a second activity.
    setRequestId(crypto.randomUUID());
    setFormKey((key) => key + 1);
    router.refresh();
  }

  async function undo() {
    if (!savedNotice || undoing) return;
    setUndoing(true);
    setUndoError(null);
    try {
      const response = await fetch(`/api/cme/entries/${savedNotice}`, { method: "DELETE" });
      if (!response.ok) throw new Error(`Could not undo this activity (${response.status}).`);
      setSavedNotice(null);
      router.refresh();
    } catch (error) {
      setUndoError(cmeSaveErrorText(error, "Could not undo this activity."));
    } finally {
      setUndoing(false);
    }
  }

  async function saveDraft(payload: CmeDraftPayload) {
    if (demoMode) throw new Error("Demo mode is read-only. Sign in to keep a private draft.");
    const response = await fetch("/api/cme/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload, waitingOn: null, waitingNote: null, followUpOn: null }),
    });
    if (!response.ok) throw new Error(await quickLogSaveError(response));
    setOpen(false);
    setSelected(null);
    setFormKey((key) => key + 1);
    router.push("/cme/log?tab=finish#cme-drafts");
    router.refresh();
  }

  return (
    <>
      <CmeSavedLogNotice entryId={savedNotice} undoing={undoing} undoError={undoError} onUndo={() => void undo()} />

      <button
        ref={buttonRef}
        type="button"
        data-testid="cme-quick-log-button"
        onClick={() => setOpen(true)}
        className={cn(
          primaryControl,
          "fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-[var(--z-chrome)] rounded-full shadow-[var(--e4)] print:hidden",
        )}
      >
        <Plus aria-hidden="true" className="size-icon-sm" />
        Log
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Log an activity"
        placement="responsive-right"
        mobilePlacement="bottom"
        footer={<div ref={setActionContainer} data-testid="cme-quick-log-actions" />}
        footerClassName="pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        returnFocusRef={buttonRef}
        testId="cme-quick-log-sheet"
      >
        <div className="flex flex-col gap-4 pb-2">
          {demoMode ? (
            <InlineNotice tone="neutral">
              Demo mode lets you try the form. Saving is available only in your signed-in private record.
            </InlineNotice>
          ) : null}
          {choices.length > 0 ? (
            <div data-testid="cme-log-again" className="grid gap-1">
              <p className={cn(textMuted, "text-xs")}>Log again</p>
              {choices.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  onClick={() => {
                    setSelected(choice.entry);
                    setFormKey((key) => key + 1);
                  }}
                  className="flex min-h-tap items-center justify-between gap-3 rounded-lg border border-[color:var(--border)] px-3 text-left text-sm text-[color:var(--text)]"
                >
                  <span className="truncate">{choice.label}</span>
                  <span className={cn(textMuted, "shrink-0 text-xs")}>{choice.detail}</span>
                </button>
              ))}
            </div>
          ) : null}
          <CmeEntryForm
            key={formKey}
            onSubmit={saveEntry}
            initialEntry={
              selected ?? {
                date: initialDate,
                title: "",
                sourceUrl: null,
                allocations: [],
                reflection: "",
                costCents: null,
                routineId: null,
                documentId: null,
                buckets: [],
                formalPeerReviewHours: 0,
              }
            }
            existingEntries={entries}
            initialStatedHours={undefined}
            availableDomains={domains}
            draftStorageKey={selected || sample ? undefined : CME_NEW_ENTRY_DRAFT_KEY}
            stickySave={false}
            actionContainer={actionContainer}
            onSaveDraft={demoMode ? undefined : saveDraft}
          />
          <p className={cn(textMuted, "text-center text-xs")}>
            Prefer more room?{" "}
            <Link
              href={`/cme/new?year=${set.year}`}
              data-cme-keeps-draft=""
              className="inline-flex min-h-tap items-center font-semibold text-[color:var(--clinical-accent)] underline underline-offset-2"
            >
              Open the full page
            </Link>{" "}
            — anything typed here comes with you.
          </p>
        </div>
      </Sheet>
    </>
  );
}
