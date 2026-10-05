"use client";

import Link from "next/link";

import { focusRing } from "@/components/card-recipes";
import { cn } from "@/components/ui-primitives";
import type { CmeYearCheck } from "@/lib/cme/year-check";

/**
 * The Year page's row of small things to finish, one quiet chip each
 * (the 5 Oct mock-up): activities not marked copied to the CPD home, activities
 * with no reflection yet, and drafts whose next step is the owner's own. Only
 * chips with something in them appear.
 *
 * The copied and reflection counts are the live year check's own (the same
 * activities its rows name), so the chip, "What's left" and the Year check
 * page can never disagree. The draft count is the page's `draftsToFinish`;
 * when it is null (the drafts did not load) the chip is left out rather than
 * shown as a zero.
 */

/** A chip: hairline outline, its count in the heading colour, a 48px tap area around its 32px face. */
const CHIP = cn(
  focusRing,
  "relative inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-[color:var(--border-strong)] px-2.75 text-sm-minus text-[color:var(--text-muted)] no-underline",
  "after:absolute after:inset-x-0 after:top-1/2 after:h-12 after:-translate-y-1/2 after:content-['']",
  "hover:border-[color:var(--text-muted)]",
);

export type CmeYearChip = {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly href: string;
};

export function buildCmeYearChips({
  year,
  yearCheck,
  draftsToFinish,
}: {
  year: number;
  yearCheck: CmeYearCheck;
  draftsToFinish: number | null | undefined;
}): CmeYearChip[] {
  const count = (id: string) => {
    const row = yearCheck.rows.find((item) => item.id === id);
    return row && !row.ready && !row.notChecked ? row.entryIds.length : 0;
  };
  const chips: CmeYearChip[] = [
    { id: "copy", label: "Not marked copied", count: count("copied"), href: `/cme/log?year=${year}&copy=todo` },
    {
      id: "reflection",
      label: "No reflection",
      count: count("reflection"),
      href: `/cme/log?year=${year}&fix=reflection`,
    },
    {
      id: "drafts",
      label: "Draft to finish",
      count: typeof draftsToFinish === "number" ? draftsToFinish : 0,
      href: `/cme/log?year=${year}&tab=finish#cme-drafts`,
    },
  ];
  return chips.filter((chip) => chip.count > 0);
}

export function CmeTodayShortcuts({ chips }: { chips: readonly CmeYearChip[] }) {
  if (chips.length === 0) return null;
  return (
    <ul role="list" aria-label="To finish" data-testid="cme-today-shortcuts" className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <li key={chip.id}>
          <Link href={chip.href} data-testid={`cme-chip-${chip.id}`} className={CHIP}>
            {chip.label}
            <b className="nums font-normal text-[color:var(--text-heading)]">{chip.count}</b>
          </Link>
        </li>
      ))}
    </ul>
  );
}
