import type { ReactNode } from "react";

import { cn } from "@/components/ui-primitives";

/**
 * The desktop frame's layout pieces (desktop and tablet shell, 11 Oct 2026
 * usefulness and layout audit), for area pages that need more than the phone
 * column on a big screen. Styles live in work-mode.css under "desktop layouts".
 *
 * The tablet rule, for every area: below 1024px (a phone, or a tablet held
 * upright) each of these is the plain single phone column, in source order;
 * from 1024px (a tablet on its side, and desktop) it opens out. Every piece
 * marks the page wide, so the band's title and tabs widen to line up with it.
 */

/** A wide page with no special layout of its own: a calendar, a board, a table. */
export function WorkWidePage({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return (
    <div className={cn("work-wide", className)} data-page-width="wide" data-page-padded="">
      {children}
    </div>
  );
}

/**
 * A list beside the open record (Pathways, the Specifier builder and Teaching
 * Organise are the model). On a phone and an upright tablet the list comes
 * first and the record follows, or the page shows one or the other as it does
 * today; from 1024px the list is a sticky column on the left.
 */
export function WorkSplit({
  list,
  detail,
  listLabel,
  className,
}: {
  readonly list: ReactNode;
  readonly detail: ReactNode;
  /** Names the list column for screen readers ("Therapies"). */
  readonly listLabel: string;
  readonly className?: string;
}) {
  return (
    <div className={cn("work-split", className)} data-page-width="wide" data-page-padded="">
      <section className="work-split__list" aria-label={listLabel}>
        {list}
      </section>
      <div className="work-split__detail">{detail}</div>
    </div>
  );
}

/**
 * Clinical's list beside the open record: WorkSplit's columns (the same CSS
 * rule in work-mode.css), for a Clinical record page (a DSM diagnosis, a
 * therapy, the Act). Clinical pages bring their own padded page shell, so this
 * adds no padding of its own, and below 1024px it draws no list at all and its
 * wrappers take no box: phones and upright tablets keep the record exactly as
 * it is. From 1024px the list is a sticky column on the left that scrolls on
 * its own (`data-chrome-scroll-ignore` keeps that scroll from hiding the app
 * header).
 *
 * The list is navigation to other records or to places on the page, so it is a
 * `nav` named by `listLabel`; mark its current row with `aria-current`.
 */
export function ClinicalSplit({
  list,
  detail,
  listLabel,
  className,
  testId,
}: {
  readonly list: ReactNode;
  readonly detail: ReactNode;
  /** Names the list column for screen readers ("DSM diagnoses"). */
  readonly listLabel: string;
  readonly className?: string;
  readonly testId?: string;
}) {
  return (
    <div className={cn("clinical-split", className)} data-testid={testId}>
      <nav className="clinical-split__list" aria-label={listLabel} data-chrome-scroll-ignore="">
        {list}
      </nav>
      <div className="clinical-split__detail">{detail}</div>
    </div>
  );
}

/**
 * Two or three columns of cards from 1024px (Today beside Coming up), one
 * column in order below it. Each child is one column.
 */
export function WorkColumns({
  children,
  count = 2,
  className,
}: {
  readonly children: ReactNode;
  readonly count?: 2 | 3;
  readonly className?: string;
}) {
  return (
    <div className={cn("work-columns", className)} data-columns={count} data-page-width="wide" data-page-padded="">
      {children}
    </div>
  );
}
