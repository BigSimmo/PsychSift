import type { ReactNode } from "react";

import { dashFigure, dashTile } from "@/components/dashboard-kit/recipes";
import { cn } from "@/components/ui-primitives";

/** A heavy figure over a short label, in a small white tile. */
export function DashStatTile({
  value,
  label,
  className,
  testId,
}: {
  readonly value: ReactNode;
  readonly label: ReactNode;
  readonly className?: string;
  readonly testId?: string;
}) {
  return (
    <div data-testid={testId} className={cn(dashTile, "grid min-w-0 gap-1 px-2.5 py-2 text-center", className)}>
      <span className={cn(dashFigure, "text-2xl text-[color:var(--dash-ink)]")}>{value}</span>
      <span className="text-xs leading-tight text-[color:var(--dash-muted)]">{label}</span>
    </div>
  );
}
