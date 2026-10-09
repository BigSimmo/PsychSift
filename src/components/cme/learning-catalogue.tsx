"use client";

import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";

export type LearningSpecialtyFilterProps = {
  specialty: string;
  onSpecialtyChange: (value: string) => void;
  specialties: readonly string[];
  labelId?: string;
};

/**
 * Dedicated specialty filter pill group for the CME learning catalogue.
 * Ensures the "All" specialty filter pill button enforces a min-w-[44px] touch target.
 */
export function LearningCatalogueSpecialtyFilter({
  specialty,
  onSpecialtyChange,
  specialties,
  labelId = "cme-learning-specialty-label",
}: LearningSpecialtyFilterProps) {
  const options: ReadonlyArray<SegmentedControlOption<string>> = [
    { value: "all", label: "All" },
    ...specialties.map((name) => ({
      value: name,
      label: name.charAt(0).toUpperCase() + name.slice(1),
    })),
  ];

  return (
    <div className="min-w-0 [&_button]:min-w-[44px]">
      <SegmentedControl
        ariaLabelledBy={labelId}
        value={specialty}
        onChange={onSpecialtyChange}
        options={options}
        className="w-auto self-start [&_button]:min-w-[44px]"
      />
    </div>
  );
}

export { CmeLearningPage } from "@/components/cme/cme-learning-page";
