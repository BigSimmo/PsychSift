"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { WaitingOnControls, waitingNoteProblem, type WaitingOnValue } from "@/components/cme/cme-drafts-section";
import { useCmeSample } from "@/components/cme/cme-sample-context";
import { stillShortCategories } from "@/components/cme/cme-still-short";
import { CmeDetailNavHeader } from "@/components/cme/cme-nav-header";
import { CmeEntryForm, type CmeEntryDraft } from "@/components/cme/cme-entry-form";
import { cn, eyebrowText, fieldControlPlain, InlineNotice, textMuted } from "@/components/ui-primitives";
import { CME_NEW_ENTRY_DRAFT_KEY } from "@/lib/account-scoped-browser-state";
import type { CmeDraft, CmeDraftPayload } from "@/lib/cme/drafts";
import { recentRepeatableActivities } from "@/lib/cme/recent-activities";
import type { CmeRoutine } from "@/lib/cme/routines";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";
import { perthCalendarDate } from "@/lib/perth-time";
import { cmePageWidth } from "@/components/cme/cme-page-frame";
import { Checkbox } from "@/components/ui/choice";

export { CME_NEW_ENTRY_DRAFT_KEY };

/** Same shape `z.string().uuid()` accepts on `/api/cme/entries`. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Reads the message the API actually sent, so the form shows the reason rather
 * than a generic failure. `jsonError` (`@/lib/http`) puts the same text in both
 * `error` and `message`; a response that is not JSON at all falls back to the
 * status line.
 */
async function entrySaveError(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (payload && typeof payload === "object") {
      const { message, error } = payload as { message?: unknown; error?: unknown };
      if (typeof message === "string" && message.trim()) return message;
      if (typeof error === "string" && error.trim()) return error;
    }
  } catch {
    // Not JSON. Fall through to the status line below.
  }
  return `Could not save this entry (${response.status}).`;
}

/**
 * The new-entry screen.
 *
 * The form owns every field, the category split and the Save control; this
 * wrapper owns only the page frame and what "save" means — one POST to
 * `/api/cme/entries`, which is the route that resolves the owner from the
 * session and rejects anything the schema does not accept.
 *
 * The throw on failure is load-bearing rather than lazy: `CmeEntryForm` catches
 * whatever `onSubmit` rejects with and renders it, and it clears the form only
 * when `onSubmit` resolves. Returning quietly on a failed request would empty
 * the form and tell the owner nothing — an activity they typed out, gone, with
 * no record made.
 */
export function CmeNewEntryRoute({
  routine,
  learningPrefill,
  repeatOf,
  set,
  existingEntries = [],
  demoMode = false,
  resumeDraft = null,
  missedSessionId = null,
}: {
  readonly learningPrefill?: import("@/lib/cme/learning-source").CmeLearningPrefill;
  readonly routine?: CmeRoutine | null;
  /**
   * "Log it again": an earlier entry to copy. Its title, hours, categories,
   * source, domains and peer-review credit carry over; the date becomes today
   * and the reflection and cost start empty, because those belong to the new
   * occasion, not the old one.
   */
  readonly repeatOf?: CmeEntry | null;
  readonly set?: CmeRequirementSet | null;
  readonly existingEntries?: readonly CmeEntry[];
  readonly demoMode?: boolean;
  /** A saved draft being continued. Saving the activity deletes it; saving as draft updates it. */
  readonly resumeDraft?: CmeDraft | null;
  /** A missed session this activity replaces; the save links the two. */
  readonly missedSessionId?: string | null;
}) {
  const router = useRouter();
  const sample = useCmeSample();
  const [requestId] = useState(() => crypto.randomUUID());
  const [isReplacement, setIsReplacement] = useState(Boolean(missedSessionId));
  const [linkedMissedSessionId, setLinkedMissedSessionId] = useState(missedSessionId ?? "");
  const missedSessionDraft = linkedMissedSessionId.trim();
  const [waiting, setWaiting] = useState<WaitingOnValue>({
    waitingOn: resumeDraft?.waitingOn ?? null,
    waitingNote: resumeDraft?.waitingNote ?? "",
    followUpOn: resumeDraft?.followUpOn ?? "",
  });
  const domains =
    set?.requirements.flatMap((requirement) =>
      requirement.spec.shape === "activity-count" ? [...requirement.spec.buckets] : [],
    ) ?? [];
  const today = perthCalendarDate();
  // Offered only on a blank form: a routine, repeat, draft, missed session or
  // learning link has already chosen what is being logged.
  const blankForm =
    !routine && !repeatOf && !resumeDraft && !missedSessionId && !learningPrefill?.title && !learningPrefill?.sourceUrl;
  const logAgain = blankForm ? recentRepeatableActivities(existingEntries) : [];
  const initialDate = set && !today.startsWith(`${set.year}-`) ? `${set.year}-01-01` : today;
  const initialEntry = resumeDraft
    ? {
        // The draft's own fields fill the form after mount (see `initialDraft`).
        date: initialDate,
        title: "",
        sourceUrl: null,
        allocations: [],
        reflection: "",
        costCents: null,
        routineId: resumeDraft.payload.routineId,
        documentId: resumeDraft.payload.documentId,
        buckets: [],
        formalPeerReviewHours: 0,
      }
    : repeatOf
      ? {
          date: initialDate,
          title: repeatOf.title,
          sourceUrl: repeatOf.sourceUrl ?? null,
          allocations: repeatOf.allocations,
          reflection: "",
          costCents: null,
          routineId: repeatOf.routineId,
          documentId: repeatOf.documentId,
          buckets: repeatOf.buckets,
          formalPeerReviewHours: repeatOf.formalPeerReviewHours ?? 0,
        }
      : {
          date: initialDate,
          title: routine?.title ?? learningPrefill?.title ?? "",
          sourceUrl: learningPrefill?.sourceUrl ?? null,
          allocations: routine?.usualAllocations ?? [],
          reflection: "",
          costCents: null,
          routineId: routine?.id ?? null,
          documentId: null,
          buckets: [],
          formalPeerReviewHours: 0,
        };

  async function saveEntry(entry: CmeEntryDraft) {
    if (demoMode) throw new Error("Demo mode is read-only. Sign in to save this activity to a private CPD record.");
    // The entries API accepts only a UUID. A free-text reason must not be sent as
    // missedSessionId or the whole save is rejected with 400.
    const effectiveMissedSessionId = isReplacement && UUID_PATTERN.test(missedSessionDraft) ? missedSessionDraft : null;
    const response = await fetch("/api/cme/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...entry,
        requestId,
        ...(resumeDraft ? { draftId: resumeDraft.id } : {}),
        ...(effectiveMissedSessionId ? { missedSessionId: effectiveMissedSessionId } : {}),
      }),
    });
    if (!response.ok) throw new Error(await entrySaveError(response));
    // The activity is saved either way; if the missed session could not be linked to it, say so on
    // the log, so the missed record is not mistaken for replaced and replaced a second time.
    const saved = (await response.json().catch(() => null)) as { linkedMissedSession?: boolean } | null;
    const missedUnlinked = effectiveMissedSessionId && saved?.linkedMissedSession === false ? "&missed=unlinked" : "";
    router.push(`/cme/log?year=${entry.date.slice(0, 4)}&saved=1${missedUnlinked}`);
    router.refresh();
  }

  async function saveDraft(payload: CmeDraftPayload) {
    if (demoMode) throw new Error("Demo mode is read-only. Sign in to save drafts to your private CPD record.");
    if (waiting.waitingOn && waitingNoteProblem(waiting.waitingNote))
      throw new Error("Take out the patient details from the note to save this draft.");
    const response = await fetch(resumeDraft ? `/api/cme/drafts/${resumeDraft.id}` : "/api/cme/drafts", {
      method: resumeDraft ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payload,
        waitingOn: waiting.waitingOn,
        waitingNote: waiting.waitingOn && waiting.waitingNote.trim() ? waiting.waitingNote.trim() : null,
        followUpOn: waiting.waitingOn && waiting.followUpOn ? waiting.followUpOn : null,
      }),
    });
    if (!response.ok) throw new Error(await entrySaveError(response));
    router.push("/cme/log?tab=finish#cme-drafts");
    router.refresh();
  }

  return (
    <>
      {/* The band is hidden on a form, so the form keeps its own way back (work-mode redesign, owner request 6 Oct 2026). */}
      <CmeDetailNavHeader
        title="Log an activity"
        back={{ href: "/cme/log", label: "CPD log" }}
        testIdPrefix="cme-new"
      />
      <main data-mode-identity="cme" className={cn(cmePageWidth, "px-4 pb-6 pt-3 sm:px-6")}>
        <h1 className="sr-only">Log an activity</h1>
        <p className="cpd-hint m-0">
          {set ? `Counts toward ${set.year}. ` : ""}What it was, when, how long it ran for, and which category the hours
          count toward. Nothing is recorded until you save it.
        </p>

        {repeatOf ? (
          <p data-testid="cme-entry-repeat-notice" className={cn(textMuted, "mt-3 text-sm")}>
            Copied from an earlier entry and dated today. Check the date and hours, and write this occasion&apos;s own
            reflection, before saving.
          </p>
        ) : null}
        {routine ? (
          <p className={cn(textMuted, "mt-3 text-sm")}>
            This routine usually takes {routine.usualHours} h. Choose the hours you actually spent before saving.
          </p>
        ) : null}
        {resumeDraft ? (
          <p data-testid="cme-entry-resume-notice" className={cn(textMuted, "mt-3 text-sm")}>
            Continuing a saved draft. Saving the activity removes the draft. Saving as draft again keeps your changes.
          </p>
        ) : null}
        {learningPrefill?.title || learningPrefill?.sourceUrl ? (
          <p className={cn(textMuted, "mt-3 text-sm")}>
            Source details are prefilled. Confirm the time you actually spent and its allocation before saving. Opening
            this form does not record an activity.
          </p>
        ) : null}
        {logAgain.length ? (
          // "Log again": one tap opens this form filled from that earlier entry,
          // through the same repeat path as an activity's own Log it again.
          // Nothing is recorded until Save.
          <nav aria-labelledby="cme-log-again-label" className="mt-4" data-testid="cme-log-again">
            <p id="cme-log-again-label" className={eyebrowText}>
              Log again
            </p>
            <ul className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1">
              {logAgain.map((activity) => (
                <li key={activity.id} className="shrink-0">
                  <Link
                    href={`/cme/new?year=${activity.date.slice(0, 4)}&repeat=${encodeURIComponent(activity.id)}`}
                    className="work-chip min-h-tap max-w-64"
                  >
                    <span className="truncate font-medium">{activity.title}</span>
                    <span className={cn(textMuted, "nums shrink-0")}>· {activity.hours} h</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        {demoMode ? (
          <div className="mt-4" data-testid="cme-entry-demo-notice">
            <InlineNotice tone="neutral">
              Demo mode lets you inspect the form. Saving is available only in your signed-in private record.
            </InlineNotice>
          </div>
        ) : null}

        <div className="mt-4 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-4">
          <Checkbox
            label="This activity replaces a missed teaching or supervision session"
            checked={isReplacement}
            onChange={(event) => setIsReplacement(event.target.checked)}
            data-testid="cme-replacement-checkbox"
          />
          {isReplacement ? (
            <div className="mt-3 pl-6">
              <label
                htmlFor="cme-missed-session-input"
                className="block text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)]"
              >
                Missed session ID or reason
              </label>
              <input
                id="cme-missed-session-input"
                type="text"
                value={linkedMissedSessionId}
                onChange={(e) => setLinkedMissedSessionId(e.target.value)}
                className={cn("mt-1", fieldControlPlain)}
                data-testid="cme-missed-session-input"
                aria-describedby="cme-missed-session-hint"
              />
              <p id="cme-missed-session-hint" className="mt-1.5 text-xs text-[color:var(--text-muted)]">
                {missedSessionDraft && !UUID_PATTERN.test(missedSessionDraft)
                  ? "That isn't a session ID, so this activity will save without linking a missed session."
                  : "Paste the missed session ID. A written reason is not a session ID and is not sent."}
              </p>
            </div>
          ) : null}
        </div>

        <div className="mt-6">
          <CmeEntryForm
            onSubmit={saveEntry}
            initialEntry={initialEntry}
            existingEntries={existingEntries}
            initialStatedHours={routine ? null : undefined}
            availableDomains={domains}
            stillShort={stillShortCategories(set, existingEntries)}
            // A continued account draft is not also mirrored to this tab's storage.
            draftStorageKey={resumeDraft || sample ? undefined : CME_NEW_ENTRY_DRAFT_KEY}
            initialDraft={resumeDraft?.payload}
            onSaveDraft={demoMode ? undefined : saveDraft}
            draftControls={
              <WaitingOnControls
                idPrefix="cme-entry-draft"
                value={waiting}
                onWaitingOnChange={(waitingOn) => setWaiting((current) => ({ ...current, waitingOn }))}
                onWaitingNoteChange={(waitingNote) => setWaiting((current) => ({ ...current, waitingNote }))}
                onFollowUpOnChange={(followUpOn) => setWaiting((current) => ({ ...current, followUpOn }))}
              />
            }
          />
        </div>
      </main>
    </>
  );
}
