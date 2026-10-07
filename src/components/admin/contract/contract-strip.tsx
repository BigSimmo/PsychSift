import { Bell } from "lucide-react";

import { cn } from "@/components/ui-primitives";
import { formatDateEcho } from "@/lib/admin/renewal-dates";
import type { ContractStrip as ContractStripModel } from "@/lib/admin/contract-end";

/** Keep a label inside the strip: anchor it left near the start, right near the end. */
function anchorClass(position: number): string {
  if (position < 0.14) return "translate-x-0";
  if (position > 0.86) return "-translate-x-full";
  return "-translate-x-1/2";
}

function percent(position: number): string {
  return `${(position * 100).toFixed(2)}%`;
}

/** "Sat 31 Oct", the reminder date without its year. */
function shortDate(date: string): string {
  return formatDateEcho(date).replace(/\s\d{4}$/, "");
}

/**
 * The contract end tracker's signature: the last six months of the contract
 * as one calm strip of month segments, filled up to today, with the two
 * reminder points marked above and Today, start and end below. Flat: a
 * hairline track, the area colour for what has passed, no glow and no motion.
 * One `role="img"` with the whole picture in words for screen readers.
 */
export function ContractStrip({
  strip,
  testId = "admin-contract-strip",
}: {
  strip: ContractStripModel;
  testId?: string;
}) {
  const today = strip.todayPosition;
  const hideStart = today !== null && today < 0.18;
  const hideEnd = today !== null && today > 0.78;
  return (
    <div role="img" aria-label={strip.accessibleLabel} data-testid={testId} className="relative grid gap-1.5 pt-9">
      {strip.marks.map((mark) => (
        <span
          key={`label-${mark.kind}`}
          aria-hidden="true"
          data-testid={`${testId}-label-${mark.kind}`}
          className={cn(
            "absolute top-0 grid whitespace-nowrap text-2xs leading-4 text-[color:var(--text-muted)]",
            anchorClass(mark.position),
            mark.position < 0.14 ? "text-left" : mark.position > 0.86 ? "text-right" : "text-center",
          )}
          style={{ left: percent(mark.position) }}
        >
          <span className="font-semibold text-[color:var(--text-heading)]">{mark.label}</span>
          <span className="nums">{mark.on ? shortDate(mark.date) : "Off"}</span>
        </span>
      ))}

      <div aria-hidden="true" className="relative flex h-2.5 gap-0.5">
        {strip.segments.map((segment, index) => (
          <span
            key={`${segment.label}-${index}`}
            className="relative h-full overflow-hidden rounded-sm border border-[color:var(--clinical-accent-border)] bg-[color:var(--surface-raised)]"
            style={{ flexGrow: segment.width, flexBasis: 0 }}
          >
            <span
              className="absolute inset-y-0 left-0 bg-[color:var(--clinical-accent)]"
              style={{ width: `${(segment.filled * 100).toFixed(1)}%` }}
            />
          </span>
        ))}
        {strip.marks.map((mark) => (
          <span
            key={`mark-${mark.kind}`}
            data-testid={`${testId}-mark-${mark.kind}`}
            data-on={mark.on ? "true" : "false"}
            className={cn(
              "absolute top-1/2 grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border",
              mark.on
                ? mark.reached
                  ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]"
                  : "border-[color:var(--clinical-accent)] bg-[color:var(--surface-raised)] text-[color:var(--clinical-accent)]"
                : "border-dashed border-[color:var(--border-strong)] bg-[color:var(--surface-raised)]",
            )}
            style={{ left: percent(mark.position) }}
          >
            {/* A reached reminder is a filled marker with its bell, never a tick (Admin draws no tick icons). */}
            {mark.on ? <Bell aria-hidden="true" strokeWidth={2} className="size-icon-xs" /> : null}
          </span>
        ))}
        {today !== null ? (
          <span
            data-testid={`${testId}-today`}
            className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-[color:var(--text-heading)]"
            style={{ left: percent(today) }}
          />
        ) : null}
      </div>

      <div aria-hidden="true" className="relative h-4 text-2xs leading-4 text-[color:var(--text-muted)]">
        {hideStart ? null : <span className="nums absolute left-0">{strip.startLabel}</span>}
        {today !== null ? (
          <span
            className={cn("absolute font-semibold text-[color:var(--text-heading)]", anchorClass(today))}
            style={{ left: percent(today) }}
          >
            Today
          </span>
        ) : null}
        {hideEnd ? null : <span className="nums absolute right-0">{strip.endLabel}</span>}
      </div>
    </div>
  );
}
