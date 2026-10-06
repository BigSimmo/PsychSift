"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { focusRing } from "@/components/card-recipes";
import { InformationPageShell } from "@/components/information-page-shell";
import { flatCard } from "@/components/on-call/flat-recipes";
import { OnCallRosterWhosOnSection } from "@/components/on-call/roster-whos-on/on-call-roster-whos-on-section";
import { useHospitalClock } from "@/components/on-call/use-hospital-clock";
import { cn } from "@/components/ui-primitives";

/**
 * Who is on, from your team roster (round 2 feature 22), as its own page until
 * the main build mounts the section on People. The hospital's roles by team
 * stay on Who's on, linked below.
 */
export function OnCallRosterWhosOnPage({ now: pinned }: { now?: Date } = {}) {
  const now = useHospitalClock(pinned);
  return (
    <InformationPageShell testId="on-call-roster-whos-on-main">
      <h1 className="sr-only">Who is on, from your team roster</h1>
      <OnCallRosterWhosOnSection now={now} />
      <Link
        href="/on-call/whos-on"
        data-testid="on-call-roster-hospital-roles"
        className={cn(
          flatCard,
          focusRing,
          "flex min-h-13 items-center gap-3 px-3 py-2 no-underline active:bg-[color:var(--surface-wash)]",
        )}
      >
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-base-minus font-medium leading-5 text-[color:var(--text-heading)]">
            Hospital roles by team
          </span>
          <span className="text-sm leading-5 text-[color:var(--text-muted)]">
            Numbers from your hospital&apos;s handbook
          </span>
        </span>
        <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
      </Link>
    </InformationPageShell>
  );
}
