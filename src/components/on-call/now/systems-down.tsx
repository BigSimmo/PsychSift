"use client";

import { Briefcase, CalendarDays, CalendarRange, Moon, Printer, WifiOff } from "lucide-react";
import Link from "next/link";

import { focusRing } from "@/components/card-recipes";
import { onCallActionLink, onCallChipShape, onCallChipTap, onCallLeadingIcon } from "@/components/on-call/kit/calm";
import { OnCallRow } from "@/components/on-call/kit/grouped-list";
import { NowShiftLists } from "@/components/on-call/now/shift-lists";
import { ON_CALL_FIND_DOWNTIME_HREF, ON_CALL_ON_SITE_HREF } from "@/components/on-call/on-call-section-identity";
import type { RosterShiftsState } from "@/components/roster/use-roster-shifts";
import { cn, eyebrowText } from "@/components/ui-primitives";
import { useOnCallChecklists } from "@/lib/on-call/checklist-storage";
import { onCallFirstNightProgress } from "@/lib/on-call/first-night";
import type { HandbookItem } from "@/lib/on-call/handbook-items";
import type { OnCallShiftContext } from "@/lib/on-call/shift-context";

/** One situation chip: a ladder the reader or the hospital recorded. */
export type OnCallSituation = { readonly id: string; readonly title: string; readonly href: string };

/**
 * "Who do I call now?" (mock-up v10 Now): one chip per recorded situation,
 * each opening its ladder, and "Escalation ladder" at the right. Situations come
 * only from ladders that exist (the reader's own Playbook and the hospital's);
 * with none, the action still opens the page that says so.
 */
export function NowWhoToCall({ situations }: { readonly situations: readonly OnCallSituation[] }) {
  return (
    <section aria-labelledby="on-call-now-who-heading" className="grid min-w-0 gap-1" data-testid="on-call-now-who">
      <div className="flex min-h-12 min-w-0 flex-wrap items-center justify-between gap-x-3 px-1">
        <h2 id="on-call-now-who-heading" className={eyebrowText}>
          Who do I call now?
        </h2>
        {/* A literal href: the route-reachability guard reads literal hrefs only. */}
        <Link href="/on-call/now" data-testid="on-call-home-call-now" className={cn(onCallActionLink, focusRing)}>
          Escalation ladder
        </Link>
      </div>
      {situations.length > 0 ? (
        <ul role="list" className="flex min-w-0 flex-wrap gap-x-2 px-1">
          {situations.map((situation) => (
            <li key={situation.id} className="min-w-0">
              <Link
                href={situation.href}
                data-testid={`on-call-now-situation-${situation.id}`}
                className={cn(onCallChipTap, focusRing, "rounded-md no-underline")}
              >
                <span className={onCallChipShape}>{situation.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
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
