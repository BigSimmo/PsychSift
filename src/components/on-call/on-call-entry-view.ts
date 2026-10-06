import { type OnCallEntry } from "@/lib/on-call/entry-model";
import {
  type OnCallPageView,
  onCallViewForEntry as libOnCallViewForEntry,
  onCallViewStorageSection as libOnCallViewStorageSection,
} from "@/lib/on-call/view";
import { onCallEntryAnchorId } from "@/components/on-call/on-call-page-anchors";
import { ON_CALL_VIEW_HREFS } from "@/lib/on-call/view-hrefs";
import { ADMIN_PAGE_HREFS } from "@/lib/admin/page-hrefs";
import { adminPlacementForEntry, isAdminWorkforceExplainer } from "@/lib/admin/placement";

export type { OnCallPageView };

export function onCallViewStorageSection(view: OnCallPageView) {
  return libOnCallViewStorageSection(view);
}

export function onCallViewForEntry(entry: OnCallEntry): OnCallPageView {
  return libOnCallViewForEntry(entry);
}

export function onCallEntryHref(entry: OnCallEntry): string {
  const anchor = `#${onCallEntryAnchorId(entry.id)}`;
  // Admin received On Call's admin rows and its workforce explainers; send each to the page that renders it.
  if (isAdminWorkforceExplainer(entry)) return `${ADMIN_PAGE_HREFS.help}${anchor}`;
  const placement = adminPlacementForEntry(entry);
  if (placement === "new-job") return `${ADMIN_PAGE_HREFS.newJob}${anchor}`;
  if (placement) return `${ADMIN_PAGE_HREFS.help}${anchor}`;
  return `${ON_CALL_VIEW_HREFS[onCallViewForEntry(entry)]}${anchor}`;
}
