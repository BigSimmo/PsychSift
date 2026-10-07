import type { ReactNode } from "react";

import { inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
import { onCallGroupAnchorId } from "@/components/on-call/on-call-page-anchors";
import { cn, eyebrowText } from "@/components/ui-primitives";

/**
 * One group on an On Call page: a sticky heading, its count, and the rows.
 *
 * Every section that groups renders exactly this shape, and the chip rows that
 * used to sit above them are gone — the header's jump list is the one way to
 * move between groups now, and it can only work if the anchor here and the
 * declaration in `on-call-page-sections.ts` are the same string. Hence
 * `onCallGroupAnchorId` on both sides rather than a literal in either.
 */
export function OnCallGroupSection({
  label,
  slug,
  count,
  headingId,
  testId,
  children,
}: {
  label: string;
  slug: string;
  count: number;
  headingId: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section
      id={onCallGroupAnchorId(slug)}
      aria-labelledby={headingId}
      className={cn(inPageAnchor, "grid grid-cols-[minmax(0,1fr)] gap-2")}
    >
      <div className="sticky top-0 z-[var(--z-raised)] flex items-center gap-1.5 bg-[color:var(--background)] py-1">
        <h3 id={headingId} className={eyebrowText}>
          {label}
        </h3>
        {/* Outside the heading, and hidden from assistive technology: folding
            the count in turns "Wards" into "Wards 3" as the accessible name,
            and the list underneath already carries its own length. */}
        <span aria-hidden="true" className="nums text-2xs font-medium text-[color:var(--text-muted)]">
          {count}
        </span>
      </div>
      <div data-on-call-list="" className="grid grid-cols-[minmax(0,1fr)] gap-2" data-testid={testId}>
        {children}
      </div>
    </section>
  );
}
