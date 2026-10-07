"use client";

import { CalendarDays } from "lucide-react";
import Link from "next/link";

import { focusRing } from "@/components/card-recipes";
import { DateTile, flatCard } from "@/components/cme/cpd-feature-kit";
import { cn } from "@/components/ui-primitives";
import { countdownWords, nextSeasonDate, quietReferees, shortDate, stageLabel } from "@/lib/cme/applications";
import { useApplicationsStore } from "@/lib/cme/device-record";

/**
 * A Today card for My Day or the CPD home (mounted there): the next date the doctor added
 * to their season, with the countdown, and a quiet referee if there is one.
 * Renders nothing until the device is read, and nothing when no date is to come.
 */
export function ApplicationsTodayCard({ today }: { readonly today: string }) {
  const { state } = useApplicationsStore(null);
  if (!state) return null;
  const next = nextSeasonDate(state, today);
  const quiet = quietReferees(state, today)[0];
  if (!next && !quiet) return null;
  return (
    <Link
      href="/cme/applications"
      data-testid="applications-today-card"
      data-mode-identity="cme"
      className={cn(flatCard, focusRing, "flex min-h-13 min-w-0 items-center gap-3 px-3 py-2 no-underline")}
    >
      {next ? (
        <DateTile on={next.date.on} label={shortDate(next.date.on, today)} />
      ) : (
        <CalendarDays aria-hidden="true" className="size-icon-md text-[color:var(--mode-identity)]" />
      )}
      <span className="grid min-w-0 flex-1">
        <span className="text-base-minus font-medium leading-5 text-[color:var(--text-heading)]">
          {next ? countdownWords(next.days, stageLabel(next.date.stage)) : "Job applications"}
        </span>
        <span className="text-sm leading-5 text-[color:var(--text-muted)]">
          {quiet ? `${quiet.referee.name} has not replied in ${quiet.days} days` : "Date you added from the advert"}
        </span>
      </span>
    </Link>
  );
}
