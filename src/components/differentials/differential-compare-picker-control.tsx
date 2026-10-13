"use client";

import { useRouter } from "next/navigation";

import {
  CompareCatalogPicker,
  CompareEmptyState,
  ComparePickerShell,
  assignCompareId,
  firstEmptySlot,
  idsCompareHref,
  padCompareIds,
  useComparePicker,
  type CompareCatalogItem,
  type CompareStarterChip,
} from "@/components/compare";
import { GitCompareArrows } from "lucide-react";

const COMPARE_PATH = "/differentials/compare";
/**
 * The picker's slot count, and therefore the most ids a compare queue can carry.
 * Exported because the detail page prefills a queue and must not hand over more
 * than this: `padCompareIds` truncates to it, so a ninth id disappears the first
 * time a reader opens "Edit selection" and is committed away on the next edit.
 */
export const COMPARE_MAX_COUNT = 8;
const MAX_COUNT = COMPARE_MAX_COUNT;

export function DifferentialComparePickerControl({
  catalog,
  selectedIds,
  query,
  starters,
  empty,
  buttonLabel,
  buttonTestId,
  buttonClassName,
}: {
  catalog: readonly CompareCatalogItem[];
  selectedIds: readonly string[];
  query?: string;
  starters?: readonly CompareStarterChip[];
  empty?: boolean;
  buttonLabel: string;
  buttonTestId?: string;
  buttonClassName?: string;
}) {
  const router = useRouter();
  const maxCount = Math.min(MAX_COUNT, Math.max(selectedIds.length + 1, 2));
  const ids = padCompareIds(selectedIds, maxCount);
  const picker = useComparePicker(Boolean(empty), firstEmptySlot(ids) ?? selectedIds.length);
  const extra = query?.trim() ? { q: query.trim() } : undefined;

  function commit(next: Array<string | null>) {
    router.push(idsCompareHref(COMPARE_PATH, next, extra));
  }

  function choose(id: string) {
    const next = assignCompareId(ids, picker.activeSlot, id);
    const emptySlot = firstEmptySlot(next);
    if (emptySlot === null) picker.close();
    else picker.setActiveSlot(emptySlot);
    commit(next);
  }

  return (
    <>
      {empty ? (
        <CompareEmptyState
          icon={GitCompareArrows}
          title="Choose diagnoses to compare"
          description="Search the diagnosis catalogue, or start from a common pair. Search remains a valid way to tick diagnoses before opening compare."
          actionLabel={buttonLabel}
          onAction={() => picker.openSlot(firstEmptySlot(ids) ?? 0)}
          chips={starters}
        />
      ) : (
        <button
          type="button"
          data-testid={buttonTestId}
          className={buttonClassName}
          onClick={() => picker.openSlot(firstEmptySlot(ids) ?? 0)}
        >
          {buttonLabel}
        </button>
      )}
      <ComparePickerShell
        open={picker.open}
        onClose={picker.close}
        title="Choose diagnoses to compare"
        description="Add or replace diagnoses in this comparison queue."
        phone={picker.phone}
        onDone={picker.close}
        onReset={() => commit([])}
        id="differential-compare-picker"
        testId="differential-compare-picker"
      >
        <CompareCatalogPicker
          items={catalog}
          query={picker.query}
          onQueryChange={picker.setQuery}
          selectedIds={ids}
          maxCount={maxCount}
          activeSlot={picker.activeSlot}
          onActiveSlotChange={picker.setActiveSlot}
          onChoose={choose}
          onDone={picker.close}
          onReset={() => commit([])}
          hideActions={picker.phone}
          searchPlaceholder="Search diagnosis"
          emptyHint="No matching diagnoses."
          filterLocally
          title="Choose diagnoses to compare"
          titleId="differential-compare-picker-title"
          starters={starters}
        />
      </ComparePickerShell>
    </>
  );
}
