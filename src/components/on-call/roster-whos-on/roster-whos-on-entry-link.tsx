"use client";

import { CalendarDays, ChevronRight } from "lucide-react";
import Link from "next/link";

import { focusRing } from "@/components/card-recipes";
import { flatCard, flatIconCircle } from "@/components/on-call/flat-recipes";
import { cn } from "@/components/ui-primitives";

/**
 * The way into "From your team roster", for On Call People and Who's on (and
 * the More sheet's "Who's on"). A literal link, so the route-reachability guard
 * can read it.
 */
export function RosterWhosOnEntryLink({
  sub = "Who is on, straight from the published roster",
}: {
  readonly sub?: string;
}) {
  return (
    <Link
      href="/on-call/whos-on/roster"
      data-testid="on-call-roster-whos-on-entry"
      className={cn(
        flatCard,
        focusRing,
        "flex min-h-13 items-center gap-3 px-3 py-2 no-underline active:bg-[color:var(--surface-wash)]",
      )}
    >
      <span className={flatIconCircle}>
        <CalendarDays aria-hidden="true" className="size-icon-md" />
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-base-minus font-medium leading-5 text-[color:var(--text-heading)]">
          From your team roster
        </span>
        <span className="text-sm leading-5 text-[color:var(--text-muted)]">{sub}</span>
      </span>
      <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
    </Link>
  );
}
