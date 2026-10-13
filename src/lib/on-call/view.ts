import { isComplianceEntry } from "@/lib/on-call/compliance";
import {
  ON_CALL_VIEW_PAGES,
  type OnCallEntry,
  type OnCallPageView,
  type OnCallSection,
} from "@/lib/on-call/entry-model";
import { isRoleExplainerEntry } from "@/lib/on-call/who-is-who";

export { ON_CALL_VIEW_PAGES, type OnCallPageView };

/**
 * Which stored section a view writes to.
 * Who's who writes `contacts` rows; Compliance writes `logistics` rows;
 * every other view writes its own.
 */
export function onCallViewStorageSection(view: OnCallPageView): OnCallSection {
  if (view === "who-is-who") return "contacts";
  if (view === "compliance") return "logistics";
  return view;
}

/**
 * Which view an entry belongs to.
 *
 * If `entry.view` is already present (e.g. from the repository presentation model),
 * it returns that directly. Otherwise, it derives the virtual view from the stored
 * section and details.kind (Who's who over `contacts`, Compliance over `logistics`).
 */
export function onCallViewForEntry(
  entry: Pick<OnCallEntry, "section"> & Partial<Pick<OnCallEntry, "view" | "details">>,
): OnCallPageView {
  if (entry.view) return entry.view;
  if (isComplianceEntry(entry as OnCallEntry)) return "compliance";
  if (isRoleExplainerEntry(entry as OnCallEntry)) return "who-is-who";
  return entry.section;
}
