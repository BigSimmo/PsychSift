import { ChevronRight, FileSpreadsheet } from "lucide-react";
import Link from "next/link";

import { focusRing } from "@/components/card-recipes";
import { flatCard, IconCircle, PendingTag } from "@/components/cme/cpd-feature-kit";
import { cn } from "@/components/ui-primitives";

/**
 * The way in to Send to AMA CPD Home, for the CPD Export page or Report's
 * "Annual summary and export" group. Mounted on the CPD Summary page. A literal link,
 * so the route is reachable wherever this is placed.
 */
export function CpdHomeEntryLink({ year }: { readonly year?: number }) {
  return (
    <Link
      href={year ? `/cme/cpd-home?year=${year}` : "/cme/cpd-home"}
      data-testid="cpd-home-entry-link"
      data-mode-identity="cme"
      className={cn(
        flatCard,
        focusRing,
        "flex min-h-13 min-w-0 items-center gap-3 border-[color:var(--mode-identity-border)] px-3 py-2 no-underline",
      )}
    >
      <IconCircle icon={FileSpreadsheet} />
      <span className="grid min-w-0 flex-1">
        <span className="text-base-minus font-medium leading-5 text-[color:var(--text-heading)]">
          Send to AMA CPD Home
        </span>
        <span className="text-sm leading-5 text-[color:var(--text-muted)]">CSV now · format to confirm</span>
      </span>
      <PendingTag>Not checked</PendingTag>
      <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
    </Link>
  );
}
