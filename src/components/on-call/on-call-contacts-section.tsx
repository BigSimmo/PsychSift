"use client";

import Link from "next/link";
import { Pencil, Phone, Plus, Printer } from "lucide-react";

import { OnCallEntryRow } from "@/components/on-call/on-call-entry-row";
import { OnCallFreshnessBadge } from "@/components/on-call/on-call-freshness-badge";
import { OnCallPrivateFlag } from "@/components/on-call/on-call-private-flag";
import { OnCallVerifyButton } from "@/components/on-call/on-call-entry-editor";
import { Button } from "@/components/ui/button";
import { inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
import { OnCallCallDisc } from "@/components/on-call/on-call-call-disc";
import { OnCallCopyNumber } from "@/components/on-call/on-call-copy-number";
import {
  allocateOnCallGroupSlug,
  onCallGroupAnchorId,
  onCallEntryAnchorId,
} from "@/components/on-call/on-call-page-anchors";
import { modeNumberText, modeSecondaryText } from "@/components/mode-kit/type";
import { EmptyState } from "@/components/primitive-recipes/feedback";
import { eyebrowText, metadataPillDensity, toolbarButton } from "@/components/ui-primitives";
import { cn } from "@/components/ui-primitives";
import {
  onCallDetailsSchemaFor,
  onCallEntryFreshness,
  type OnCallEntry,
  onCallEntryIsEditable,
} from "@/lib/on-call/entry-model";
import { ON_CALL_HOME_TAGS, onCallPrimaryNumber, onCallTelHref } from "@/lib/on-call/home-modules";
import { recordOnCallRecent } from "@/lib/on-call/recent-storage";
import { partitionContactsEntries } from "@/lib/on-call/who-is-who";

/**
 * How the list is ordered, from the page menu's segmented control (board 05).
 *
 * `area` is the default rather than the drawing's pressed "By role". Board 05
 * presses "By role" while board 06 draws area groups, so the drawing
 * contradicts itself; area is the shape that is built, tested and described by
 * the section's own subtitle, and switching the default would change a shipped
 * page for no stated reason.
 *
 * "Needs checking" stays hoisted under `role` and `area` in every case. It is
 * a safety property, not a sort — an overdue number left in place among the
 * good ones is invisible. `overdue` drops the grouping entirely, which is what
 * makes it a different view rather than a relabelling of the default.
 */
export type OnCallContactsOrder = "role" | "area" | "overdue";

export interface OnCallContactsSectionProps {
  entries: readonly OnCallEntry[];
  /** Injectable for deterministic tests; defaults to the real clock. */
  now?: Date;
  testId?: string;
  /** Opens the editor in create mode. Omit to hide "Add contact" (e.g. read-only previews). */
  onAddEntry?: () => void;
  /** Opens the editor pre-filled with this entry. Omit to hide the row's edit control. */
  onEditEntry?: (entry: OnCallEntry) => void;
  /** Handed a freshly-verified entry after a one-tap "still correct" confirm. Omit to hide it. */
  onVerified?: (entry: OnCallEntry) => void;
  /** Chosen in the page menu; defaults to the area grouping this page shipped with. */
  order?: OnCallContactsOrder;
}

interface OnCallContactDetails {
  role: string;
  phone?: string;
  extension?: string;
  afterHoursPhone?: string;
  pager?: string;
  contactName?: string;
  availability?: string;
}

/**
 * There is no dedicated `area` field on the contacts `details` schema (see
 * `src/lib/on-call/entry-model.ts`). `tags` is the categorisation field every
 * entry already carries, so the first tag is the area a role is filed under
 * — "Ward 4B", "ED" — and untagged entries fall into one shared group rather
 * than each becoming a group of one.
 */
const UNTAGGED_AREA = "General";
const NEEDS_CHECKING_HEADING = "Needs checking";

/**
 * The tags that are machinery, not an area.
 *
 * `ON_CALL_HOME_TAGS` are how an owner puts a contact on the dashboard —
 * "call-first" pins it to the call cards, "ward" to the ward strip. They are a
 * control, and they were being read as the row's AREA because the area is the
 * first tag: a contact tagged `call-first` produced a Contacts group headed
 * "call-first" and a filter chip to match. That is machinery leaking onto the
 * page, and it was invisible offline — the browser board spec is what showed
 * it, on a screen with realistic tags on it.
 */
const RESERVED_HOME_TAGS: readonly string[] = Object.values(ON_CALL_HOME_TAGS);

function contactAreaFor(entry: OnCallEntry): string {
  const area = entry.tags
    .map((tag) => tag.trim())
    .find((tag) => tag.length > 0 && !RESERVED_HOME_TAGS.includes(tag.toLowerCase()));
  return area ?? UNTAGGED_AREA;
}

/**
 * The role an entry is filed under, for the "by role" order.
 *
 * `details.role` is required by the contacts schema, but an entry whose
 * `details` fail to parse still has to sort somewhere rather than vanish, so
 * the title stands in.
 */
function roleNameFor(entry: OnCallEntry): string {
  return parseContactDetails(entry.details)?.role?.trim() || entry.title;
}

/** The chip row filters on the same area the groups are headed by. */

function parseContactDetails(details: unknown): OnCallContactDetails | null {
  const result = onCallDetailsSchemaFor("contacts").safeParse(details);
  return result.success ? (result.data as OnCallContactDetails) : null;
}

function ContactRow({
  entry,
  now,
  onEdit,
  onVerified,
}: {
  entry: OnCallEntry;
  now: Date;
  onEdit?: (entry: OnCallEntry) => void;
  onVerified?: (entry: OnCallEntry) => void;
}) {
  const details = parseContactDetails(entry.details);
  const freshness = onCallEntryFreshness(entry, now);
  // A personal line shows as "Private · only you" and NOTHING else — board
  // 06's own note: "the rule is visible without the number being". This is the
  // owner's own screen, so the digits are not withheld from them for secrecy;
  // they are withheld from the room. A private mobile printed in a list is
  // readable by whoever is standing behind you at the nurses' station, and the
  // owner can still open the entry to see it.
  // `onCallPrimaryNumber`, not a second copy of the same idea. The copy that
  // used to live in this file omitted `extension`, so a ward with only an
  // extension rendered "No number on file" WITH its extension in a pill beside
  // it, and the row would not dial — while the home's ward strip, reading the
  // shared helper, dialled the same contact happily. Two answers to "what does
  // this row ring".
  // `now` is passed through, not left to default: which number is primary now
  // depends on whether it is in or out of hours, and this page already injects a
  // clock so its rendering is deterministic under test.
  const primary = entry.isPersonal ? null : onCallPrimaryNumber(entry, now);
  const href = primary?.label === "Ext" || primary?.label === "Pager" ? undefined : onCallTelHref(primary?.value);

  const otherNumbers =
    details && !entry.isPersonal
      ? [
          details.phone && details.phone !== primary?.value ? `Direct ${details.phone}` : null,
          details.afterHoursPhone && details.afterHoursPhone !== primary?.value
            ? `After hours ${details.afterHoursPhone}`
            : null,
          details.pager && details.pager !== primary?.value ? `Pager ${details.pager}` : null,
          details.extension && details.extension !== primary?.value ? `Ext ${details.extension}` : null,
        ].filter((value): value is string => Boolean(value))
      : [];

  const showVerify = freshness.state === "stale" && Boolean(onVerified);
  const numberLabel = primary
    ? `${primary.label === "Ext" ? "Ext " : primary.label === "Pager" ? "Pager " : ""}${primary.value}`
    : null;
  // Availability / contact name sit under the phone line (or under the role
  // when there is no number). Personal rows stay digit-free in a shared list.
  const secondaryLine = entry.isPersonal ? null : (details?.availability ?? details?.contactName ?? null);
  // Shared rows always keep the dial/copy column, even with no number — same
  // idea as OnCallDialRow's disc spacer — so a missing number cannot jog the
  // trailing edge of the list. Personal rows only grow the column when edit
  // or verify actually has something to put there.
  const showTrailingColumn = !entry.isPersonal || Boolean(onEdit) || showVerify;

  return (
    <div className="flex items-stretch gap-2" id={onCallEntryAnchorId(entry.id)} tabIndex={-1}>
      <div className="min-w-0 flex-1">
        <OnCallEntryRow
          title={entry.title}
          // Role takes the full width of the text column; the phone sits on the
          // line below (in children), not beside the title in a trailing slot.
          icon={href ? Phone : undefined}
          href={href}
          onActivate={() => recordOnCallRecent({ id: entry.id, title: entry.title })}
          trailing={
            href ? (
              <OnCallCallDisc />
            ) : !entry.isPersonal ? (
              // Holds the disc's place so dial/copy stay lined up when a row
              // has no tel: target (extension-only, pager, or no number).
              <span aria-hidden="true" data-contact-row-disc-spacer="" className="size-9 shrink-0" />
            ) : undefined
          }
          testId={`on-call-contact-row-${entry.slug}`}
        >
          {numberLabel ? (
            <span
              data-contact-row-number=""
              className={cn(modeNumberText, "w-full break-words text-sm text-[color:var(--text)]")}
            >
              {numberLabel}
            </span>
          ) : null}
          {secondaryLine ? <span className={cn(modeSecondaryText, "w-full break-words")}>{secondaryLine}</span> : null}
          {entry.isPersonal || primary ? null : (
            <span className={cn(metadataPillDensity.standard, "rounded-full")}>No number on file</span>
          )}
          {otherNumbers.map((label) => (
            <span key={label} className={cn(metadataPillDensity.standard, "rounded-full")}>
              {label}
            </span>
          ))}

          {/* The rule made visible without the number being: board 06 shows a
              personal line as "Private · only you" and nothing else. */}
          {entry.isPersonal ? <OnCallPrivateFlag /> : null}
          {/* Only when it is telling the reader something. Board 06 badges the
              overdue rows and leaves the current ones clean; a "checked" stamp
              on all forty of them is a second line per row that says the page
              is working. */}
          {freshness.state === "stale" ? <OnCallFreshnessBadge freshness={freshness} /> : null}
        </OnCallEntryRow>
      </div>
      {/* Sibling to the row, never nested inside it: the row's own tap target is
          already a `tel:` link, and a `<button>` inside an `<a>` is invalid,
          duplicate-interactive markup. The copy control joins this column for
          the same reason — it is a real `<button>` and the row is a real `<a>`.
          A personal entry gets no copy control at all: the page withholds those
          digits from the room, and a control that copies them hands them out. */}
      {showTrailingColumn ? (
        <div
          data-contact-row-actions=""
          className="flex w-12 shrink-0 flex-col items-center justify-center gap-1.5 self-stretch"
        >
          {primary ? (
            <OnCallCopyNumber
              value={primary.value}
              // Names the number AND the contact, because the glyph alone tells
              // a screen-reader user neither.
              label={`Copy ${primary.label === "Ext" ? "extension" : primary.label + " number"} for ${entry.title}`}
              testId={`on-call-contact-copy-${entry.slug}`}
            />
          ) : !entry.isPersonal ? (
            <span aria-hidden="true" data-contact-row-copy-spacer="" className="min-h-12 w-12 shrink-0" />
          ) : null}
          {showVerify && onVerified ? <OnCallVerifyButton entry={entry} onVerified={onVerified} /> : null}
          {onEdit ? (
            <button
              type="button"
              onClick={() => onEdit(entry)}
              aria-label={`Edit ${entry.title}`}
              data-testid={`on-call-contact-edit-${entry.slug}`}
              className={cn(toolbarButton, "shrink-0")}
            >
              <Pencil aria-hidden className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The contacts section: one scrolling column of role rows, grouped by area,
 * with anything overdue for checking collected into its own group at the
 * TOP of the page rather than left to sort itself out at the bottom (spec
 * §8.4). This is the page built for one hand in a corridor at 2am — the
 * whole row rings the number, there is nothing smaller to aim for.
 */
export function OnCallContactsSection({
  entries,
  now = new Date(),
  testId = "on-call-contacts-section",
  onAddEntry,
  onEditEntry,
  onVerified,
  order = "area",
}: OnCallContactsSectionProps) {
  // Role explainers share this section's rows but are not numbers to ring, so
  // they render on Who's who instead. Splitting here rather than at the page
  // keeps the two lists derived from one function
  // (`src/lib/on-call/who-is-who.ts`), so neither can drift into showing the
  // other's entries.
  const { contacts: allContacts } = partitionContactsEntries(entries);
  const contactEntries = allContacts;

  const addButton = onAddEntry ? (
    <Button variant="secondary" size="sm" icon={Plus} onClick={onAddEntry} testId="on-call-contacts-add">
      Add contact
    </Button>
  ) : undefined;

  const cardLink = (
    <Link
      href="/on-call/card"
      data-testid="on-call-contacts-card-link"
      className="inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm font-semibold text-[color:var(--text-muted)] transition hover:border-[color:var(--border-strong)] hover:text-[color:var(--text-heading)]"
    >
      <Printer className="h-4 w-4 shrink-0" aria-hidden />
      Pocket card
    </Link>
  );

  if (allContacts.length === 0) {
    return (
      <EmptyState
        icon={Phone}
        title="No contacts yet"
        body="Contacts you add will appear here, grouped by area, with the whole row set up to ring the number."
        actions={
          // The card link belongs here too. It is the only route to
          // `/on-call/card`, and the card can already hold flagged playbook,
          // referral or logistics entries while Contacts is still empty —
          // dropping the link with the list stranded that page.
          <div className="flex flex-wrap items-center justify-center gap-2">
            {addButton}
            {cardLink}
          </div>
        }
        testId="on-call-contacts-empty"
      />
    );
  }

  const needsChecking: OnCallEntry[] = [];
  const byArea = new Map<string, OnCallEntry[]>();

  for (const entry of contactEntries) {
    if (onCallEntryFreshness(entry, now).state === "stale") {
      needsChecking.push(entry);
      continue;
    }
    const area = contactAreaFor(entry);
    const existing = byArea.get(area);
    if (existing) existing.push(entry);
    else byArea.set(area, [entry]);
  }

  const sortEntries = (list: OnCallEntry[]) =>
    [...list].sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));

  /**
   * "By role" sorts by the role, which is not what `sortOrder` holds.
   *
   * `sortOrder` is the owner's ordering WITHIN an area — everyone on Ward 4B
   * numbered 1, 2, 3, and everyone in ED numbered 1, 2, 3 as well. Flattening
   * the areas and re-sorting on it interleaves the two by a number that means
   * nothing across them, which is an arbitrary order wearing the label "by
   * role". So this reads `details.role` and sorts alphabetically, falling back
   * to the entry's title when a row has no role recorded.
   */
  const sortByRole = (list: OnCallEntry[]) =>
    [...list].sort((a, b) => roleNameFor(a).localeCompare(roleNameFor(b)) || a.title.localeCompare(b.title));

  // Same seed and same alphabetical walk as `contactGroups` in
  // on-call-page-sections.ts, so a colliding pair of areas gets the same
  // disambiguated slugs on both sides of the jump.
  const takenSlugs = new Set<string>(["needs-checking"]);
  const areaGroups = Array.from(byArea.entries())
    .map(([area, list]) => ({ area, entries: sortEntries(list) }))
    .sort((a, b) => a.area.localeCompare(b.area))
    .map((group) => ({ ...group, slug: allocateOnCallGroupSlug(group.area, takenSlugs) }));

  return (
    <div data-testid={testId} className="grid gap-5">
      {/* Nothing above the first group.
          ---------------------------------------------------------------
          Two rows used to sit here. A toolbar carrying "Printable card" and
          "Add contact", both of which are already rows in this page's actions
          sheet. And a chip row reading All / Tonight / Wards / Services /
          Admin — the same words as the group headings below it and the same
          words as the header's jump list, three ways to reach Wards on one
          screen.

          The chips also did something subtly worse than jumping: they HID the
          other groups, so a mistap cost the reader the list rather than their
          place. The header's jump list takes you to a group and leaves the
          page whole, which is what a reader wanted from the chips anyway.

          The empty state below keeps both buttons, because there they are the
          only thing on the page. */}
      {order !== "overdue" && needsChecking.length > 0 ? (
        <section
          id={onCallGroupAnchorId("needs-checking")}
          aria-labelledby="on-call-contacts-needs-checking-heading"
          className={cn(inPageAnchor, "grid gap-2")}
        >
          <div
            className={cn(
              "sticky top-0 z-[var(--z-raised)] flex items-center gap-1.5 bg-[color:var(--background)] py-1",
            )}
          >
            <h3 id="on-call-contacts-needs-checking-heading" className={eyebrowText}>
              {NEEDS_CHECKING_HEADING}
            </h3>
            {/* Outside the heading, and hidden from assistive technology: the
                drawing puts a count beside each group, but folding it into the
                heading's accessible name turns "Needs checking" into "Needs
                checking 3", and the list underneath already carries its own
                length. */}
            <span aria-hidden="true" className="nums text-2xs font-medium text-[color:var(--text-muted)]">
              {needsChecking.length}
            </span>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2" data-testid="on-call-contacts-group-needs-checking">
            {sortEntries(needsChecking).map((entry) => (
              <ContactRow
                key={entry.id}
                entry={entry}
                now={now}
                onEdit={onCallEntryIsEditable(entry) ? onEditEntry : undefined}
                onVerified={onCallEntryIsEditable(entry) ? onVerified : undefined}
              />
            ))}
          </div>
        </section>
      ) : null}

      {order === "role" ? renderFlatGroup(sortByRole(Array.from(byArea.values()).flat()), "role") : null}

      {/* No groups at all — the overdue rows lead, each still badged. This is
          the owner's maintenance view, and the one order that does not hoist
          "Needs checking" into a heading of its own, because the whole list is
          already in that order. */}
      {order === "overdue"
        ? renderFlatGroup(
            [...sortEntries(needsChecking), ...sortEntries(Array.from(byArea.values()).flat())],
            "overdue",
          )
        : null}

      {order !== "area"
        ? null
        : areaGroups.map((group) => {
            const slug = group.slug;
            const headingId = `on-call-contacts-area-${slug}-heading`;
            return (
              <section
                key={group.area}
                id={onCallGroupAnchorId(slug)}
                aria-labelledby={headingId}
                className={cn(inPageAnchor, "grid gap-2")}
              >
                <div className="sticky top-0 z-[var(--z-raised)] flex items-center gap-1.5 bg-[color:var(--background)] py-1">
                  <h3 id={headingId} className={eyebrowText}>
                    {group.area}
                  </h3>
                  <span aria-hidden="true" className="nums text-2xs font-medium text-[color:var(--text-muted)]">
                    {group.entries.length}
                  </span>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)] gap-2" data-testid={`on-call-contacts-group-${slug}`}>
                  {group.entries.map((entry) => (
                    <ContactRow
                      key={entry.id}
                      entry={entry}
                      now={now}
                      onEdit={onCallEntryIsEditable(entry) ? onEditEntry : undefined}
                      onVerified={onCallEntryIsEditable(entry) ? onVerified : undefined}
                    />
                  ))}
                </div>
              </section>
            );
          })}
    </div>
  );

  function renderFlatGroup(list: OnCallEntry[], variant: "role" | "overdue") {
    if (list.length === 0) return null;
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2" data-testid={`on-call-contacts-group-${variant}`}>
        {list.map((entry) => (
          <ContactRow
            key={entry.id}
            entry={entry}
            now={now}
            onEdit={onCallEntryIsEditable(entry) ? onEditEntry : undefined}
            onVerified={onCallEntryIsEditable(entry) ? onVerified : undefined}
          />
        ))}
      </div>
    );
  }
}
