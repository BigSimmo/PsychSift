import type { ReactNode } from "react";

import { CmeGroup, CmeTextLink } from "@/components/cme/cme-flat-list";
import { modeInsetHairline, modeRowHeight } from "@/components/mode-kit/recipes";
import { cn } from "@/components/ui-primitives";
import type { CmeEntry, CmeRequirement } from "@/lib/cme/types";

/**
 * DOMAINS RING — one ring per "activity-count" requirement the owner confirmed
 * (in the RANZCP starting set, the four professional development domains). The
 * ring has one part per domain; a part fills once the domain has as many tagged
 * activities as the confirmed minimum. Beside it, a flat list of each domain
 * with its count, and a quiet "Tag one" link on a domain that still has nothing.
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
const GAP_DEGREES = 22;
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

/** The group's name: the RANZCP preset's domains read as "Activities per domain"; any other set keeps its own label. */
function groupName(requirement: ActivityCountRequirement): string {
  return requirement.id === "domains" ? "Activities per domain" : requirement.label;
}

export function CmeDomainsRing({
  requirement,
  entries,
  year,
  source,
}: {
  requirement: ActivityCountRequirement;
  entries: readonly CmeEntry[];
  year: number;
  /** Where the domains come from, shown at the end of the group label. */
  source?: ReactNode;
}) {
  const active = entries.filter((entry) => !entry.archivedAt);
  const { buckets, minimumPerBucket } = requirement.spec;
  // Covered domains first, so the one still to tag sits last beside its "Tag one" link.
  const rows = buckets
    .map((bucket) => {
      const count = active.filter((entry) => entry.buckets.includes(bucket)).length;
      return { bucket, count, filled: count >= minimumPerBucket };
    })
    .sort((a, b) => Number(b.filled) - Number(a.filled));
  const filledCount = rows.filter((row) => row.filled).length;
  const step = 360 / Math.max(buckets.length, 1);

  return (
    <CmeGroup
      testId={`cme-domains-ring-${requirement.id}`}
      label={`${groupName(requirement)} · ${filledCount} of ${buckets.length}`}
      end={source}
    >
      <div className="flex items-center gap-4">
        <svg aria-hidden="true" viewBox="0 0 40 40" className="size-18 shrink-0">
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
                  ? "stroke-[color:var(--clinical-accent)] forced-colors:stroke-[CanvasText]"
                  : "stroke-[color:var(--border-strong)] forced-colors:stroke-[GrayText]",
              )}
            />
          ))}
          <text
            x="20"
            y="22.8"
            textAnchor="middle"
            className="nums fill-[color:var(--text-heading)] text-[length:8px] font-normal"
          >
            {`${filledCount}/${buckets.length}`}
          </text>
        </svg>
        <ul role="list" className="grid min-w-0 flex-1">
          {rows.map((row) => (
            <li
              key={row.bucket}
              className={cn(
                modeInsetHairline,
                modeRowHeight.single,
                "flex min-w-0 items-center justify-between gap-3 text-sm before:left-0",
              )}
            >
              <span
                className={cn(
                  "min-w-0 break-words",
                  row.count > 0 ? "text-[color:var(--text)]" : "text-[color:var(--text-muted)]",
                )}
              >
                {row.bucket}
              </span>
              {row.count > 0 ? (
                <span className="nums shrink-0 font-normal text-[color:var(--text-heading)]">
                  {row.count}
                  <span className="sr-only">{row.count === 1 ? " activity" : " activities"}</span>
                </span>
              ) : (
                <CmeTextLink href={`/cme/log?year=${year}`} className="shrink-0">
                  Tag one <span className="sr-only">for {row.bucket}</span>
                </CmeTextLink>
              )}
            </li>
          ))}
        </ul>
      </div>
    </CmeGroup>
  );
}
