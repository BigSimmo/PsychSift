"use client";

import { useEffect, useRef, useState } from "react";

import { InlineNotice } from "@/components/primitive-recipes/feedback";
import { Progress } from "@/components/ui/progress";
import { AdminSheet } from "@/components/admin/admin-kit";
import { WorkButton } from "@/components/mode-kit/work";
import { TextField } from "@/components/ui/text-field";
import { cn, textMuted } from "@/components/ui-primitives";
import { parseApiErrorResponse } from "@/lib/api-client-error";
import { formatDateEcho } from "@/lib/admin/renewal-dates";
import { buildNotForThisJobCreateBody, buildRenewedEntryBody, catalogueItemDraftEntry } from "@/lib/admin/renewals";
import type { AdminRequirementCatalogueItem } from "@/lib/admin/requirements";
import { onCallEntrySchema, type OnCallEntry } from "@/lib/on-call/entry-model";

/** Why the sheet cannot save, said plainly instead of pretending to. */
export type RecordDatesReadOnly = "demo" | "signed-out" | "failed";

const READ_ONLY_TEXT: Record<RecordDatesReadOnly, string> = {
  demo: "Example records are read-only.",
  "signed-out": "Sign in to record dates.",
  failed: "Your renewals didn't load, so dates can't be recorded yet.",
};

const REASON_MESSAGE: Record<Exclude<ReturnType<typeof buildRenewedEntryBody>, { ok: true }>["reason"], string> = {
  missing: "Type the expiry date.",
  malformed: "Use the date picker, or type the date as YYYY-MM-DD.",
  unchanged: "That is the date already recorded.",
  "too-long": "Keep the note to 120 characters.",
};

async function postEntry(body: unknown): Promise<OnCallEntry> {
  const response = await fetch("/api/on-call/entries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await parseApiErrorResponse(response);
  const payload: unknown = await response.json();
  const parsed = onCallEntrySchema.safeParse((payload as { entry?: unknown } | null)?.entry);
  if (!parsed.success) throw new Error("Save response was invalid.");
  return parsed.data;
}

type Tally = { readonly recorded: number; readonly skipped: number; readonly notForThisJob: number };

function recordDatesSummary({ recorded, skipped, notForThisJob }: Tally): string {
  const parts = [`Recorded ${recorded}`, `skipped ${skipped}`];
  if (notForThisJob > 0) parts.push(`${notForThisJob} not for this job`);
  return parts.join(", ");
}

/**
 * "Record missing dates": steps through the checklist items not recorded yet,
 * one at a time — "4 of 17", the item's own catalogue wording verbatim, and
 * an expiry date. "Save and next" records it through the same create path as
 * "Add date" (`buildRenewedEntryBody` on a draft of the item, POSTed to
 * `/api/on-call/entries`), and moves on only once the server has confirmed
 * it; a failure stays on the same item with Retry. "Skip" moves on without
 * saving; "Not for this job" creates the same minimal flagged row the item
 * sheet does. It ends with a plain count of what happened.
 *
 * `items` is the queue as it stood when the sheet opened, so recording an
 * item never reshuffles the steps under the reader. Mounted per opening.
 */
export function RecordDatesSheet({
  items,
  readOnly,
  onClose,
  onSaved,
  onSignIn,
  onRetryLoad,
  testId = "admin-renewals-record-sheet",
}: {
  readonly items: readonly AdminRequirementCatalogueItem[];
  readonly readOnly: RecordDatesReadOnly | null;
  readonly onClose: () => void;
  readonly onSaved: (entry: OnCallEntry) => void;
  readonly onSignIn?: () => void;
  readonly onRetryLoad?: () => void;
  readonly testId?: string;
}) {
  const [index, setIndex] = useState(0);
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ message: string; retry: () => void } | null>(null);
  const [tally, setTally] = useState<Tally>({ recorded: 0, skipped: 0, notForThisJob: 0 });
  const dateRef = useRef<HTMLInputElement>(null);
  // One slug suffix per item for this opening, so a Retry (or a second tap)
  // after a POST that committed but lost its response repeats the same
  // `(owner, section, slug)` and cannot add a second flagged row.
  const notForThisJobSuffix = useRef(new Map<string, string>());

  const total = items.length;
  const item = index < total ? items[index] : undefined;
  const done = readOnly === null && item === undefined;
  const echo = date ? formatDateEcho(date) : "";
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && echo !== "";

  // Each new step starts with the cursor in its date field.
  useEffect(() => {
    if (index > 0) dateRef.current?.focus();
  }, [index]);

  function advance(change: keyof Tally) {
    setTally((current) => ({ ...current, [change]: current[change] + 1 }));
    setDate("");
    setFailure(null);
    setIndex((current) => current + 1);
  }

  async function run(action: () => Promise<void>, failureMessage: string) {
    setBusy(true);
    setFailure(null);
    try {
      await action();
    } catch (caught) {
      const detail = caught instanceof Error && caught.message ? ` ${caught.message}` : "";
      setFailure({ message: `${failureMessage}${detail}`, retry: () => void run(action, failureMessage) });
    } finally {
      setBusy(false);
    }
  }

  function saveAndNext() {
    if (!item) return;
    const result = buildRenewedEntryBody(catalogueItemDraftEntry(item), { newExpiresOn: date, proofNote: "" });
    if (!result.ok) {
      setFailure({ message: REASON_MESSAGE[result.reason], retry: saveAndNext });
      return;
    }
    const body = result.body;
    void run(async () => {
      const saved = await postEntry(body);
      onSaved(saved);
      advance("recorded");
    }, `Couldn't save ${item.title}.`);
  }

  function notForThisJob() {
    if (!item) return;
    let suffix = notForThisJobSuffix.current.get(item.id);
    if (!suffix) {
      suffix = crypto.randomUUID().slice(0, 6);
      notForThisJobSuffix.current.set(item.id, suffix);
    }
    const body = buildNotForThisJobCreateBody(item, suffix);
    void run(async () => {
      const saved = await postEntry(body);
      onSaved(saved);
      advance("notForThisJob");
    }, `Couldn't save ${item.title}.`);
  }

  return (
    <AdminSheet
      open
      onClose={onClose}
      title="Record missing dates"
      description="Type each date as it appears on your record. Nothing here is confirmed with the issuer."
      testId={testId}
      footer={
        readOnly === null && item ? (
          <div className="grid gap-2">
            {failure ? (
              <div data-testid={`${testId}-error`}>
                <InlineNotice tone="neutral">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span>{failure.message}</span>
                    <WorkButton variant="quiet" onClick={failure.retry} testId={`${testId}-retry`} disabled={busy}>
                      Retry
                    </WorkButton>
                  </span>
                </InlineNotice>
              </div>
            ) : null}
            <WorkButton
              variant="primary"
              size="wide"
              onClick={saveAndNext}
              testId={`${testId}-save`}
              disabled={busy || !validDate}
            >
              Save and next
            </WorkButton>
            <div className="grid grid-cols-2 gap-2">
              <WorkButton
                variant="secondary"
                onClick={() => advance("skipped")}
                testId={`${testId}-skip`}
                disabled={busy}
              >
                Skip
              </WorkButton>
              <WorkButton
                variant="secondary"
                onClick={notForThisJob}
                testId={`${testId}-not-for-this-job`}
                disabled={busy}
              >
                Not for this job
              </WorkButton>
            </div>
          </div>
        ) : (
          <WorkButton variant="primary" size="wide" onClick={onClose} testId={`${testId}-done`}>
            {done ? "Done" : "Close"}
          </WorkButton>
        )
      }
    >
      {readOnly !== null ? (
        <div className="grid gap-3" data-testid={`${testId}-read-only`}>
          <p className="text-sm text-[color:var(--text)]">{READ_ONLY_TEXT[readOnly]}</p>
          {readOnly === "signed-out" && onSignIn ? (
            <div>
              <WorkButton variant="secondary" onClick={onSignIn} testId={`${testId}-sign-in`}>
                Sign in
              </WorkButton>
            </div>
          ) : null}
          {readOnly === "failed" && onRetryLoad ? (
            <div>
              <WorkButton variant="secondary" onClick={onRetryLoad} testId={`${testId}-retry-load`}>
                Retry
              </WorkButton>
            </div>
          ) : null}
        </div>
      ) : item ? (
        <div className="grid gap-4" data-testid={`${testId}-step`}>
          <Progress value={(index / total) * 100} label={`${index + 1} of ${total}`} />
          <div className="grid gap-1">
            <h3
              className="text-base-minus font-medium text-[color:var(--text-heading)]"
              data-testid={`${testId}-title`}
            >
              {item.title}
            </h3>
            {item.status === "confirmed" ? (
              <p className="text-sm leading-6 text-[color:var(--text)]">{item.rule}</p>
            ) : (
              <>
                <p className="text-sm font-medium text-[color:var(--text-heading)]">Check with your service</p>
                <p className={cn(textMuted, "text-sm leading-6")}>{item.whatIsUnconfirmed}</p>
              </>
            )}
          </div>
          <div className="grid gap-1">
            <TextField
              ref={dateRef}
              type="date"
              label="Expiry date"
              value={date}
              onChange={(event) => {
                setDate(event.target.value);
                setFailure(null);
              }}
            />
            {echo ? <p className={cn(textMuted, "text-sm")}>{echo}</p> : null}
          </div>
        </div>
      ) : (
        <div className="grid gap-1" data-testid={`${testId}-summary`}>
          <p className="text-sm font-medium text-[color:var(--text-heading)]" role="status">
            {total === 0 ? "Nothing left to record." : recordDatesSummary(tally)}
          </p>
          <p className={cn(textMuted, "text-sm")}>Dates you entered, not a check</p>
        </div>
      )}
    </AdminSheet>
  );
}
