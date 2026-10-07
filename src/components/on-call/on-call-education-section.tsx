"use client";

import { onCallEntryAnchorId } from "@/components/on-call/on-call-page-anchors";

import { GraduationCap, Pencil } from "lucide-react";

import { cardSurface } from "@/components/card-recipes";
import { OnCallStaleFlag } from "@/components/on-call/on-call-freshness-badge";
import { OnCallVerifyButton } from "@/components/on-call/on-call-verify-button";
import { EmptyState } from "@/components/primitive-recipes/feedback";
import { ExternalTextLink } from "@/components/ui/link";
import { cn, eyebrowText, metadataPillDensity, textMuted, toolbarButton } from "@/components/ui-primitives";
import {
  isOnCallHttpUrl,
  onCallDetailsSchemaFor,
  onCallEntryFreshness,
  type OnCallEntry,
  onCallEntryIsEditable,
} from "@/lib/on-call/entry-model";
import { onCallLocalDateKey } from "@/lib/on-call/local-date";
import { onCallTeachingDate, onCallTeachingDateLabel } from "@/lib/on-call/teaching-schedule";

export interface OnCallEducationSectionProps {
  entries: readonly OnCallEntry[];
  /** Injectable for deterministic tests; defaults to the real clock. */
  now?: Date;
  testId?: string;
  /** Opens the entry editor for this row. Omitted when the viewer cannot edit. */
  onEditEntry?: (entry: OnCallEntry) => void;
  /** One-tap "still correct today"; shown only on a stale entry. */
  onVerified?: (entry: OnCallEntry) => void;
}

interface OnCallEducationDetails {
  recurrence?: string;
  nextOccurrence?: string;
  presenter?: string;
  location?: string;
  recordingUrl?: string;
  topics: readonly string[];
}

function parseEducationDetails(details: unknown): OnCallEducationDetails | null {
  const result = onCallDetailsSchemaFor("education").safeParse(details);
  return result.success ? (result.data as OnCallEducationDetails) : null;
}

/**
 * Undated sessions (where `!date`) sort safely after dated ones by assigning
 * `POSITIVE_INFINITY` rather than parsing free text via `new Date()`, then
 * tiebreaking by title.
 */
export function occurrenceSortKey(): number {
  return Number.POSITIVE_INFINITY;
}

/**
 * Cleans the owner's free-text occurrence to remove stale relative phrases
 * ("next week", "in \d+ days", "tomorrow", "today", "yesterday", "later this month",
 * "this week") and redundant day names ("Thursday"), preserving other owner
 * qualifications (e.g. "1pm, weeks 1–10" or "noon during term").
 */
export function cleanOccurrenceTime(owner: string | null): string | null {
  if (!owner) return null;
  const cleaned = owner
    .replace(/\b(?:next|this)\s+week\b/gi, "")
    .replace(/\bin\s+\d+\s+days?\b/gi, "")
    .replace(/\b(?:tomorrow|today|yesterday|later\s+this\s+month|next\s+month|this\s+month)\b/gi, "")
    .replace(
      /\b(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/gi,
      "",
    )
    .replace(/^[\s,·\-/–—@]+|[\s,·\-/–—]+$/g, "")
    .trim();

  if (!cleaned) return null;
  return cleaned;
}

/**
 * Where this page orders from, and what its "Next" pill says.
 *
 * A session that repeats is asked for its NEXT occurrence rather than the date
 * somebody typed into it months ago — the same roll-forward the home uses, so
 * the two screens cannot disagree about when journal club is.
 *
 * When `date` is present, `owner` is cleaned of stale relative phrases and
 * redundant day names while preserving the owner's non-stale qualifications.
 * If wording remains, it is joined with the computed date label.
 * If nothing remains (or the owner text was only a relative phrase), show only
 * `onCallTeachingDateLabel(date)`.
 *
 * Sessions with no computable date sort safely after every dated entry with
 * `Number.POSITIVE_INFINITY` without parsing free text, tiebreaking alphabetically
 * by title.
 */
function resolvedOccurrence(details: OnCallEducationDetails | null, entry: OnCallEntry, today: string) {
  const date = onCallTeachingDate(entry, today);
  const owner = details?.nextOccurrence?.trim() || null;
  const time = date ? cleanOccurrenceTime(owner) : null;
  const label = date ? (time ? `${onCallTeachingDateLabel(date)}, ${time}` : onCallTeachingDateLabel(date)) : owner;

  return {
    date,
    label,
    sortKey: (() => {
      if (!date) return occurrenceSortKey();
      const parsed = Date.parse(`${date}T00:00:00Z`);
      return Number.isNaN(parsed) ? occurrenceSortKey() : parsed;
    })(),
  };
}

function EducationCard({
  entry,
  now,
  today,
  onEditEntry,
  onVerified,
}: {
  entry: OnCallEntry;
  now: Date;
  /** `YYYY-MM-DD`, computed once by the section so every card agrees. */
  today: string;
  onEditEntry?: (entry: OnCallEntry) => void;
  onVerified?: (entry: OnCallEntry) => void;
}) {
  const details = parseEducationDetails(entry.details);
  const occurrence = resolvedOccurrence(details, entry, today);
  const freshness = onCallEntryFreshness(entry, now);
  const showVerify = freshness.state === "stale" && Boolean(onVerified);

  return (
    <article
      id={onCallEntryAnchorId(entry.id)}
      tabIndex={-1}
      // The shared recipe, not a hand-rolled copy of it: these three had every
      // class right except `forced-colors:border`, so in Windows High Contrast
      // the card edge disappeared.
      className={cn(cardSurface, "grid grid-cols-[minmax(0,1fr)] gap-3 p-4")}
      data-testid={`on-call-education-card-${entry.slug}`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-[color:var(--text)]">{entry.title}</h3>
          {details?.presenter ? <p className={cn("mt-0.5 text-xs", textMuted)}>{details.presenter}</p> : null}
        </div>
        {/* Sibling to the card content, never inside a link: the recording
            link below is its own `<a>`, and a `<button>` inside an `<a>` is
            invalid, duplicate-interactive markup. */}
        <div className="flex shrink-0 items-center gap-1.5">
          <OnCallStaleFlag freshness={freshness} />
          {showVerify && onVerified ? <OnCallVerifyButton entry={entry} onVerified={onVerified} /> : null}
          {onEditEntry ? (
            <button
              type="button"
              onClick={() => onEditEntry(entry)}
              aria-label={`Edit ${entry.title}`}
              data-testid={`on-call-education-edit-${entry.slug}`}
              className={cn(toolbarButton, "shrink-0")}
            >
              <Pencil aria-hidden className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-1.5">
        {occurrence.label ? (
          <span className={cn(metadataPillDensity.standard, "rounded-full")}>Next: {occurrence.label}</span>
        ) : null}
        {details?.recurrence ? (
          <span className={cn(metadataPillDensity.standard, "rounded-full")}>{details.recurrence}</span>
        ) : null}
        {details?.location ? (
          <span className={cn(metadataPillDensity.standard, "rounded-full")}>{details.location}</span>
        ) : null}
      </div>

      {details && details.topics.length > 0 ? (
        <p className="text-sm">
          <span className="font-semibold text-[color:var(--text)]">Topics: </span>
          <span className={textMuted}>{details.topics.join(", ")}</span>
        </p>
      ) : null}

      {isOnCallHttpUrl(details?.recordingUrl) ? (
        // Marked as leaving the app: `ExternalTextLink` is the one component
        // that carries the visible glyph, the sr-only "(opens in a new tab)",
        // and `rel="noopener noreferrer"` together — never a bare anchor.
        // http(s) only: a `javascript:` link stored before the schema refused
        // one is not drawn at all.
        <ExternalTextLink href={details.recordingUrl} className="min-h-tap items-center text-sm">
          Watch recording
        </ExternalTextLink>
      ) : null}
    </article>
  );
}

/**
 * The Teaching (`education`) section: the calendar in order of next
 * occurrence, each card naming what, when, who presents, and — once one
 * exists — a recording link explicitly marked as leaving the app.
 *
 * "Next occurrence" is the computed one. A session carrying a structured
 * recurrence (`details.recurrenceRule`) is rolled forward to its next real
 * date, so this page stops advertising a Thursday that went by in January —
 * the same failure the home's "Coming up" block had, and the same fix.
 */
export function OnCallEducationSection({
  entries,
  now = new Date(),
  testId = "on-call-education-section",
  onEditEntry,
  onVerified,
}: OnCallEducationSectionProps) {
  const educationEntries = entries.filter((entry) => entry.section === "education");

  if (educationEntries.length === 0) {
    return (
      <EmptyState
        icon={GraduationCap}
        title="No teaching sessions yet"
        body="Sessions you add will appear here, ordered by their next occurrence."
        testId="on-call-education-empty"
      />
    );
  }

  const today = onCallLocalDateKey(now);
  const sorted = [...educationEntries].sort((a, b) => {
    const aKey = resolvedOccurrence(parseEducationDetails(a.details), a, today).sortKey;
    const bKey = resolvedOccurrence(parseEducationDetails(b.details), b, today).sortKey;
    // Compared, not subtracted: two undated sessions both key to Infinity, and
    // Infinity - Infinity is NaN, which sort() treats as "equal" and so skipped
    // the alphabetical tiebreak the comment on `occurrenceSortKey` promises.
    if (aKey !== bKey) return aKey < bKey ? -1 : 1;
    return a.title.localeCompare(b.title);
  });

  return (
    <div data-testid={testId} className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <h3 className={eyebrowText}>Next occurrence first</h3>
      {sorted.map((entry) => (
        <EducationCard
          key={entry.id}
          entry={entry}
          now={now}
          today={today}
          onEditEntry={onCallEntryIsEditable(entry) ? onEditEntry : undefined}
          onVerified={onCallEntryIsEditable(entry) ? onVerified : undefined}
        />
      ))}
    </div>
  );
}
