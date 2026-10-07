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
    <Link
      href="/roster/staffing"
      data-mode-identity="roster"
      data-testid="roster-staffing-entry"
      className={cn(
        focusRing,
        modePressable,
        "flex min-h-14 min-w-0 items-center gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 py-2 no-underline",
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-full bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]"
      >
        <Users aria-hidden="true" strokeWidth={1.75} className="size-icon-md" />
      </span>
      <span className="grid min-w-0 flex-1">
        <span className="text-base-minus font-semibold text-[color:var(--text-heading)]">
          Plan with the team in view
        </span>
        <span className="text-sm text-[color:var(--text-muted)]">How many are on each day, before you pick dates</span>
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
