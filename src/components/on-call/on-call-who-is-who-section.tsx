"use client";

import { onCallEntryAnchorId } from "@/components/on-call/on-call-page-anchors";

import { Pencil, Users } from "lucide-react";

import { OnCallStaleFlag } from "@/components/on-call/on-call-freshness-badge";
import { OnCallGroupSection } from "@/components/on-call/on-call-group-section";
import { allocateOnCallGroupSlug } from "@/components/on-call/on-call-page-anchors";
import { OnCallVerifyButton } from "@/components/on-call/on-call-verify-button";
import { OnCallEmptyState } from "@/components/on-call/kit/empty-state";
import { cardPadding, cardSurface } from "@/components/card-recipes";
import { cn, eyebrowText, textMuted, toolbarButton } from "@/components/ui-primitives";
import {
  onCallDetailsSchemaFor,
  onCallEntryFreshness,
  type OnCallEntry,
  onCallEntryIsEditable,
} from "@/lib/on-call/entry-model";
import { partitionContactsEntries } from "@/lib/on-call/who-is-who";

export interface OnCallWhoIsWhoSectionProps {
  entries: readonly OnCallEntry[];
  /** Injectable for deterministic tests; defaults to the real clock. */
  now?: Date;
  testId?: string;
  /** Opens the editor pre-filled with this entry. Omit to hide the row's edit control. */
  onEditEntry?: (entry: OnCallEntry) => void;
  /** Handed a freshly-verified entry after a one-tap "still correct" confirm. Omit to hide it. */
  onVerified?: (entry: OnCallEntry) => void;
}

interface OnCallContactDetails {
  role: string;
  availability?: string;
}

function parseContactDetails(details: unknown): OnCallContactDetails | null {
  const result = onCallDetailsSchemaFor("contacts").safeParse(details);
  return result.success ? (result.data as OnCallContactDetails) : null;
}

/**
 * Duplicated deliberately narrowly: `on-call-page-sections.ts` owns the
 * declaration and this owns the rendering, and the pair is pinned by a DOM
 * test that asserts every declared Who's who anchor exists on the page.
 * Importing the list into the header module would make the header depend on
 * the body it sits above.
 */
const RESERVED = ["call-first", "switchboard", "ward", "pinned"];
const UNGROUPED_AREA = "General";

function areaFor(entry: OnCallEntry): string {
  const area = entry.tags
    .map((tag) => tag.trim())
    .find((tag) => tag.length > 0 && !RESERVED.includes(tag.toLowerCase()));
  return area ?? UNGROUPED_AREA;
}

/**
 * One role, explained.
 *
 * Deliberately NOT an `OnCallEntryRow`: that component makes the whole row a
 * `tel:` target, which is right for Contacts and wrong here. A role explainer
 * exists to be read — what this person does, and when it is reasonable to wake
 * them — and giving it a one-tap dial would turn "understand the ladder" into
 * "ring the consultant", which is the opposite of what it is for. The number to
 * ring lives on the Contacts row for the same role.
 */
function RoleCard({
  entry,
  now,
  onEditEntry,
  onVerified,
}: {
  entry: OnCallEntry;
  now: Date;
  onEditEntry?: (entry: OnCallEntry) => void;
  onVerified?: (entry: OnCallEntry) => void;
}) {
  const details = parseContactDetails(entry.details);
  const freshness = onCallEntryFreshness(entry, now);
  const showVerify = freshness.state === "stale" && Boolean(onVerified);

  return (
    <article
      id={onCallEntryAnchorId(entry.id)}
      tabIndex={-1}
      className={cn(cardSurface, cardPadding.standard, "grid grid-cols-[minmax(0,1fr)] gap-2")}
      data-on-call-entry-card=""
      data-testid={`on-call-role-${entry.slug}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 grid gap-0.5">
          <h4 className="text-base font-semibold text-[color:var(--text-heading)]">{entry.title}</h4>
          {details?.role && details.role !== entry.title ? (
            <p className={cn(textMuted, "text-xs")}>{details.role}</p>
          ) : null}
        </div>
        {onEditEntry || showVerify ? (
          <div className="flex shrink-0 items-center gap-1.5">
            {showVerify && onVerified ? <OnCallVerifyButton entry={entry} onVerified={onVerified} /> : null}
            {onEditEntry ? (
              <button
                type="button"
                onClick={() => onEditEntry(entry)}
                aria-label={`Edit ${entry.title}`}
                data-testid={`on-call-role-edit-${entry.slug}`}
                className={cn(toolbarButton, "shrink-0")}
              >
                <Pencil aria-hidden className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* `body` is the owner's own words about the role. It is administrative
          fact — who does what, and when to call them — which AGENTS.md and the
          mode's clinical boundary both allow. Nothing here is app-authored. */}
      {entry.body ? <p className="text-sm leading-6 text-[color:var(--text)]">{entry.body}</p> : null}

      {entry.subtitle ? (
        <p className="text-sm text-[color:var(--text)]">
          <span className={cn(eyebrowText, "mr-1.5")}>When to call</span>
          {entry.subtitle}
        </p>
      ) : null}

      {details?.availability ? <p className={cn(textMuted, "text-xs")}>{details.availability}</p> : null}

      <OnCallStaleFlag freshness={freshness} />
    </article>
  );
}

/**
 * Who's who — what each role does and when to call them, the on-call ladder in
 * words, and the local acronyms.
 *
 * These are `contacts` rows carrying `details.kind: "role-explainer"`, so they
 * need no new section value and therefore no migration. `partitionContactsEntries`
 * is the one place they are separated from ordinary contacts.
 */
export function OnCallWhoIsWhoSection({
  entries,
  now = new Date(),
  testId = "on-call-who-is-who-section",
  onEditEntry,
  onVerified,
}: OnCallWhoIsWhoSectionProps) {
  const { roleExplainers } = partitionContactsEntries(entries);

  if (roleExplainers.length === 0) {
    return (
      <OnCallEmptyState
        icon={Users}
        title="No roles explained yet"
        body={
          onEditEntry
            ? "What each role does, when it is reasonable to call them, and what the local acronyms mean. Add one from this page."
            : "What each role does, when it is reasonable to call them, and what the local acronyms mean. Sign in to add the roles at your service."
        }
        testId="on-call-who-is-who-empty"
      />
    );
  }

  const byArea = new Map<string, OnCallEntry[]>();
  for (const entry of roleExplainers) {
    const area = areaFor(entry);
    const existing = byArea.get(area);
    if (existing) existing.push(entry);
    else byArea.set(area, [entry]);
  }

  const taken = new Set<string>();
  const groups = Array.from(byArea.entries())
    .map(([area, list]) => ({
      area,
      entries: [...list].sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title)),
    }))
    .sort((a, b) => a.area.localeCompare(b.area))
    .map((group) => ({ ...group, slug: allocateOnCallGroupSlug(group.area, taken) }));

  return (
    <div data-testid={testId} className="grid grid-cols-[minmax(0,1fr)] gap-5">
      {groups.map((group) => (
        <OnCallGroupSection
          key={group.slug}
          label={group.area}
          slug={group.slug}
          count={group.entries.length}
          headingId={`on-call-who-is-who-${group.slug}-heading`}
          testId={`on-call-who-is-who-group-${group.slug}`}
        >
          {group.entries.map((entry) => (
            <RoleCard
              key={entry.id}
              entry={entry}
              now={now}
              onEditEntry={onCallEntryIsEditable(entry) ? onEditEntry : undefined}
              onVerified={onCallEntryIsEditable(entry) ? onVerified : undefined}
            />
          ))}
        </OnCallGroupSection>
      ))}
    </div>
  );
}
