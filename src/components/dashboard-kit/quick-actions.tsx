import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import { focusRing } from "@/components/card-recipes";
import { cn } from "@/components/ui-primitives";

export interface DashQuickAction {
  readonly label: string;
  readonly href: string;
  readonly icon: LucideIcon;
  /** A short muted hint under the label ("add hours"). */
  readonly hint?: string;
  readonly testId?: string;
}

/**
 * Quick actions as one horizontal, swipeable row of wide tiles: the icon chip
 * on the left, the label over a short muted hint on the right, each on one
 * line, so no label is ever cut or wrapped. The row
 * snaps tile by tile and its last tile is allowed to run past the edge, which
 * is the visible hint that it scrolls. Every tile is a real link with a 48px
 * tap height; keyboard focus moves through them in order.
 */
export function DashQuickActions({
  actions,
  label = "Quick actions",
}: {
  readonly actions: readonly DashQuickAction[];
  readonly label?: string;
}) {
  return (
    <ul
      role="list"
      aria-label={label}
      data-testid="dash-quick-actions"
      className="-mx-3 flex snap-x snap-mandatory scroll-px-3 gap-2 overflow-x-auto px-3 pt-0.5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {actions.map(({ label: actionLabel, href, icon: ActionIcon, hint, testId }) => (
        <li key={actionLabel} className="shrink-0 snap-start">
          <Link
            href={href}
            data-testid={testId}
            className={cn(
              focusRing,
              "flex min-h-14 items-center gap-2.5 whitespace-nowrap rounded-2xl border border-[color:var(--dash-line)] bg-[color:var(--dash-raised)] py-2 pr-4 pl-2 font-dash-title text-sm text-[color:var(--dash-ink)] no-underline forced-colors:border",
            )}
          >
            <span
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-lg bg-[color:var(--dash-blue-tint)] text-[color:var(--dash-blue)] forced-colors:border"
            >
              <ActionIcon aria-hidden="true" className="size-icon-lg" />
            </span>
            <span className="grid leading-tight">
              <span>{actionLabel}</span>
              {hint ? <span className="text-xs font-normal text-[color:var(--dash-muted)]">{hint}</span> : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
