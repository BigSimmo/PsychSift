import type { ComponentProps } from "react";
import { NewWorkModeOnly } from "@/components/work-mode-launch/work-mode-launch-provider";
import { ChevronRight, Scale } from "lucide-react";
import Link from "next/link";

import { focusRing } from "@/components/card-recipes";
import { modePressable } from "@/components/mode-kit/recipes";
import { cn } from "@/components/ui-primitives";

/**
 * The way in to Ask the agreement, for the main build to mount: Work profile's "Your agreement"
 * section, Search my work's empty state, and the Overtime page. A literal href so the route
 * reachability scan sees it.
 */
function AgreementEntryLinkShown({ className }: { readonly className?: string }) {
  return (
    <Link
      href="/my-day/profile/agreement"
      data-testid="agreement-entry-link"
      className={cn(
        focusRing,
        modePressable,
        "flex min-h-13 w-full min-w-0 items-center gap-3 py-1.5 no-underline",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-8 shrink-0 place-items-center rounded-full bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]"
      >
        <Scale aria-hidden="true" strokeWidth={1.75} className="size-icon-sm" />
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-sm font-medium leading-5 text-[color:var(--text-heading)]">Ask the agreement</span>
        <span className="text-xs leading-4 text-[color:var(--text-muted)]">
          Breaks, shift length and nights, quoted by clause
        </span>
      </span>
      <ChevronRight aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--text-muted)]" />
    </Link>
  );
}

/** Leads to a new work mode screen, so it shows only to readers the launch switch has let in. */
export function AgreementEntryLink(props: ComponentProps<typeof AgreementEntryLinkShown>) {
  return (
    <NewWorkModeOnly>
      <AgreementEntryLinkShown {...props} />
    </NewWorkModeOnly>
  );
}
