import Link from "next/link";

import { cardSurface } from "@/components/card-recipes";
import { cn, eyebrowText, textMuted } from "@/components/ui-primitives";
import type { CmeEntry, CmeRequirement } from "@/lib/cme/types";

/**
 * DOMAINS RING — one ring per "activity-count" requirement the owner confirmed
 * (in the RANZCP starting set, the four professional development domains). The
 * ring has one part per domain; a part fills once the domain has as many tagged
 * activities as the confirmed minimum. Under it, each domain with its count,
 * and a "Tag one" link on a domain that still has nothing.
 *
 * Nothing here is a new rule: the domains and the minimum come only from the
 * confirmed requirement, and the counting matches `evaluateRequirement`. A
 * filled part means "counted", never a colour-coded status, and the list
 * carries every figure, so the ring itself is decorative.
 */

type ActivityCountRequirement = CmeRequirement & {
  spec: Extract<CmeRequirement["spec"], { shape: "activity-count" }>;
};

export function isActivityCountRequirement(requirement: CmeRequirement): requirement is ActivityCountRequirement {
  return requirement.spec.shape === "activity-count";
}

/** Gap between parts, in degrees, so four parts read as four. */
const GAP_DEGREES = 8;
const RADIUS = 15.5;

function polar(degrees: number): { x: number; y: number } {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return { x: 20 + RADIUS * Math.cos(radians), y: 20 + RADIUS * Math.sin(radians) };
}

function arcPath(startDegrees: number, endDegrees: number): string {
  const start = polar(startDegrees);
  const end = polar(endDegrees);
  const large = endDegrees - startDegrees > 180 ? 1 : 0;
  return `M ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${RADIUS} ${RADIUS} 0 ${large} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`;
}

export function CmeDomainsRing({
  requirement,
  entries,
  year,
}: {
  requirement: ActivityCountRequirement;
  entries: readonly CmeEntry[];
  year: number;
}) {
  const active = entries.filter((entry) => !entry.archivedAt);
  const { buckets, minimumPerBucket } = requirement.spec;
  const rows = buckets.map((bucket) => {
    const count = active.filter((entry) => entry.buckets.includes(bucket)).length;
    return { bucket, count, filled: count >= minimumPerBucket };
  });
  const filledCount = rows.filter((row) => row.filled).length;
  const step = 360 / Math.max(buckets.length, 1);
  const headingId = `cme-domains-${requirement.id}`;

  return (
    <section
      className={cn(cardSurface, "p-4")}
      aria-labelledby={headingId}
      data-testid={`cme-domains-ring-${requirement.id}`}
    >
      <h2 id={headingId} className={eyebrowText}>
        {requirement.label} · {filledCount} of {buckets.length}
      </h2>
      <div className="mt-3 flex items-center gap-4">
        <svg aria-hidden="true" viewBox="0 0 40 40" className="size-24 shrink-0">
          {rows.map((row, index) => (
            <path
              key={row.bucket}
              data-filled={row.filled ? "true" : "false"}
              d={arcPath(index * step + GAP_DEGREES / 2, (index + 1) * step - GAP_DEGREES / 2)}
              fill="none"
              strokeWidth={4.5}
              strokeLinecap="round"
              className={cn(
                row.filled
                  ? "stroke-[color:var(--tone-indigo)] forced-colors:stroke-[CanvasText]"
                  : "stroke-[color:var(--surface-inset)] forced-colors:stroke-[GrayText]",
              )}
            />
          ))}
          <text
            x="20"
            y="22.5"
            textAnchor="middle"
            className="nums fill-[color:var(--text-heading)] text-[length:8px] font-normal"
          >
            {`${filledCount}/${buckets.length}`}
          </text>
        </svg>
        <ul className="flex min-w-0 flex-1 flex-col divide-y divide-[color:var(--border)]">
          {rows.map((row) => (
            <li key={row.bucket} className="flex min-h-tap items-center justify-between gap-2 text-sm">
              <span className={cn("min-w-0", row.filled ? "text-[color:var(--text)]" : textMuted)}>{row.bucket}</span>
              {row.count > 0 ? (
                <span className="nums shrink-0 font-normal text-[color:var(--text)]">
                  {row.count}
                  <span className="sr-only">{row.count === 1 ? " activity" : " activities"}</span>
                </span>
              ) : (
                <Link
                  href={`/cme/log?year=${year}`}
                  aria-label={`Tag one for ${row.bucket}`}
                  className="inline-flex min-h-tap shrink-0 items-center font-semibold text-[color:var(--clinical-accent)]"
                >
                  Tag one
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
