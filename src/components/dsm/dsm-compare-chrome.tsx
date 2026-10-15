"use client";

import Link from "next/link";
import { BookOpenCheck } from "lucide-react";
import { useRouter } from "next/navigation";

import {
  CompareIdsChrome,
  idsCompareHref,
  type CompareCatalogItem,
  type CompareStarterChip,
} from "@/components/compare";
import { cn } from "@/components/ui-primitives";

export function DsmCompareChrome({
  selectedIds,
  items,
  starters,
}: {
  selectedIds: readonly (string | null | undefined)[];
  items: readonly CompareCatalogItem[];
  starters: readonly CompareStarterChip[];
}) {
  const router = useRouter();
  const filled = selectedIds.filter(Boolean).length;
  return (
    <div className="grid gap-3">
      <CompareIdsChrome
        selectedIds={selectedIds}
        maxCount={3}
        items={items}
        starters={starters}
        emptyTitle="Choose at least two diagnoses"
        emptyDescription="Search the DSM catalogue, or start from a common trio."
        actionLabel="Choose diagnoses"
        searchPlaceholder="Search diagnosis or ICD code"
        pickerTitle="Choose diagnoses"
        pickerDescription="Assign up to three diagnoses. Duplicates are blocked."
        pickerId="dsm-compare-picker"
        pickerTestId="dsm-compare-picker"
        changeLabel="Change diagnoses"
        slotPlaceholder="Choose diagnosis"
        icon={BookOpenCheck}
        showEmptyState={false}
        // Default slot layout, not the `compact` snap rail: at 390px the rail
        // cut slot B off and pushed C off screen. Default stacks the slots full
        // width on a phone and goes side by side once the strip is wide enough.
        onCommit={(ids) =>
          router.push(
            idsCompareHref(
              "/dsm/compare",
              ids.filter((id): id is string => Boolean(id)),
            ),
          )
        }
      />
      {filled < 2 && starters.length ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="dsm-compare-starters">
          <span className="text-2xs font-bold text-[color:var(--text-muted)]">Or start from a common set</span>
          {starters.map((chip) => (
            <Link
              key={chip.id}
              href={chip.href}
              className={cn(
                "inline-flex min-h-tap items-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 text-xs font-bold text-[color:var(--text-heading)] shadow-[var(--e1)] transition hover:border-[color:var(--clinical-accent-border)]",
              )}
            >
              {chip.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
