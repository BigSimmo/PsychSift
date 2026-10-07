"use client";

import { useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { InlineNotice } from "@/components/primitive-recipes/feedback";
import { AdminSheet } from "@/components/admin/admin-kit";
import { WorkButton } from "@/components/mode-kit/work";
import { TextField } from "@/components/ui/text-field";
import { cn, controlDisabled, textMuted } from "@/components/ui-primitives";
import { parseApiErrorResponse } from "@/lib/api-client-error";
import { downloadTextFile } from "@/lib/admin/download-file";
import { formatDateEcho, formatRecordedDate } from "@/lib/admin/renewal-dates";
import {
  buildRenewedEntryBody,
  buildRestoreEntryBody,
  catalogueItemDraftEntry,
  renewalCalendarEvent,
  type RenewedInput,
} from "@/lib/admin/renewals";
import type { AdminRequirementCatalogueItem } from "@/lib/admin/requirements";
import { icsFileName, toIcs } from "@/lib/calendar/ics";
import { complianceExpiresOn } from "@/lib/on-call/compliance";
import { onCallEntrySchema, type OnCallEntry } from "@/lib/on-call/entry-model";

const REASON_MESSAGE: Record<Exclude<ReturnType<typeof buildRenewedEntryBody>, { ok: true }>["reason"], string> = {
  missing: "Type the new expiry date.",
  malformed: "Use the date picker, or type the date as YYYY-MM-DD.",
  unchanged: "That is the date already recorded.",
  "too-long": "Keep the note to 120 characters.",
};

/**
 * The new-expiry-date sheet (final design, screens-v3): date blank, Save grey
 * until it validates, the typed date echoed in full, an optional proof note,
 * an identifier refused with a plain line, a failed save keeping the typed
 * values with Retry, and Undo once saved.
 *
 * Handles both flows through the one sheet, per the final design's item
 * detail sheet ("Renewed" on a recorded item, "Add date" on one never
 * recorded): `entry` renews an existing row (PATCH); `createItem` records a
 * catalogue item for the first time (POST), reusing the exact same body
 * builder and error wording as the renew path.
 */
export function AdminRenewedSheet({
  open,
  entry,
  createItem,
  onClose,
  onSaved,
  onRemoved,
}: {
  /**
   * Visibility, separate from `entry`/`createItem`: the final design keeps a
   * dismissed half-filled sheet in memory (Addendum A, "dismissed half-filled
   * sheet is kept"), so the caller keeps the subject around across a close and
   * only flips this. A completed save still clears the form (below) — that is
   * a finished transaction, not a draft — so the next renewal starts blank.
   */
  open: boolean;
  entry: OnCallEntry | null;
  createItem?: AdminRequirementCatalogueItem;
  onClose: () => void;
  onSaved: (entry: OnCallEntry) => void;
  /** Undo of a first-time date ("Add date"): the row this sheet created was deleted. */
  onRemoved: (id: string) => void;
}) {
  const subjectTitle = entry?.title ?? createItem?.title ?? "";
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState<OnCallEntry | null>(null);
  const [earlier, setEarlier] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    if (saved) {
      setDate("");
      setNote("");
      setSaved(null);
      setEarlier(false);
      setError(null);
    }
    onClose();
  }

  const echo = date ? formatDateEcho(date) : "";
  const canSave = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const previousExpiresOn = entry ? complianceExpiresOn(entry) : undefined;

  async function save() {
    const subject = entry ?? (createItem ? catalogueItemDraftEntry(createItem) : null);
    if (!subject) return;
    const result = buildRenewedEntryBody(subject, { newExpiresOn: date, proofNote: note } satisfies RenewedInput);
    if (!result.ok) {
      setError(REASON_MESSAGE[result.reason]);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(entry ? `/api/on-call/entries/${entry.id}` : "/api/on-call/entries", {
        method: entry ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.body),
      });
      if (!response.ok) throw await parseApiErrorResponse(response);
      const payload: unknown = await response.json();
      const parsed = onCallEntrySchema.safeParse((payload as { entry?: unknown } | null)?.entry);
      if (!parsed.success) throw new Error("Save response was invalid.");
      setSaved(parsed.data);
      setEarlier(result.earlier);
      onSaved(parsed.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this.");
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!saved) return;
    setBusy(true);
    try {
      if (!entry) {
        // A first-time date created this row, so taking it back deletes it.
        const removed = await fetch(`/api/on-call/entries/${saved.id}`, { method: "DELETE" });
        if (!removed.ok) throw await parseApiErrorResponse(removed);
        onRemoved(saved.id);
        setSaved(null);
        return;
      }
      const response = await fetch(`/api/on-call/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRestoreEntryBody(entry)),
      });
      if (!response.ok) throw await parseApiErrorResponse(response);
      const payload: unknown = await response.json();
      const parsed = onCallEntrySchema.safeParse((payload as { entry?: unknown } | null)?.entry);
      if (!parsed.success) throw new Error("Undo response was invalid.");
      onSaved(parsed.data);
      setSaved(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not undo that.");
    } finally {
      setBusy(false);
    }
  }

  function addToCalendar() {
    if (!saved) return;
    const event = renewalCalendarEvent(saved, new Date());
    if (event) downloadTextFile(toIcs([event]), icsFileName(saved.title), "text/calendar;charset=utf-8");
  }

  return (
    <AdminSheet
      open={open}
      onClose={handleClose}
      title={entry ? `Renewed: ${subjectTitle}` : `New expiry date`}
      description="Type the new date from your renewal. Nothing here is confirmed with the issuer."
      testId="admin-renewed-sheet"
      footer={
        saved ? null : (
          <div className="grid gap-2">
            {error ? <InlineNotice tone="neutral">{error}</InlineNotice> : null}
            <WorkButton
              variant="primary"
              size="wide"
              onClick={() => void save()}
              testId="admin-renewed-save"
              disabled={busy || !canSave}
            >
              {error ? "Retry" : "Save new date"}
            </WorkButton>
          </div>
        )
      }
    >
      {saved ? (
        <div className="grid gap-3" data-testid="admin-renewed-saved">
          <p className="text-sm leading-6 text-[color:var(--text)]">
            Marked renewed.{earlier ? " The new date is earlier than the date recorded before." : ""}
          </p>
          <p className={cn(textMuted, "text-sm")}>
            {`Recorded as expiring ${formatRecordedDate(date)} · as you typed it`}
          </p>
          <div className="flex flex-wrap gap-2">
            <WorkButton variant="secondary" onClick={addToCalendar} testId="admin-renewed-calendar">
              Add to my calendar
            </WorkButton>
            {saved ? (
              <button
                type="button"
                onClick={() => void undo()}
                disabled={busy}
                data-testid="admin-renewed-undo"
                className={cn(
                  focusRing,
                  controlDisabled,
                  "min-h-tap px-2 text-sm text-[color:var(--clinical-accent)] underline-offset-2 hover:underline",
                )}
              >
                Undo
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          {entry ? (
            <p className={cn(textMuted, "text-sm")}>
              {`Recorded before: ${previousExpiresOn ? formatRecordedDate(previousExpiresOn) : "nothing yet"}`}
            </p>
          ) : null}
          <div className="grid gap-1">
            <TextField
              type="date"
              label="New expiry date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
            {echo ? <p className={cn(textMuted, "text-sm")}>{echo}</p> : null}
          </div>
          <TextField
            label="Where's your proof? (optional)"
            maxLength={120}
            placeholder="Where your proof is, e.g. email from Ahpra"
            hint={`${note.length}/120`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
      )}
    </AdminSheet>
  );
}
