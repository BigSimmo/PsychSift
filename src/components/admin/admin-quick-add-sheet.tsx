"use client";

import { useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { InlineNotice } from "@/components/primitive-recipes/feedback";
import { AdminSheet } from "@/components/admin/admin-kit";
import { WorkButton } from "@/components/mode-kit/work";
import { TextField } from "@/components/ui/text-field";
import { cn, textMuted } from "@/components/ui-primitives";
import { parseApiErrorResponse } from "@/lib/api-client-error";
import { formatDateEcho } from "@/lib/admin/renewal-dates";
import { buildRenewedEntryBody } from "@/lib/admin/renewals";
import { onCallEntrySchema, type OnCallEntry } from "@/lib/on-call/entry-model";

const REASON_MESSAGE: Record<Exclude<ReturnType<typeof buildRenewedEntryBody>, { ok: true }>["reason"], string> = {
  missing: "Type the new expiry date.",
  malformed: "Use the date picker, or type the date as YYYY-MM-DD.",
  unchanged: "That is the date already recorded.",
  "too-long": "Keep the note to 120 characters.",
};

/** A short label for a lead time in days, matching the final design's own
 *  wording ("4 weeks before", "3 months before"). Exact multiples read as
 *  weeks or months; anything else reads as days, so no chip ever rounds a
 *  recorded value into a wrong one. */
export function leadTimeChipLabel(days: number): string {
  if (days % 30 === 0 && days >= 60) return `${days / 30} months before`;
  if (days % 7 === 0 && days >= 14) return `${days / 7} weeks before`;
  return `${days} ${days === 1 ? "day" : "days"} before`;
}

const DEFAULT_LEAD_TIME_CHIPS = [28, 90] as const;

function slugify(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "renewal"}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * "Add a renewal" (final design, screens-v3): a free Name and Expiry date —
 * for a personal item, not on the catalogue — plus "Start renewing · your
 * recent" lead-time chips (fill only, never preselected), and Save grey until
 * both fields are filled. Creates a new, private compliance row.
 */
export function AdminQuickAddSheet({
  open,
  onClose,
  onSaved,
  recentLeadTimeDays = [],
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (entry: OnCallEntry) => void;
  /** Distinct lead times (in days) the reader has used before, soonest-typed
   *  first — shown as extra "your recent" chips ahead of the two defaults. */
  recentLeadTimeDays?: readonly number[];
}) {
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [leadTimeDays, setLeadTimeDays] = useState<number | null>(null);
  const [otherDays, setOtherDays] = useState("");
  const [showOther, setShowOther] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const echo = date ? formatDateEcho(date) : "";
  const canSave = name.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date);
  const chips = [...new Set([...recentLeadTimeDays, ...DEFAULT_LEAD_TIME_CHIPS])].slice(0, 3);

  async function save() {
    if (!canSave) return;
    const synthetic: OnCallEntry = {
      id: "",
      section: "logistics",
      slug: slugify(name),
      title: name.trim(),
      subtitle: null,
      body: null,
      details: { kind: "compliance", category: "Personal" },
      linkedDocumentIds: [],
      tags: [],
      isPersonal: true,
      includeOnCard: false,
      sortOrder: 0,
      lastVerifiedAt: null,
      isOwn: true,
    };
    const result = buildRenewedEntryBody(synthetic, { newExpiresOn: date, proofNote: "" });
    if (!result.ok) {
      setError(REASON_MESSAGE[result.reason]);
      return;
    }
    const days = leadTimeDays ?? (Number.isFinite(Number(otherDays)) && otherDays.trim() ? Number(otherDays) : null);
    const body =
      days !== null && days >= 0
        ? { ...result.body, details: { ...(result.body.details as Record<string, unknown>), leadTimeDays: days } }
        : result.body;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/on-call/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw await parseApiErrorResponse(response);
      const payload: unknown = await response.json();
      const parsed = onCallEntrySchema.safeParse((payload as { entry?: unknown } | null)?.entry);
      if (!parsed.success) throw new Error("Save response was invalid.");
      onSaved(parsed.data);
      // A completed save, not a dismissed draft — Addendum A keeps a
      // dismissed half-filled sheet in memory, but this transaction finished,
      // so the next "Add a renewal" opens blank rather than showing what was
      // just saved.
      setName("");
      setDate("");
      setLeadTimeDays(null);
      setOtherDays("");
      setShowOther(false);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminSheet
      open={open}
      onClose={onClose}
      title="Add a renewal"
      testId="admin-quick-add-sheet"
      footer={
        <div className="grid gap-2">
          {error ? <InlineNotice tone="neutral">{error}</InlineNotice> : null}
          <WorkButton
            variant="primary"
            size="wide"
            onClick={() => void save()}
            testId="admin-quick-add-save"
            disabled={busy || !canSave}
          >
            Save
          </WorkButton>
        </div>
      }
    >
      <div className="grid gap-4">
        <TextField
          label="Name"
          placeholder="Type a name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="grid gap-1">
          <TextField type="date" label="Expiry date" value={date} onChange={(event) => setDate(event.target.value)} />
          {echo ? <p className={cn(textMuted, "text-sm")}>{echo}</p> : null}
        </div>
        <div className="grid gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-[color:var(--text-muted)]">
            Start renewing · your recent
          </p>
          <div className="flex flex-wrap gap-2">
            {chips.map((days) => (
              <button
                key={days}
                type="button"
                aria-pressed={leadTimeDays === days}
                onClick={() => {
                  setShowOther(false);
                  setLeadTimeDays(days);
                }}
                data-testid={`admin-quick-add-lead-${days}`}
                className={cn(
                  focusRing,
                  "inline-flex min-h-tap items-center rounded-md border px-3 text-sm font-medium",
                  leadTimeDays === days
                    ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                    : "border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--text)]",
                )}
              >
                {leadTimeChipLabel(days)}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={showOther}
              onClick={() => {
                setLeadTimeDays(null);
                setShowOther(true);
              }}
              data-testid="admin-quick-add-lead-other"
              className={cn(
                focusRing,
                "inline-flex min-h-tap items-center rounded-md border px-3 text-sm font-medium",
                showOther
                  ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                  : "border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--text)]",
              )}
            >
              Other
            </button>
          </div>
          {showOther ? (
            <TextField
              type="number"
              min={0}
              label="Days before, to start renewing"
              value={otherDays}
              onChange={(event) => setOtherDays(event.target.value)}
            />
          ) : null}
        </div>
      </div>
    </AdminSheet>
  );
}
