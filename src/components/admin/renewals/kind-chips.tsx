import { WorkChip } from "@/components/mode-kit/work";
import { ADMIN_REQUIREMENT_GROUPS, type AdminRequirementGroup } from "@/lib/admin/requirements";

export type ChecklistKindFilter = "all" | AdminRequirementGroup;

const KIND_LABELS: Record<AdminRequirementGroup, string> = {
  registration: "Registration",
  checks: "Checks",
  health: "Health",
  training: "Training",
  job: "Job",
};

export const CHECKLIST_KIND_FILTERS: readonly ChecklistKindFilter[] = ["all", ...ADMIN_REQUIREMENT_GROUPS];

export function checklistKindLabel(kind: ChecklistKindFilter): string {
  return kind === "all" ? "All" : KIND_LABELS[kind];
}

/**
 * The kind filter row (Josh's locked mockup): "All, Registration, Checks,
 * Health, Training, Job" as the work kit's chips. `aria-pressed`, not a radio
 * group: a chip narrows the list rather than replacing it. The chips wrap onto
 * a second line on a phone rather than scrolling sideways, so none is ever
 * hidden off the edge (and a sideways drag here never fights the tab swipe).
 */
export function ChecklistKindChips({
  active,
  onChange,
  testId,
}: {
  readonly active: ChecklistKindFilter;
  readonly onChange: (next: ChecklistKindFilter) => void;
  readonly testId?: string;
}) {
  return (
    <div role="group" aria-label="Filter the checklist by kind" data-testid={testId} className="work-chips flex-wrap">
      {CHECKLIST_KIND_FILTERS.map((kind) => (
        <WorkChip
          key={kind}
          selected={kind === active}
          onClick={() => onChange(kind)}
          testId={testId ? `${testId}-${kind}` : undefined}
        >
          {checklistKindLabel(kind)}
        </WorkChip>
      ))}
    </div>
  );
}
