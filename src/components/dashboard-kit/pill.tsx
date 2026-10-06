import Link from "next/link";
import type { ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { dashPillBase, dashPillFace } from "@/components/dashboard-kit/recipes";
import { cn } from "@/components/ui-primitives";

type PillProps = {
  readonly children: ReactNode;
  readonly emphasis?: "primary" | "secondary";
  readonly ariaLabel?: string;
  readonly testId?: string;
  readonly className?: string;
} & ({ readonly href: string; readonly onClick?: never } | { readonly onClick: () => void; readonly href?: never });

/**
 * The dashboard's pill button: a compact visible face ("Log", "Later") inside
 * a full 48px tap area, as the repo's tap rule requires.
 */
export function DashPill({ children, emphasis = "secondary", ariaLabel, testId, className, ...action }: PillProps) {
  const face = <span className={dashPillFace[emphasis]}>{children}</span>;
  const classes = cn(dashPillBase, focusRing, className);
  if (action.href !== undefined) {
    return (
      <Link href={action.href} aria-label={ariaLabel} data-testid={testId} className={classes}>
        {face}
      </Link>
    );
  }
  return (
    <button type="button" onClick={action.onClick} aria-label={ariaLabel} data-testid={testId} className={classes}>
      {face}
    </button>
  );
}
