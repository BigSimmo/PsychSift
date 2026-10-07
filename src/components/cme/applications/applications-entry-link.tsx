import { ChevronRight, Flag } from "lucide-react";
import Link from "next/link";

import { focusRing } from "@/components/card-recipes";
import { flatCard, IconCircle } from "@/components/cme/cpd-feature-kit";
import { cn } from "@/components/ui-primitives";

/**
 * The way in to Job applications, for the CPD More sheet ("Your year" group,
 * label "Jobs") or the Summary page (mounted there). A literal link, so the route is reachable
 * wherever the main build places it.
 */
export function ApplicationsEntryLink() {
  return (
    <Link
      href="/cme/applications"
      data-testid="applications-entry-link"
      data-mode-identity="cme"
      className={cn(flatCard, focusRing, "flex min-h-13 min-w-0 items-center gap-3 px-3 py-2 no-underline")}
    >
      <IconCircle icon={Flag} />
      <span className="grid min-w-0 flex-1">
        <span className="text-base-minus font-medium leading-5 text-[color:var(--text-heading)]">Job applications</span>
        <span className="text-sm leading-5 text-[color:var(--text-muted)]">Season dates, referees and your CV</span>
      </span>
      <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
    </Link>
  );
}
