"use client";

import { ChevronRight, Sparkles } from "lucide-react";
import Link from "next/link";

import { focusRing } from "@/components/card-recipes";
import { flatCard, flatIconCircle } from "@/components/on-call/flat-recipes";
import { cn } from "@/components/ui-primitives";

/**
 * The way into "Your first week", for the On Call More sheet ("Starting out")
 * and the Handbook tab's "Your job orientation" group. A literal link, so the
 * route-reachability guard can read it.
 */
export function FirstWeekEntryLink({
  sub = "Orientation, who is who, escalation and logins",
}: {
  readonly sub?: string;
}) {
  return (
    <Link
      href="/on-call/first-week"
      data-testid="on-call-first-week-entry"
      className={cn(
        flatCard,
        focusRing,
        "flex min-h-13 items-center gap-3 px-3 py-2 no-underline active:bg-[color:var(--surface-wash)]",
      )}
    >
      <span className={flatIconCircle}>
        <Sparkles aria-hidden="true" className="size-icon-md" />
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-base-minus font-medium leading-5 text-[color:var(--text-heading)]">Your first week</span>
        <span className="text-sm leading-5 text-[color:var(--text-muted)]">{sub}</span>
      </span>
      <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
    </Link>
  );
}
