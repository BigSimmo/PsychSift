import { telHref, type SavedNumber } from "@/lib/favourites/favourites-local";
import type { WorkItem } from "@/lib/work-search/model";

/**
 * Saved numbers as work-search records, so "pharmacy" in Search my work finds
 * the pharmacy number saved in Favourites. They sit under On Call, where the
 * hospital's numbers live. Display text only: a saved number is a work number
 * that passed the patient-detail check when it was kept.
 */
export function savedNumberWorkItems(numbers: readonly SavedNumber[]): WorkItem[] {
  return numbers.map((entry) => ({
    id: `favourite:entry:${entry.id}`,
    area: "on-call",
    kind: "entry",
    title: entry.label,
    detail: entry.note ? `${entry.number} · ${entry.note}` : entry.number,
    date: null,
    href: telHref(entry.number) ?? "/my-day/favourites",
    facet: "favourite",
    tags: ["favourite", "saved", "number", "phone", "call"],
    text: [entry.note, entry.number],
  }));
}
