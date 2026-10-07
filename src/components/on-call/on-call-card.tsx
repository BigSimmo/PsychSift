"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Phone } from "lucide-react";

import { InformationPageShell } from "@/components/information-page-shell";
import { OnCallCardNavHeader } from "@/components/on-call/on-call-nav-header";
import { ON_CALL_SECTION_TITLES } from "@/components/on-call/on-call-section-identity";
import { onCallViewForEntry } from "@/components/on-call/on-call-entry-view";
import { OnCallLoadFailed } from "@/components/on-call/on-call-load-failed";
import { OnCallSignedOut } from "@/components/on-call/on-call-signed-out";
import { OnCallOfflineBanner } from "@/components/on-call/on-call-offline-banner";
import { OnCallEmptyState } from "@/components/on-call/kit/empty-state";
import { cn, textMuted } from "@/components/ui-primitives";
import { BrowserPrintButton, PrintOutput, PrintSection } from "@/components/ui/print-output";
import { OnCallCardQr } from "@/components/on-call/on-call-card-qr";
import { formatClinicalDate } from "@/lib/source-metadata";
import { selectCardEntries } from "@/lib/on-call/card-selection";
import { onCallTelHref } from "@/lib/on-call/home-modules";
import { useOnCallEntries } from "@/lib/on-call/entry-store";
import { ON_CALL_SECTIONS, type OnCallEntry } from "@/lib/on-call/entry-model";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";

/**
 * Numbers a card entry might carry, read loosely across every section's
 * `details` shape rather than one per-section schema. The card exists to be
 * carried, not to reproduce each section's own layout, so any entry — a
 * contact, a referral service, a logistics line — surfaces whichever of these
 * fields it has.
 */
const CARD_NUMBER_FIELDS: ReadonlyArray<{ label: string; key: string }> = [
  { label: "Direct", key: "phone" },
  { label: "After hours", key: "afterHoursPhone" },
  { label: "Pager", key: "pager" },
  // `extension` was missing here until 2026-09-19, and a ward stores its number
  // in that field and nothing else — so every ward flagged for the card printed
  // as a title and a subtitle with no number under it. The same omission was
  // found and fixed in `on-call-contacts-section.tsx` (see its own note on "the
  // number this row rings"); this copy never got it, and nothing tested paper.
  // Ordered after `pager` to match `onCallPrimaryNumber`'s own preference
  // ladder in `home-modules.ts`, so the card cannot lead with a different
  // number from the one the app dials.
  { label: "Ext", key: "extension" },
  { label: "Fax", key: "fax" },
];

function cardEntryNumbers(details: unknown): Array<{ label: string; value: string }> {
  if (typeof details !== "object" || details === null) return [];
  const record = details as Record<string, unknown>;
  return CARD_NUMBER_FIELDS.flatMap(({ label, key }) => {
    const value = record[key];
    return typeof value === "string" && value.trim().length > 0 ? [{ label, value }] : [];
  });
}

/**
 * Only a direct or after-hours number is a tap-to-call link. A pager ID, a ward
 * extension or a fax number is printed but never dialled: until 2026-09-24 this
 * file had its own `telHref` that linked any digits, so tapping "Ext: 4410" on
 * the card rang 4410 on the public network. `onCallTelHref` is the mode's one
 * dialling rule and refuses short extensions on its own.
 */
const DIALLABLE_CARD_LABELS = new Set(["Direct", "After hours"]);

function cardTelHref(label: string, raw: string): string | undefined {
  return DIALLABLE_CARD_LABELS.has(label) ? onCallTelHref(raw) : undefined;
}

function sortCardEntries(entries: OnCallEntry[]): OnCallEntry[] {
  return [...entries].sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
}

/**
 * Formats the moment printed as a caller-supplied string: `PrintOutput`
 * deliberately reads no clock of its own (see its own docs), so this page —
 * which is live data, not a deterministic prototype — reads the clock itself,
 * once, at render time.
 */
function formatPrintedAt(now: Date, zone: string): string {
  const formatted = new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: zone,
    timeZoneName: "short",
  }).format(now);
  return `Printed ${formatted}`;
}

/**
 * The printable essentials card (Task 13): a one-page, print-styled summary
 * of whichever entries an owner has explicitly flagged `includeOnCard` —
 * "the thing a junior doctor actually carries in a lanyard pocket." Selection
 * runs through `selectCardEntries`, so a personal number, a number nobody has
 * confirmed in over a year, a compliance requirement and a Who's who role
 * explainer can none of them reach the page regardless of the flag
 * (`src/lib/on-call/card-selection.ts`, which carries the reasoning for each).
 *
 * The card needs no account, matching the six sections it summarises: the
 * shared read already serves these entries to any visitor, and a card walled
 * off from a reader who can see every entry behind it protected nothing.
 *
 * The print action lives in the header's actions sheet, following
 * `DictionaryTermPage`'s "Print entry" row — the one place every converted
 * information page keeps its print control. The header itself is
 * `OnCallCardNavHeader`, in the mode's `*-nav-header.tsx` sibling: that file
 * is where this mode registers its claim on the phone header's addon slot,
 * and `tests/mode-nav-addon-slot.dom.test.tsx` holds it to one claimant.
 */
export function OnCallCard({ now: nowProp }: { now?: Date } = {}) {
  const { entries, loading, isOffline, loadError, retry, cachedAt, signedOut } = useOnCallEntries();
  // Read the clock once per mount. A `new Date()` default parameter re-reads it
  // on every render, so the printed timestamp and the staleness cut-off could
  // both move underneath a page the owner is in the middle of printing.
  const mountedAt = useMemo(() => new Date(), []);
  const now = nowProp ?? mountedAt;
  const { zone } = useWorkTimeZone();

  const cardEntries = selectCardEntries(entries, now);
  // Grouped by the PAGE an entry is on, not the section it is stored in. Two of
  // this mode's pages are views over a stored section behind `details.kind` —
  // Compliance over `logistics`, Who's who over `contacts` — and
  // `ON_CALL_SECTION_TITLES` is keyed by section, so `entry.section` here
  // printed a role explainer under the heading "Contacts", among rows that are
  // numbers you ring.
  //
  // `selectCardEntries` already refuses both view kinds by name, so nothing
  // reaching this line is a view row today. This is the second net, and it is
  // the one that cannot be undone by a change somewhere else: a view row has no
  // matching `OnCallSection`, so it falls into no group and is left off the
  // paper entirely rather than printed under a heading that misnames it. A
  // third view added without a matching exclusion fails the same safe way.
  const groups = ON_CALL_SECTIONS.map((section) => ({
    section,
    entries: sortCardEntries(cardEntries.filter((entry) => onCallViewForEntry(entry) === section)),
  })).filter((group) => group.entries.length > 0);

  return (
    <>
      <OnCallCardNavHeader />
      <InformationPageShell testId="on-call-card-main" width="narrow">
        {/* The header bar above already names the page, so the title is not
            printed a second time; the page keeps its one h1 for assistive tech. */}
        <h1 className="sr-only">Pocket card</h1>
        <p className={cn(textMuted, "text-sm")}>
          Only entries flagged for the card. Personal numbers, compliance requirements, Who&rsquo;s who explainers and
          anything overdue for checking are all left off. Confirm against the live On Call sections before relying on a
          printed copy.
        </p>
        {groups.length > 0 ? (
          <div className="mt-3 print:hidden" data-testid="on-call-card-print">
            <BrowserPrintButton label="Print card" />
          </div>
        ) : null}

        {isOffline && cachedAt ? <OnCallOfflineBanner savedAt={cachedAt} reason={loadError} /> : null}

        {loading && entries.length === 0 ? (
          // Nothing cached yet and the first fetch still in flight. Asserting
          // "nothing is flagged" here would be a claim about the entry set that
          // this component cannot yet make.
          <OnCallEmptyState
            icon={Phone}
            title="Loading the card"
            body="Fetching the entries flagged for this card."
            testId="on-call-card-loading"
          />
        ) : isOffline && entries.length === 0 ? (
          <OnCallLoadFailed reason={loadError} onRetry={retry} />
        ) : signedOut && entries.length === 0 ? (
          <OnCallSignedOut icon={Phone} testId="on-call-card-signed-out" />
        ) : groups.length === 0 ? (
          <OnCallEmptyState
            icon={Phone}
            title="Nothing is flagged for the card yet"
            body="Open an entry in Contacts, Playbook, Referrals, Orientation, Teaching or Admin and flag it for the card to have it appear here. Compliance requirements and Who's who explainers can never appear on the card, and nor can personal numbers or anything overdue for checking."
            actions={
              <Link
                href="/on-call/contacts"
                className="inline-flex min-h-tap items-center rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-3 text-sm font-semibold text-[color:var(--clinical-accent)]"
              >
                Go to contacts
              </Link>
            }
            testId="on-call-card-empty"
          />
        ) : (
          <PrintOutput
            testId="on-call-card-output"
            monochrome
            confidential
            printedAt={formatPrintedAt(now, zone)}
            provenance="PsychSift On Call — pocket card. Confirm against the live app before relying on a printed copy; paper cannot show its own age."
          >
            <div className="mb-4 flex items-start justify-between gap-3 print:mb-3">
              <div className="grid min-w-0 gap-0.5">
                <p className="text-sm font-semibold text-[color:var(--text-heading)]">On Call pocket card</p>
                <p className={cn(textMuted, "text-2xs")}>Scan for the live list</p>
              </div>
              <OnCallCardQr />
            </div>
            <div className="grid gap-5 sm:grid-cols-2 print:grid-cols-2 print:gap-4">
              {groups.map((group) => (
                <PrintSection
                  key={group.section}
                  testId={`on-call-card-group-${group.section}`}
                  className="break-inside-avoid border-b border-[color:var(--border)] pb-4 last:border-b-0"
                >
                  <h2 className="text-xs font-semibold uppercase tracking-kicker text-[color:var(--text-muted)]">
                    {ON_CALL_SECTION_TITLES[group.section]}
                  </h2>
                  <ul className="mt-2 grid gap-3">
                    {group.entries.map((entry) => {
                      const numbers = cardEntryNumbers(entry.details);
                      return (
                        <li key={entry.id} data-testid={`on-call-card-entry-${entry.slug}`}>
                          <p className="text-sm font-medium text-[color:var(--text-heading)]">{entry.title}</p>
                          {entry.subtitle ? (
                            <p className="text-xs text-[color:var(--text-muted)]">{entry.subtitle}</p>
                          ) : null}
                          {numbers.length > 0 ? (
                            <ul className="mt-1 grid gap-0.5">
                              {numbers.map((number) => {
                                const href = cardTelHref(number.label, number.value);
                                const label = `${number.label}: ${number.value}`;
                                return (
                                  <li
                                    key={number.label}
                                    className="nums text-base font-semibold text-[color:var(--text)]"
                                  >
                                    {href ? (
                                      <a
                                        href={href}
                                        className="inline-flex min-h-tap items-center hover:underline print:min-h-0"
                                      >
                                        {label}
                                      </a>
                                    ) : (
                                      label
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          ) : entry.body ? (
                            // A playbook step, an orientation note or a
                            // teaching time has no phone number by design, and
                            // its content is the body. Printing "No number on
                            // file" against those read as a fault in the card
                            // rather than the shape of the entry.
                            <p className="mt-1 whitespace-pre-line text-sm text-[color:var(--text)]">{entry.body}</p>
                          ) : null}
                          {entry.lastVerifiedAt ? (
                            <p className="mt-0.5 text-2xs text-[color:var(--text-muted)]">
                              Checked {formatClinicalDate(entry.lastVerifiedAt)}
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </PrintSection>
              ))}
            </div>
          </PrintOutput>
        )}
      </InformationPageShell>
    </>
  );
}
