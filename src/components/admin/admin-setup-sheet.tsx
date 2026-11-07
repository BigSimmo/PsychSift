"use client";

import { OnCallEntrySessionBoundary } from "@/components/on-call/on-call-entry-session-boundary";

import { useState } from "react";

import { InlineNotice } from "@/components/primitive-recipes/feedback";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import { formatDateEcho } from "@/lib/admin/renewal-dates";
import {
  buildSetupComplianceEntry,
  setupRequirementRecorded,
  setupRequirementsToCreate,
  type SetupRequirement,
} from "@/lib/admin/setup";
import { parseApiErrorResponse } from "@/lib/api-client-error";
import { onCallEntrySchema, type OnCallEntry } from "@/lib/on-call/entry-model";
import { peekOnCallEntrySessionEpoch } from "@/lib/on-call/entry-cache-keys";

const LABELS: Record<SetupRequirement, string> = {
  registration: "Registration expiry",
  indemnity: "Indemnity expiry",
};

export interface AdminSetupSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The reader's own rows, so a requirement already recorded shows as recorded rather than a field. */
  readonly existingEntries: readonly OnCallEntry[];
  readonly onCreated: (entry: OnCallEntry) => void;
}

/**
 * First-visit setup (spec review 5): two dates and nothing else. Level is cut
 * from update 1; the site belongs to update 2's service content. Nothing here
 * is written to the device — every save goes straight to the existing entry
 * API, through the same contract Renewals uses.
 */
function AdminSetupSheetSession({ open, onClose, existingEntries, onCreated }: AdminSetupSheetProps) {
  const sessionEpoch = peekOnCallEntrySessionEpoch();
  const [dates, setDates] = useState<Record<SetupRequirement, string>>({ registration: "", indemnity: "" });
  // Rows already created in this sheet, so a retry after a partial failure
  // never re-sends the one that already saved.
  const [done, setDone] = useState<SetupRequirement[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alreadyRecorded: Record<SetupRequirement, boolean> = {
    registration: setupRequirementRecorded(existingEntries, "registration"),
    indemnity: setupRequirementRecorded(existingEntries, "indemnity"),
  };

  async function save() {
    setBusy(true);
    setError(null);
    const pending = setupRequirementsToCreate(existingEntries, dates).filter((kind) => !done.includes(kind));
    for (const kind of pending) {
      if (sessionEpoch !== peekOnCallEntrySessionEpoch()) {
        setBusy(false);
        return;
      }
      try {
        const response = await fetch("/api/on-call/entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildSetupComplianceEntry(kind, dates[kind], crypto.randomUUID().slice(0, 6))),
        });
        if (!response.ok) throw await parseApiErrorResponse(response);
        const parsed = onCallEntrySchema.safeParse(((await response.json()) as { entry?: unknown }).entry);
        if (!parsed.success) throw new Error("The saved row came back unreadable.");
        if (sessionEpoch !== peekOnCallEntrySessionEpoch()) {
          setBusy(false);
          return;
        }
        onCreated(parsed.data);
        setDone((previous) => [...previous, kind]);
      } catch (cause) {
        // The unsent row waits on screen with Retry (spec, "Offline").
        setError(cause instanceof Error ? cause.message : "Could not save.");
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Set up Admin"
      description="Two dates now saves hunting for them later. Every date is yours as you typed it."
      testId="admin-setup-sheet"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>
            Later
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            {error ? "Retry" : "Save"}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        {(Object.keys(LABELS) as SetupRequirement[]).map((kind) =>
          alreadyRecorded[kind] ? (
            <p key={kind} className="text-sm text-[color:var(--text-muted)]">
              {LABELS[kind]}: already recorded. Edit it on Renewals.
            </p>
          ) : (
            <div key={kind} className="grid gap-1">
              <TextField
                label={LABELS[kind]}
                id={`admin-setup-${kind}`}
                type="date"
                value={dates[kind]}
                onChange={(event) => setDates((current) => ({ ...current, [kind]: event.target.value }))}
                disabled={busy}
              />
              {dates[kind] && /^\d{4}-\d{2}-\d{2}$/.test(dates[kind]) ? (
                <span className="text-xs text-[color:var(--text-muted)]">{formatDateEcho(dates[kind])}</span>
              ) : null}
            </div>
          ),
        )}
        {error ? <InlineNotice tone="neutral">{error}</InlineNotice> : null}
      </div>
    </Sheet>
  );
}

export function AdminSetupSheet(props: Parameters<typeof AdminSetupSheetSession>[0]) {
  return (
    <OnCallEntrySessionBoundary open={props.open}>
      <AdminSetupSheetSession {...props} />
    </OnCallEntrySessionBoundary>
  );
}
