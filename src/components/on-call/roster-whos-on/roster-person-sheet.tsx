"use client";

import Link from "next/link";
import type { RefObject } from "react";

import { focusRing } from "@/components/card-recipes";
import { flatCard, flatSecondaryButton } from "@/components/on-call/flat-recipes";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";
import { rosterProvenance, type RosterPublicationSummary, type RosterWhosOnRow } from "@/lib/on-call/roster-whos-on";
import { formatPerthDay, perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";

function Fact({ label, value, testId }: { readonly label: string; readonly value: string; readonly testId?: string }) {
  return (
    <div
      className="flex min-h-12 items-center justify-between gap-3 border-t border-[color:var(--border)] px-3 py-2 first:border-t-0"
      data-testid={testId}
    >
      <dt className="text-sm text-[color:var(--text-muted)]">{label}</dt>
      <dd className="nums min-w-0 break-words text-right text-sm font-medium text-[color:var(--text-heading)]">
        {value}
      </dd>
    </div>
  );
}

/** "Until Wed 08:30" while on, "From 21:00" before, "Finished 08:30" after. */
function headline(row: RosterWhosOnRow, now: Date): string {
  const at = now.getTime();
  const endDay = perthDateOf(row.endsAt);
  const startDay = perthDateOf(row.startsAt);
  const today = perthDateOf(now);
  if (row.onNow) return `Until ${endDay === today ? "" : `${formatPerthDay(endDay)} `}${perthTimeOf(row.endsAt)}`;
  if (Date.parse(row.startsAt) > at)
    return `From ${startDay === today ? "" : `${formatPerthDay(startDay)} `}${perthTimeOf(row.startsAt)}`;
  return `Finished ${endDay === today ? "" : `${formatPerthDay(endDay)} `}${perthTimeOf(row.endsAt)}`;
}

/**
 * One person's shift, and where the line comes from. Names and shift only:
 * no number (the roster holds none), no grade, no leave or reason. "Not right"
 * sends nobody anything: it says to confirm with switchboard and tell the
 * roster manager, because telling them from here needs server roles (deferred).
 */
export function RosterPersonSheet({
  row,
  date,
  teamName,
  publication,
  readAt,
  now = new Date(),
  onClose,
  returnFocusRef,
}: {
  readonly row: RosterWhosOnRow | null;
  readonly date: string;
  readonly teamName: string | null;
  readonly publication: RosterPublicationSummary | null;
  readonly readAt: Date | null;
  readonly now?: Date;
  readonly onClose: () => void;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const name = row ? (row.isMe ? "You" : (row.name ?? "Name not on the roster")) : "";
  return (
    <Sheet
      open={row !== null}
      onClose={onClose}
      title={name || "Shift"}
      description={row ? `${row.kindLabel} · ${formatPerthDay(date)}` : undefined}
      returnFocusRef={returnFocusRef}
      testId="on-call-roster-person-sheet"
    >
      {row ? (
        <div className="grid gap-4">
          <p
            className="nums text-center text-lg font-semibold text-[color:var(--text-heading)]"
            data-testid="on-call-roster-person-headline"
          >
            {headline(row, now)}
          </p>
          <p className="nums text-center text-sm text-[color:var(--text-muted)]">
            {row.span}
            {row.next ? `. Then ${row.next.name} from ${perthTimeOf(row.next.startsAt)}` : ""}
          </p>
          {row.name === null ? (
            <p
              className="rounded-lg border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] p-3 text-sm text-[color:var(--warning-text)]"
              role="note"
            >
              The roster has this shift with no name. Nobody is guessed. Ring switchboard for who is covering.
            </p>
          ) : null}
          <section className="grid gap-1.5" aria-labelledby="on-call-roster-source-heading">
            <h3
              id="on-call-roster-source-heading"
              className="px-1 text-xs font-medium uppercase tracking-wide text-[color:var(--text-muted)]"
            >
              Where this comes from
            </h3>
            <dl className={flatCard}>
              <Fact label="Roster" value={teamName ?? "Your team"} />
              {publication ? (
                <Fact
                  label="Published"
                  value={rosterProvenance(publication).replace(/^Published /, "")}
                  testId="on-call-roster-person-published"
                />
              ) : null}
              {readAt ? <Fact label="Loaded" value={perthTimeOf(readAt)} /> : null}
            </dl>
          </section>
          <p className="text-sm text-[color:var(--text-muted)]">
            Not right? Ring switchboard to confirm who is on, and tell your roster manager. This list changes only when
            the roster does.
          </p>
          <Link
            href="/roster/team"
            className={cn(flatSecondaryButton, focusRing)}
            data-testid="on-call-roster-open-team"
          >
            Open the team roster
          </Link>
        </div>
      ) : null}
    </Sheet>
  );
}
