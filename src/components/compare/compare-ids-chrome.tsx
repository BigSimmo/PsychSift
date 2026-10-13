"use client";

import type { LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { CompareCatalogPicker } from "@/components/compare/compare-catalog-picker";
import { CompareEmptyState } from "@/components/compare/compare-empty-state";
import { ComparePickerShell } from "@/components/compare/compare-picker-shell";
import { CompareSlotStrip } from "@/components/compare/compare-slot-strip";
import { assignCompareId, firstEmptySlot, padCompareIds, slotLetters } from "@/components/compare/filter-catalog";
import type {
  CompareCatalogItem,
  ComparePhoneLayout,
  CompareSlot,
  CompareStarterChip,
} from "@/components/compare/types";
import { useComparePicker } from "@/components/compare/use-compare-picker";
import { usePhoneMedia } from "@/components/compare/use-phone-media";

export function CompareIdsChrome({
  selectedIds,
  maxCount,
  minCount = 2,
  items,
  starters,
  emptyTitle,
  emptyDescription,
  actionLabel,
  searchPlaceholder,
  pickerTitle,
  pickerDescription,
  pickerId,
  pickerTestId,
  changeLabel = "Change selection",
  slotPlaceholder = "Choose",
  swapLabel,
  icon,
  filterLocally = true,
  phoneLayout = "default",
  slotSummaryLabel,
  showEmptyState = true,
  slotLayout = "default",
  onCommit,
}: {
  selectedIds: readonly (string | null | undefined)[];
  maxCount: number;
  minCount?: number;
  items: readonly CompareCatalogItem[];
  starters?: readonly CompareStarterChip[];
  emptyTitle: string;
  emptyDescription: string;
  actionLabel: string;
  searchPlaceholder: string;
  pickerTitle: string;
  pickerDescription: string;
  pickerId: string;
  pickerTestId: string;
  changeLabel?: string;
  slotPlaceholder?: string;
  swapLabel?: string;
  icon?: LucideIcon;
  filterLocally?: boolean;
  phoneLayout?: ComparePhoneLayout;
  slotSummaryLabel?: string;
  /** When slot placeholders already invite selection, skip the large dashed empty panel. */
  showEmptyState?: boolean;
  /** `compact` lays out three slots in a horizontal phone rail instead of a vertical stack. */
  slotLayout?: "default" | "compact";
  onCommit: (ids: Array<string | null>) => void;
}) {
  const phone = usePhoneMedia();
  const ids = padCompareIds(selectedIds, maxCount);
  const filled = ids.filter(Boolean).length;
  // When the empty panel is suppressed (compact slot rail + inline starters),
  // do not auto-open the picker — the slots invite selection without a second
  // starter surface competing for attention.
  const picker = useComparePicker(showEmptyState && filled < minCount, firstEmptySlot(ids) ?? 0);
  const [announcement, setAnnouncement] = useState("");
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const labels = slotLetters(maxCount);
  const slots: CompareSlot[] = ids.map((id, index) => {
    const item = id ? byId.get(id) : undefined;
    return {
      id,
      label: labels[index] ?? String(index + 1),
      title: item?.title ?? slotPlaceholder,
      // The tag first, the snippet only as a fallback. A tile is 200-300px wide
      // and its job is "which one is this" — a category ("Skills based") answers
      // that in one short line, while a clinical summary opens by repeating the
      // title and then clips mid-sentence. The full snippet is still the
      // picker's job, where there is room to read it.
      subtitle: item?.tag ?? item?.snippet,
    };
  });
  const suppressEmptyState = phoneLayout === "hybrid" && phone && filled < minCount;

  function commit(next: Array<string | null>, chosenId?: string) {
    if (chosenId) {
      const item = byId.get(chosenId);
      const label = labels[picker.activeSlot] ?? "slot";
      setAnnouncement(item ? `${item.title} added as ${label}` : `${chosenId} added as ${label}`);
    }
    const empty = firstEmptySlot(next);
    if (empty === null) picker.close();
    else picker.setActiveSlot(empty);
    onCommit(next);
  }

  function choose(id: string) {
    commit(assignCompareId(ids, picker.activeSlot, id), id);
  }

  function swap() {
    if (maxCount !== 2 || !ids[0] || !ids[1]) return;
    onCommit([ids[1], ids[0]]);
  }

  function openPicker() {
    picker.openSlot(firstEmptySlot(ids) ?? 0);
  }

  return (
    <>
      <CompareSlotStrip
        slots={slots}
        layout={slotLayout}
        activeIndex={picker.open ? picker.activeSlot : null}
        onSelectSlot={picker.openSlot}
        onClearSlot={(index) => commit(ids.map((id, slotIndex) => (slotIndex === index ? null : id)))}
        onSwap={maxCount === 2 ? swap : undefined}
        swapLabel={swapLabel}
        changeLabel={changeLabel}
        onChange={openPicker}
        phoneLayout={phoneLayout}
        actionLabel={actionLabel}
        minCount={minCount}
        slotSummaryLabel={slotSummaryLabel}
        starters={starters}
        onPrimaryAction={openPicker}
      />
      <ComparePickerShell
        open={picker.open}
        onClose={picker.close}
        title={pickerTitle}
        description={pickerDescription}
        phone={picker.phone}
        onDone={picker.close}
        onReset={() => commit(padCompareIds([], maxCount))}
        id={pickerId}
        testId={pickerTestId}
      >
        <CompareCatalogPicker
          items={items}
          query={picker.query}
          onQueryChange={picker.setQuery}
          selectedIds={ids}
          maxCount={maxCount}
          activeSlot={picker.activeSlot}
          onActiveSlotChange={picker.setActiveSlot}
          onChoose={choose}
          onDone={picker.close}
          onReset={() => commit(padCompareIds([], maxCount))}
          hideActions={picker.phone}
          searchPlaceholder={searchPlaceholder}
          emptyHint="No matching items."
          announcement={announcement}
          filterLocally={filterLocally}
          title={pickerTitle}
          titleId={`${pickerId}-title`}
          starters={starters}
        />
      </ComparePickerShell>
      {/* The open picker already carries the same title, description and starters — do not stack a
          second empty panel underneath it. */}
      {showEmptyState && filled < minCount && !suppressEmptyState && !picker.open ? (
        <CompareEmptyState
          icon={icon}
          title={emptyTitle}
          description={emptyDescription}
          actionLabel={actionLabel}
          onAction={openPicker}
          chips={starters}
        />
      ) : null}
    </>
  );
}
