"use client";

import { Check, Pencil } from "lucide-react";

import { focusRing } from "@/components/card-recipes";
import { onCallEntryAnchorId } from "@/components/on-call/on-call-page-anchors";
import { ExternalTextLink } from "@/components/ui/link";
import { cn, textMuted, toolbarButton } from "@/components/ui-primitives";
import { displayPhoneNumber } from "@/lib/admin/phone-display";
import { formatUpdatedMonth } from "@/lib/admin/renewal-dates";
import { onCallTelHref } from "@/lib/on-call/home-modules";
import { isOnCallPlaceholderNumber } from "@/lib/on-call/number-resolver";
import type { OnCallEntry } from "@/lib/on-call/entry-model";

function detailString(entry: OnCallEntry, key: "phone" | "url"): string | null {
  const details = entry.details;
  const value = typeof details === "object" && details !== null ? (details as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" && value.trim() ? value : null;
}

function isStepDone(entry: OnCallEntry): boolean {
  const details = entry.details;
  return typeof details === "object" && details !== null && (details as { done?: unknown }).done === true;
}

function provenanceLine(source: "you" | "shared", updatedOn: string | null): string {
  const who = source === "you" ? "Yours" : "Shared by another doctor";
  return `${who} · ${updatedOn ? `Updated ${formatUpdatedMonth(updatedOn)}` : "No date recorded"}`;
}

/**
 * One "Before" row: a login or access entry, own or shared. Own rows carry a
 * real saved tick (its own 48px tap area) and an Edit control; shared rows are
 * read-only, with "Shared by another doctor" in place of the tick. A row with
 * no tick sits flush (no empty 48px gutter); a done one shows a quiet "Done".
 */
export function AdminNewJobStepRow({
  entry,
  source,
  onToggle,
  onEdit,
}: {
  entry: OnCallEntry;
  source: "you" | "shared";
  /** Omit to render no tick at all (shared rows). */
  onToggle?: (entry: OnCallEntry, done: boolean) => void;
  onEdit?: (entry: OnCallEntry) => void;
}) {
  const phone = detailString(entry, "phone");
  const url = detailString(entry, "url");
  const telHref = onCallTelHref(phone ?? undefined);
  const done = isStepDone(entry);

  return (
    <li
      id={onCallEntryAnchorId(entry.id)}
      tabIndex={-1}
      className="flex min-w-0 items-stretch gap-1 border-b border-[color:var(--border)] px-1 py-1 last:border-b-0"
      data-testid={`admin-new-job-step-${entry.slug}`}
    >
      {onToggle ? (
        <label className={cn(focusRing, "flex min-h-12 min-w-12 shrink-0 cursor-pointer items-center justify-center")}>
          <span className="sr-only">{entry.title}</span>
          <input
            type="checkbox"
            checked={done}
            onChange={(event) => onToggle(entry, event.target.checked)}
            className="size-5 rounded border-[color:var(--border-strong)] accent-[color:var(--command)]"
            data-testid={`admin-new-job-step-${entry.slug}-checkbox`}
          />
        </label>
      ) : null}
      <div className={cn("grid min-w-0 flex-1 gap-0.5 self-center py-1", onToggle ? "px-1" : "px-2")}>
        <span className="break-words text-sm font-medium text-[color:var(--text-heading)]">{entry.title}</span>
        {entry.subtitle ? <span className={cn(textMuted, "break-words text-sm")}>{entry.subtitle}</span> : null}
        {phone && isOnCallPlaceholderNumber(phone) ? (
          <span className="nums inline w-fit break-words text-sm text-[color:var(--text)]">
            {displayPhoneNumber(phone, "own-list")}
          </span>
        ) : phone ? (
          <a
            href={telHref ?? `tel:${phone}`}
            className="nums inline w-fit break-words text-sm text-[color:var(--text)]"
          >
            {displayPhoneNumber(phone, "own-list")}
          </a>
        ) : null}
        <span className={cn(textMuted, "flex min-w-0 flex-wrap items-center gap-x-1 text-xs")}>
          <span>{provenanceLine(source, entry.lastVerifiedAt)}</span>
          {url ? (
            <>
              <span aria-hidden="true">·</span>
              <ExternalTextLink href={url} className="inline-flex min-h-tap items-center gap-0.5 text-xs">
                More info
              </ExternalTextLink>
            </>
          ) : null}
        </span>
      </div>
      {!onToggle && done ? (
        // Read-only (shared, signed out or example rows): the recorded tick as a quiet word, never a control.
        <span
          className={cn(textMuted, "flex shrink-0 items-center gap-1 self-center pr-2 text-xs")}
          data-testid={`admin-new-job-step-${entry.slug}-done`}
        >
          <Check aria-hidden="true" className="size-icon-sm" />
          Done
        </span>
      ) : null}
      {source === "you" && onEdit ? (
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => onEdit(entry)}
            aria-label={`Edit ${entry.title}`}
            data-testid={`admin-new-job-step-${entry.slug}-edit`}
            className={cn(toolbarButton, "shrink-0")}
          >
            <Pencil aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </li>
  );
}
