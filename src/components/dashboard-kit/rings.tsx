import type { ReactNode } from "react";

import { cn } from "@/components/ui-primitives";

/**
 * Rings for the dashboard style. Pure SVG with attributes for every size, so
 * no inline style is needed. Decorative: the caller gives the same figures in
 * words (a visible legend or an sr-only sentence).
 */

function clamp(fraction: number): number {
  return Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
}

/**
 * One ring with a figure in the middle. `stroke` and `track` are colour
 * utilities (`stroke-[color:var(--…)]`) so the ring reads on a card or on the
 * hero alike.
 */
export function ProgressRing({
  fraction,
  size = 92,
  strokeWidth = 7,
  stroke = "stroke-[color:var(--dash-blue)]",
  track = "stroke-[color:var(--dash-line)]",
  className,
  testId,
  children,
}: {
  readonly fraction: number;
  /** Diameter in CSS pixels (drawn through the SVG's own width and height). */
  readonly size?: number;
  readonly strokeWidth?: number;
  readonly stroke?: string;
  readonly track?: string;
  readonly className?: string;
  readonly testId?: string;
  readonly children?: ReactNode;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const centre = size / 2;
  return (
    <span aria-hidden="true" className={cn("relative grid shrink-0 place-items-center", className)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={centre} cy={centre} r={radius} fill="none" strokeWidth={strokeWidth} className={track} />
        <circle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamp(fraction))}
          className={cn(stroke, "forced-colors:stroke-[CanvasText]")}
          data-testid={testId}
          data-fraction={clamp(fraction).toFixed(3)}
        />
      </svg>
      {children ? (
        <span className="absolute inset-0 grid place-content-center text-center leading-none">{children}</span>
      ) : null}
    </span>
  );
}

export interface RingSegment {
  readonly key: string;
  readonly fraction: number;
  /** A stroke colour utility. */
  readonly stroke: string;
}

/** Concentric rings, outermost first (the CPD rings). */
export function RingStack({
  rings,
  size = 96,
  strokeWidth = 8,
  gap = 4,
  testId,
}: {
  readonly rings: readonly RingSegment[];
  readonly size?: number;
  readonly strokeWidth?: number;
  readonly gap?: number;
  readonly testId?: string;
}) {
  const centre = size / 2;
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0 -rotate-90"
      data-testid={testId}
    >
      {rings.map((ring, index) => {
        const radius = centre - strokeWidth / 2 - index * (strokeWidth + gap);
        if (radius <= 0) return null;
        const circumference = 2 * Math.PI * radius;
        return (
          <g key={ring.key}>
            <circle
              cx={centre}
              cy={centre}
              r={radius}
              fill="none"
              strokeWidth={strokeWidth}
              className="stroke-[color:var(--dash-line)]"
            />
            <circle
              cx={centre}
              cy={centre}
              r={radius}
              fill="none"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - clamp(ring.fraction))}
              className={cn(ring.stroke, "forced-colors:stroke-[CanvasText]")}
              data-ring={ring.key}
            />
          </g>
        );
      })}
    </svg>
  );
}
