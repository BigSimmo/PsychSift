import type { ReactNode } from "react";

import { adminStyles } from "@/components/admin/admin-kit";
import { cn } from "@/components/ui-primitives";

/**
 * The renewal window as one thin bar (Josh's locked mockup): the share from
 * the day renewing opens to the recorded date, filled, with a line at today.
 * Drawn as SVG attributes, so it needs no inline style. Decorative: the labels
 * under it, and the date line above, say the same in words.
 */
export function AdminWindowBar({ progress, className }: { readonly progress: number; readonly className?: string }) {
  const at = Math.round(Math.min(Math.max(Number.isFinite(progress) ? progress : 0, 0), 1) * 1000) / 10;
  return (
    <svg aria-hidden="true" width="100%" height="14" overflow="visible" className={cn("block", className)}>
      <rect x="0" y="4" width="100%" height="6" rx="3" className={adminStyles.windowTrackSvg} />
      <rect x="0" y="4" width={`${at}%`} height="6" rx="3" className={adminStyles.windowFillSvg} />
      <svg x={`${at}%`} y="0" overflow="visible">
        <rect x="-1" y="0" width="2" height="14" rx="1" className={adminStyles.windowNowSvg} />
      </svg>
    </svg>
  );
}

/** The bar with its three labels: where the window opened, today, and the date. */
export function AdminWindow({
  progress,
  start,
  end,
  showToday = true,
  onHero,
  testId,
}: {
  readonly progress: number;
  readonly start: ReactNode;
  readonly end: ReactNode;
  readonly showToday?: boolean;
  /** White on the hero's mode colour. */
  readonly onHero?: boolean;
  readonly testId?: string;
}) {
  return (
    <div className={cn(adminStyles.window, onHero && adminStyles.onHero)} data-testid={testId}>
      <AdminWindowBar progress={progress} />
      <span className={adminStyles.windowLabels}>
        <span>{start}</span>
        {showToday ? <span>Today</span> : null}
        <span className="text-right">{end}</span>
      </span>
    </div>
  );
}
