"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { CmeDateField, useCmeDateChecks } from "@/components/cme/cme-date-field";
import { useCmeOneTapRoutineLog } from "@/components/cme/cme-one-tap-routine-log";
import { cmeRoutineLogHref } from "@/components/cme/cme-route-navigation";
import { CmeRoutinesPage } from "@/components/cme/cme-routines-page";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { useDirtyStateGuard } from "@/components/ui/use-dirty-state-guard";
import { cn, InlineNotice, textMuted } from "@/components/ui-primitives";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import { cmeSaveErrorText } from "@/lib/cme/load-state";
import { cpdTitlePatientProblem } from "@/lib/cme/patient-detail-check";
import {
  cmeRoutineCadenceLabels,
  cmeRoutineCadences,
  type CmeRoutine,
  type CmeRoutineCadence,
} from "@/lib/cme/routines";

type RoutineDraft = Omit<CmeRoutine, "id">;

const emptyDraft: RoutineDraft = {
  title: "",
  cadence: "monthly",
  usualHours: 1,
  usualAllocations: [],
  nextDue: null,
  archivedAt: null,
};

async function apiError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: unknown; message?: unknown } | null;
  if (typeof payload?.message === "string") return payload.message;
  if (typeof payload?.error === "string") return payload.error;
  return `Could not save this routine (${response.status}).`;
}

/** A 2xx reply must still carry the saved routine; otherwise the editor stays open with an error. */
async function savedRoutine(response: Response, failure: string): Promise<CmeRoutine> {
  const payload = (await response.json().catch(() => null)) as { routine?: CmeRoutine } | null;
  const routine = payload?.routine;
  if (!routine || typeof routine !== "object" || typeof routine.id !== "string") throw new Error(failure);
  return routine;
}

export function CmeRoutinesRoute({
  nowIso,
  initialRoutines,
  demoMode,
}: {
  readonly nowIso: string;
  readonly initialRoutines: readonly CmeRoutine[];
  readonly demoMode: boolean;
}) {
  const router = useRouter();
  const oneTap = useCmeOneTapRoutineLog({ demoMode });
  const [routines, setRoutines] = useState<CmeRoutine[]>(() => [...initialRoutines]);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<RoutineDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDirty = useMemo(() => {
    if (!editingId) return false;
    if (editingId === "new") return Boolean(draft.title.trim());
    const original = routines.find((r) => r.id === editingId);
    if (!original) return false;
    return (
      draft.title.trim() !== original.title.trim() ||
      draft.cadence !== original.cadence ||
      draft.usualHours !== original.usualHours ||
      (draft.nextDue || null) !== (original.nextDue || null)
    );
  }, [editingId, draft, routines]);
  useDirtyStateGuard(isDirty && !demoMode);
  const dateChecks = useCmeDateChecks();
  // The form renders above the list, so on a phone tapping Edit on a routine
  // further down opened it out of sight and looked like nothing happened.
  // Bring it into view and move focus to its heading each time it opens.
  const formHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!editingId) return;
    const heading = formHeadingRef.current;
    heading?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    heading?.focus({ preventScroll: true });
  }, [editingId]);

  function openNew() {
    setDraft(emptyDraft);
    setEditingId("new");
    setError(null);
  }
  function openEdit(routine: CmeRoutine) {
    const { id, ...next } = routine;
    setDraft(next);
    setEditingId(id);
    setError(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingId || saving) return;
    if (dateChecks.anyInvalid) {
      setError("Fix the date before saving.");
      return;
    }
    // The name is stored and becomes each logged activity's title, so the shared patient-detail check reads it.
    if (cpdTitlePatientProblem(draft.title)) {
      setError("Take out the patient details from the routine name to save it.");
      return;
    }
    if (demoMode) {
      setError("Demo mode is read-only. Sign in to save routines to a private CPD record.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const creating = editingId === "new";
      const response = await fetch(creating ? "/api/cme/routines" : `/api/cme/routines/${editingId}`, {
        method: creating ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!response.ok) throw new Error(await apiError(response));
      const routine = await savedRoutine(response, "Could not save this routine.");
      setRoutines((current) =>
        creating ? [...current, routine] : current.map((item) => (item.id === routine.id ? routine : item)),
      );
      setEditingId(null);
      router.refresh();
    } catch (cause) {
      setError(cmeSaveErrorText(cause, "Could not save this routine."));
    } finally {
      setSaving(false);
    }
  }

  async function archive(restore = false) {
    if (!editingId || editingId === "new" || saving) return;
    if (demoMode) {
      setError(`Demo mode is read-only. Sign in to ${restore ? "restore" : "archive"} a private routine.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const archivedDraft = { ...draft, archivedAt: restore ? null : new Date().toISOString() };
      const response = await fetch(`/api/cme/routines/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(archivedDraft),
      });
      if (!response.ok) throw new Error(await apiError(response));
      const routine = await savedRoutine(response, "Could not archive this routine.");
      setRoutines((current) => current.map((item) => (item.id === routine.id ? routine : item)));
      setEditingId(null);
      router.refresh();
    } catch (cause) {
      setError(cmeSaveErrorText(cause, "Could not archive this routine."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {editingId ? (
        <section className="mx-auto mt-3 w-[calc(100%-1.5rem)] max-w-3xl" data-testid="cme-routine-form">
          <form onSubmit={(event) => void save(event)} className="work-card work-card--pad space-y-4">
            {/* h2: the page's own "Routines" heading below is its one h1. */}
            <h2
              ref={formHeadingRef}
              tabIndex={-1}
              className="scroll-mt-24 text-lg font-semibold text-[color:var(--text-heading)] focus:outline-none"
            >
              {editingId === "new" ? "New routine" : "Edit routine"}
            </h2>
            {demoMode ? (
              <InlineNotice tone="neutral">Demo mode shows the full routine form but cannot save it.</InlineNotice>
            ) : null}
            {error ? <InlineNotice tone="neutral">{error}</InlineNotice> : null}
            <TextField
              label="Routine name"
              id="cme-routine-title"
              required
              value={draft.title}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            />
            <label className="block text-sm font-medium text-[color:var(--text)]" htmlFor="cme-routine-cadence">
              Cadence
              <select
                id="cme-routine-cadence"
                value={draft.cadence}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, cadence: event.target.value as CmeRoutineCadence }))
                }
                className="mt-1 min-h-tap w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3"
              >
                {cmeRoutineCadences.map((cadence) => (
                  <option key={cadence} value={cadence}>
                    {cmeRoutineCadenceLabels[cadence]}
                  </option>
                ))}
              </select>
            </label>
            <TextField
              label="Usual hours"
              id="cme-routine-hours"
              type="number"
              min="0.5"
              max="24"
              step="0.5"
              value={draft.usualHours}
              onChange={(event) =>
                setDraft((current) => ({ ...current, usualHours: Number(event.target.value), usualAllocations: [] }))
              }
              hint="Changing the duration clears the saved category split. Review the split when you log the activity."
            />
            <CmeDateField
              label="Next due"
              onInvalidChange={dateChecks.report("nextDue")}
              id="cme-routine-next-due"
              chips={false}
              today={perthCalendarDate(new Date(nowIso))}
              value={draft.nextDue ?? ""}
              onChange={(nextDue) => setDraft((current) => ({ ...current, nextDue: nextDue || null }))}
            />
            <p className={cn(textMuted, "text-xs")}>
              When this routine is due, Log saves the usual hours and category split straight away (with Undo). Without
              a usual split, or when you tap Log now, the entry form opens first.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" busy={saving} busyLabel="Saving…">
                Save routine
              </Button>
              <Button type="button" variant="secondary" onClick={() => setEditingId(null)}>
                Cancel
              </Button>
              {editingId !== "new" ? (
                draft.archivedAt ? (
                  <Button type="button" variant="toolbar" onClick={() => void archive(true)}>
                    Restore routine
                  </Button>
                ) : (
                  <Button type="button" variant="toolbar" onClick={() => void archive()}>
                    Archive routine
                  </Button>
                )
              ) : null}
            </div>
          </form>
        </section>
      ) : null}
      {oneTap.notice}
      <CmeRoutinesPage
        routines={routines}
        now={new Date(nowIso)}
        loggingDue={oneTap.logging}
        onLogDueRoutine={(prefill) => {
          void oneTap.logDueRoutine(prefill).then((result) => {
            if (result === "form") router.push(cmeRoutineLogHref(prefill));
          });
        }}
        onLogRoutine={(prefill) => router.push(cmeRoutineLogHref(prefill))}
        onNewRoutine={openNew}
        onEditRoutine={openEdit}
      />
    </>
  );
}
