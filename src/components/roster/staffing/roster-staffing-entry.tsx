import { NewWorkModeOnly } from "@/components/work-mode-launch/work-mode-launch-provider";
import { Users } from "lucide-react";
import Link from "next/link";

import { focusRing } from "@/components/card-recipes";
import { modePressable } from "@/components/mode-kit/recipes";
import { cn } from "@/components/ui-primitives";

/**
 * The way into Team staffing (`/roster/staffing`), for the main build to mount
 * on Leave and requests above the Leave list ("Plan with the team in view").
 * A plain link: no reads, no state.
 */
function RosterStaffingEntryLinkShown() {
  return (
    // Drawn like the Leave rows below it (one card, the same icon circle, title and line sizes), so the way
    // into Team staffing reads as one of them rather than a bigger heading.
    <Link
      href="/roster/staffing"
      data-mode-identity="roster"
      data-testid="roster-staffing-entry"
      className={cn(
        focusRing,
        modePressable,
        "work-card flex min-h-14 min-w-0 items-center gap-2.5 px-3 py-2 no-underline",
      )}
    >
      <span aria-hidden="true" className="work-ic forced-colors:border">
        <Users aria-hidden="true" strokeWidth={2} />
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="break-words text-sm leading-5 font-bold text-[color:var(--text-heading)]">
          Plan with the team in view
        </span>
        <span className="break-words text-2xs leading-4 text-[color:var(--text-muted)]">
          How many are on each day, before you pick dates
        </span>
      </span>
      <span className="shrink-0 text-sm font-semibold text-[color:var(--mode-identity)]">Plan</span>
    </Link>
  );
}

/** Leads to a new work mode screen, so it shows only to readers the launch switch has let in. */
export function RosterStaffingEntryLink() {
  return (
    <NewWorkModeOnly>
      <RosterStaffingEntryLinkShown />
    </NewWorkModeOnly>
  );
}
