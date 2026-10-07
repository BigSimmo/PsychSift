import { ChevronRight, Thermometer } from "lucide-react";
import Link from "next/link";

import { focusRing } from "@/components/card-recipes";
import { modePressable } from "@/components/mode-kit/recipes";
import { cn } from "@/components/ui-primitives";

/**
 * Ways into Sick for tomorrow (`/roster/sick`), for the main build to mount:
 * - `RosterSickEntryLink`: a soft violet row for Open shifts Browse or Roster
 *   Today ("Sick for tomorrow? One tap tells your roster managers").
 * - `SickTomorrowTodayCard`: the same row for a Today page, naming tomorrow's
 *   first team shift when the page already has it loaded (never fetched here).
 * Both are plain links, so the page stays reachable without new state.
 */

export function RosterSickEntryLink({
  sub = "One tap tells your roster managers and posts your shift",
}: {
  readonly sub?: string;
}) {
  return (
    <Link
      href="/roster/sick"
      data-mode-identity="roster"
      data-testid="roster-sick-entry"
      className={cn(
        focusRing,
        modePressable,
        "flex min-h-14 min-w-0 items-center gap-3 rounded-lg border border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)] px-3 py-2 no-underline",
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-full bg-[color:var(--surface-raised)] text-[color:var(--mode-identity)]"
      >
        <Thermometer aria-hidden="true" strokeWidth={1.75} className="size-icon-md" />
      </span>
      <span className="grid min-w-0 flex-1">
        <span className="text-base-minus font-semibold text-[color:var(--text-heading)]">Sick for tomorrow?</span>
        <span className="text-sm text-[color:var(--text-muted)]">{sub}</span>
      </span>
      <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
    </Link>
  );
}

/** For a Today page: `tomorrowShift` is e.g. "Wed 7 · Day", from data the page already holds. */
export function SickTomorrowTodayCard({ tomorrowShift }: { readonly tomorrowShift?: string | null }) {
  return (
    <RosterSickEntryLink sub={tomorrowShift ? `${tomorrowShift}. One tap tells your roster managers` : undefined} />
  );
}
