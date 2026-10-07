import { evaluateYear } from "@/lib/cme/evaluate";
import { rankRequirementsByGap } from "@/lib/cme/requirement-gaps";
import type { CmeCategory, CmeEntry, CmeRequirementSet } from "@/lib/cme/types";

function hoursIn(entries: readonly CmeEntry[], category: CmeCategory): number {
  let total = 0;
  for (const entry of entries) {
    if (entry.archivedAt) continue;
    for (const allocation of entry.allocations) {
      if (allocation.category === category) total += allocation.hours;
    }
  }
  return Math.round(total * 100) / 100;
}

/**
 * The categories an hours requirement in this year's set is still short in,
 * furthest from met first (the same ranking the Summary reads in).
 *
 * Feeds the "Still short" tag on the entry form's category chips. It is a
 * hint, never a choice: the form never preselects a tagged category. Empty
 * when the set has no hours targets or every hours target is met, so the tag
 * simply does not show. Only activities dated inside the set's year count,
 * and archived ones never do (the same rule the totals use).
 */
export function stillShortCategories(
  set: CmeRequirementSet | null | undefined,
  entries: readonly CmeEntry[],
): CmeCategory[] {
  if (!set) return [];
  const yearEntries = entries.filter((entry) => entry.date.startsWith(`${set.year}-`));
  const { statuses } = evaluateYear({ set, entries: yearEntries });
  const short: CmeCategory[] = [];
  const add = (category: CmeCategory) => {
    if (!short.includes(category)) short.push(category);
  };
  for (const status of rankRequirementsByGap(set, statuses)) {
    if (status.met) continue;
    const spec = set.requirements.find((requirement) => requirement.id === status.requirementId)?.spec;
    if (!spec) continue;
    if (spec.shape === "hours-in-category") {
      add(spec.category);
    } else if (spec.shape === "hours-across-categories") {
      const belowFloor = spec.categories.filter((category) => hoursIn(yearEntries, category) < spec.minimumEachHours);
      // Each category's own floor first; when every floor is reached but the
      // combined total is not, any of the named categories still helps.
      (belowFloor.length > 0 ? belowFloor : spec.categories).forEach(add);
    }
  }
  return short;
}
