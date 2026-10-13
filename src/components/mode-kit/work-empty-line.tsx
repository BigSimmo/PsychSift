import Link from "next/link";
import type { ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { cn } from "@/components/ui-primitives";

/**
 * The one inline empty state for a row or a short block in a work area (site
 * review 12 Oct 2026, item 2): a plain sentence and, when there is somewhere
 * real to go, one action. Before this a row could end at "Not set up for this
 * hospital" with nothing to tap.
 *
 * The page-sized empty state stays `WorkEmpty` / `WorkStateNotice`; this is
 * for a line inside a card. With no action it draws the sentence only, so a
 * caller never invents a destination to fill the slot.
 */
export type WorkEmptyLineAction =
  | { readonly label: string; readonly href: string; readonly onClick?: never; readonly testId?: string }
  | { readonly label: string; readonly onClick: () => void; readonly href?: never; readonly testId?: string };

export const workEmptyLineActionClass =
  "inline-flex min-h-12 shrink-0 items-center rounded-sm px-1 text-sm font-semibold text-[color:var(--mode-identity)] no-underline";

export function WorkEmptyLine({
  children,
  action,
  className,
  testId,
}: {
  /** The sentence: plain words that say what is missing. */
  readonly children: ReactNode;
  readonly action?: WorkEmptyLineAction;
  readonly className?: string;
  readonly testId?: string;
}) {
  return (
    <div
      className={cn("flex min-w-0 flex-wrap items-center justify-between gap-x-3", className)}
      data-testid={testId}
      data-work-empty-line=""
    >
      <p className="m-0 min-w-0 flex-1 basis-40 py-1 text-sm break-words text-[color:var(--text-muted)]">{children}</p>
      {action ? (
        action.href !== undefined ? (
          <Link href={action.href} data-testid={action.testId} className={cn(workEmptyLineActionClass, focusRing)}>
            {action.label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={action.onClick}
            data-testid={action.testId}
            className={cn(workEmptyLineActionClass, focusRing)}
          >
            {action.label}
          </button>
        )
      ) : null}
    </div>
  );
}
