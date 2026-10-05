"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { focusRing } from "@/components/card-recipes";
import { OnCallRow } from "@/components/on-call/kit/grouped-list";
import { modeInsetHairline, modeModuleSurface, modePressable, modeRowHeight } from "@/components/mode-kit/recipes";
import { modeNameText } from "@/components/mode-kit/type";
import { NowShiftLists } from "@/components/on-call/now/shift-lists";
import {
  ON_CALL_FIND_DOWNTIME_HREF,
  ON_CALL_ON_SITE_HREF,
  ON_CALL_ON_SITE_LABEL,
} from "@/components/on-call/on-call-section-identity";
import type { RosterShiftsState } from "@/components/roster/use-roster-shifts";
import { cn } from "@/components/ui-primitives";
import type { HandbookItem } from "@/lib/on-call/handbook-items";
import type { OnCallShiftContext } from "@/lib/on-call/shift-context";

const literalRow = cn(
  modeRowHeight.single,
  modePressable,
  focusRing,
  "flex min-w-0 items-center gap-3 pl-3 pr-2 no-underline",
);
const literalRowText = cn(modeNameText, "min-w-0 flex-1 break-words text-base-minus text-[color:var(--text-heading)]");
const literalRowChevron = "size-icon-md shrink-0 text-[color:var(--text-muted)]";

/**
 * Now's footer group, 20px below the modules: "Who do I call now?" (the
 * Playbook's scenario picker), the shift lists, Systems down, First night and
 * the one-line On site link.
 *
 * v6 moves Shift lists and Systems down behind the mode button. The page menu
 * has no link slot yet and the registry no Shift lists page, so until the kit
 * adds them they stay here, at the bottom, where they never sit above a number.
 *
 * The Right now hero answers "who covers this hour"; "Who do I call now?"
 * stays one tap away for "what do I do about this", which the hero cannot say.
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
  return (
    <nav aria-label="More for this shift" className="grid min-w-0" data-testid="on-call-now-footer">
      <ul role="list" className={modeModuleSurface}>
        {/* Literal hrefs on Links: the route-reachability guard reads only
            those, and these are their pages' only ways in from On Call. */}
        <li className={modeInsetHairline}>
          <Link href="/on-call/now" data-testid="on-call-home-call-now" className={literalRow}>
            <span className={literalRowText}>Who do I call now?</span>
            <ChevronRight aria-hidden="true" className={literalRowChevron} />
          </Link>
        </li>
        <li className={modeInsetHairline}>
          <Link href="/on-call/handover" data-testid="on-call-home-handover" className={literalRow}>
            <span className={literalRowText}>Handover</span>
            <ChevronRight aria-hidden="true" className={literalRowChevron} />
          </Link>
        </li>
        <li className={modeInsetHairline}>
          <Link href="/on-call/pulse" data-testid="on-call-home-pulse" className={literalRow}>
            <span className={literalRowText}>Shift pulse</span>
            <ChevronRight aria-hidden="true" className={literalRowChevron} />
          </Link>
        </li>
        <NowShiftLists context={context} shifts={shifts} items={items} now={now} />
        <OnCallRow
          title="Systems down"
          subtitle="Downtime plan needs a connection"
          href={ON_CALL_FIND_DOWNTIME_HREF}
          testId="on-call-now-systems-down"
        />
        <li className={modeInsetHairline}>
          <Link href="/on-call/first-night" data-testid="on-call-home-first-night" className={literalRow}>
            <span className={literalRowText}>First night</span>
            <ChevronRight aria-hidden="true" className={literalRowChevron} />
          </Link>
        </li>
        <OnCallRow title={ON_CALL_ON_SITE_LABEL} href={ON_CALL_ON_SITE_HREF} testId="on-call-now-on-site" />
      </ul>
    </nav>
  );
}
