"use client";

import { Briefcase, CalendarDays, CalendarRange, Moon, Printer, WifiOff } from "lucide-react";
import Link from "next/link";

import { focusRing } from "@/components/card-recipes";
import { onCallActionLink, onCallLeadingIcon } from "@/components/on-call/kit/calm";
import { OnCallRow } from "@/components/on-call/kit/grouped-list";
import { NowShiftLists } from "@/components/on-call/now/shift-lists";
import { ON_CALL_FIND_DOWNTIME_HREF, ON_CALL_ON_SITE_HREF } from "@/components/on-call/on-call-section-identity";
import type { RosterShiftsState } from "@/components/roster/use-roster-shifts";
import { cn, eyebrowText } from "@/components/ui-primitives";
import { useOnCallChecklists } from "@/lib/on-call/checklist-storage";
import { onCallFirstNightProgress } from "@/lib/on-call/first-night";
import type { HandbookItem } from "@/lib/on-call/handbook-items";
import type { OnCallShiftContext } from "@/lib/on-call/shift-context";

/** One situation row: a ladder the reader or the hospital recorded. */
export type OnCallSituation = { readonly id: string; readonly title: string; readonly href: string };

/**
 * "Who do I call now?" (mock-up v10 Now): one row per recorded situation,
 * each opening its ladder, and "Escalation ladder" at the right. Situations come
 * only from ladders that exist (the reader's own Playbook and the hospital's);
 * with none, the action still opens the page that says so.
 */
export function NowWhoToCall({
  situations,
  reminder = null,
}: {
  readonly situations: readonly OnCallSituation[];
  /**
   * The pinned Playbook reminder ("You are expected to wake the consultant."):
   * a statement to read, so it is plain text under the heading, never a chip
   * that looks like a choice.
   */
  readonly reminder?: string | null;
}) {
  return (
    <section aria-labelledby="on-call-now-who-heading" className="grid min-w-0 gap-1" data-testid="on-call-now-who">
      <div className="flex min-h-12 min-w-0 flex-wrap items-center justify-between gap-x-3 px-1">
        <h2 id="on-call-now-who-heading" className={eyebrowText}>
          Who do I call now?
        </h2>
        {/* A literal href: the route-reachability guard reads literal hrefs only. */}
        <Link href="/on-call/playbook" data-testid="on-call-home-call-now" className={cn(onCallActionLink, focusRing)}>
          Playbook
        </Link>
      </div>
      {reminder ? (
        <p
          className="min-w-0 break-words px-1 pb-1 text-sm leading-5 text-[color:var(--text)]"
          data-testid="on-call-now-who-reminder"
        >
          {reminder}
        </p>
      ) : null}
      {situations.length > 0 ? (
        // One grouped list, a row per situation (polish pass, 12 Oct 2026): chips stacked unevenly at 320px.
        <ul role="list" className="work-card min-w-0">
          {situations.map((situation) => (
            <OnCallRow
              key={situation.id}
              title={situation.title}
              href={situation.href}
              testId={`on-call-now-situation-${situation.id}`}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * Unused since 12 Oct 2026: Now dropped this list (Work mode simplify plan, owner approval) and kept
 * only the shift lists, in the shift tools card. Kept under the 30-day dead-code rule.
 *
 * "More for this shift" (mock-up v10 Now): the shift lists with their bar,
 * Systems down, First night with its real tick count, and the one-line On site
 * link to Admin. Handover and Shift pulse moved up the page as their own
 * shortcuts; "Who do I call now?" became the situation chips.
 */
export function NowFooter({
  context,
  shifts,
  items,
  now,
}: {
  readonly context: OnCallShiftContext;
  readonly shifts: RosterShiftsState;
  /** The hospital's items when the handbook is ready; empty otherwise. */
  readonly items: readonly HandbookItem[];
  readonly now: Date;
}) {
  const ticked = useOnCallChecklists();
  const firstNight = onCallFirstNightProgress(ticked);
  return (
    <nav aria-labelledby="on-call-now-footer-heading" className="grid min-w-0 gap-1" data-testid="on-call-now-footer">
      <h2 id="on-call-now-footer-heading" className={cn(eyebrowText, "flex min-h-12 items-center px-1")}>
        More for this shift
      </h2>
      {/* One flat white card, every row with its icon circle (work-mode
          redesign, owner request 6 Oct 2026). A row that leaves On Call takes
          the colour of where it goes, as the work-mode kit does. */}
      <ul role="list" className="work-card min-w-0">
        <OnCallRow
          title="My shifts"
          subtitle="Your own roster"
          leading={
            <CalendarDays
              aria-hidden="true"
              strokeWidth={2}
              className={onCallLeadingIcon}
              data-mode-identity="roster"
            />
          }
          href="/roster"
          testId="on-call-now-footer-shifts"
        />
        <OnCallRow
          title="Pocket card"
          subtitle="One printable page"
          leading={<Printer aria-hidden="true" strokeWidth={2} className={onCallLeadingIcon} />}
          href="/on-call/card"
          testId="on-call-now-footer-card"
        />
        <OnCallRow
          title="Calendar"
          subtitle="Teaching and recorded dates"
          leading={
            <CalendarRange
              aria-hidden="true"
              strokeWidth={2}
              className={onCallLeadingIcon}
              data-mode-identity="roster"
            />
          }
          href="/roster/calendar"
          testId="on-call-now-footer-calendar"
        />
        <NowShiftLists context={context} shifts={shifts} items={items} now={now} />
        <OnCallRow
          title="Systems down"
          subtitle="When computers or phones fail"
          leading={<WifiOff aria-hidden="true" strokeWidth={2} className={onCallLeadingIcon} />}
          href={ON_CALL_FIND_DOWNTIME_HREF}
          testId="on-call-now-systems-down"
        />
        {/* Literal hrefs: the route-reachability guard reads only those. */}
        <OnCallRow
          title="First night"
          subtitle={`Guided path · ${firstNight.done} of ${firstNight.total} done`}
          leading={<Moon aria-hidden="true" strokeWidth={2} className={onCallLeadingIcon} />}
          href="/on-call/first-night"
          testId="on-call-home-first-night"
        />
        <OnCallRow
          title="On site"
          subtitle="Parking, food, access · in Admin"
          leading={<Briefcase aria-hidden="true" strokeWidth={2} className={onCallLeadingIcon} />}
          href={ON_CALL_ON_SITE_HREF}
          testId="on-call-now-on-site"
        />
      </ul>
    </nav>
  );
}
