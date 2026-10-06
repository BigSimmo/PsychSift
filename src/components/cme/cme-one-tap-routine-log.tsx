"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { CME_SAVED_NOTICE_MS, CmeSavedLogNotice } from "@/components/cme/cme-saved-log-notice";
import { InlineNotice } from "@/components/ui-primitives";
import { cmeSaveErrorText } from "@/lib/cme/load-state";
import type { CmeRoutineLogPrefill } from "@/lib/cme/routines";

async function entrySaveError(response: Response): Promise<string> {
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
 * A due-routine "Log N h" can one-tap only when the routine already carries a
 * usual category split — the API refuses an empty allocation list, and inventing
 * a category would be a silent clinical guess.
 */
export function canOneTapLogRoutine(prefill: CmeRoutineLogPrefill): boolean {
  return prefill.allocations.length > 0;
}

function entryBody(prefill: CmeRoutineLogPrefill, requestId: string) {
  return {
    date: prefill.date,
    title: prefill.title,
    sourceUrl: null,
    allocations: [...prefill.allocations],
    reflection: "",
    costCents: null,
    routineId: prefill.routineId,
    documentId: null,
    buckets: [] as string[],
    formalPeerReviewHours: 0,
    requestId,
  };
}

/**
 * Immediate save + Undo for due-routine "Log N h" on CPD Today and Routines.
 * The tap is the explicit log — never call this from attendance, timers, or search.
 */
export function useCmeOneTapRoutineLog({ demoMode = false }: { demoMode?: boolean } = {}) {
  const router = useRouter();
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [logging, setLogging] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (savedNotice === null) return;
    const timer = window.setTimeout(() => setSavedNotice(null), CME_SAVED_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [savedNotice]);

  async function logDueRoutine(prefill: CmeRoutineLogPrefill): Promise<"saved" | "form"> {
    if (!canOneTapLogRoutine(prefill)) return "form";
    if (logging) return "saved";
    setSaveError(null);
    setUndoError(null);
    if (demoMode) {
      setSaveError("Demo mode is read-only. Sign in to save this activity to a private CPD record.");
      return "saved";
    }
    setLogging(true);
    try {
      const response = await fetch("/api/cme/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entryBody(prefill, requestId)),
      });
      if (!response.ok) throw new Error(await entrySaveError(response));
      const payload = (await response.json().catch(() => null)) as { entry?: { id?: string } } | null;
      setSavedNotice(payload?.entry?.id ?? "");
      setRequestId(crypto.randomUUID());
      router.refresh();
      return "saved";
    } catch (error) {
      setSaveError(cmeSaveErrorText(error, "Could not save this activity."));
      return "saved";
    } finally {
      setLogging(false);
    }
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

  const notice = (
    <>
      <CmeSavedLogNotice entryId={savedNotice} undoing={undoing} undoError={undoError} onUndo={() => void undo()} />
      {saveError ? (
        <div
          data-testid="cme-one-tap-log-error"
          className="pointer-events-none fixed inset-x-0 bottom-0 z-[var(--z-toast)] flex justify-center px-4 pb-[calc(max(1rem,env(safe-area-inset-bottom))+4rem)]"
        >
          <div className="pointer-events-auto max-w-md">
            <InlineNotice tone="neutral">{saveError}</InlineNotice>
          </div>
        </div>
      ) : null}
    </>
  );

  return { logDueRoutine, notice, logging };
}
