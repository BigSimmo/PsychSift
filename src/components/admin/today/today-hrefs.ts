import { ADMIN_PAGE_HREFS } from "@/lib/admin/page-hrefs";
import type { RenewalsShowFilter } from "@/lib/admin/renewals-filters";

/**
 * Today's side of the Renewals deep-link contract. Renewals reads each of
 * these on arrival:
 *
 *   ?item=<entry id or catalogue item id>   opens that item's detail sheet
 *   ?show=<RenewalsShowFilter>              opens the Checklist filtered to those rows
 *   ?record=missing                         opens the "Record missing dates" sheet
 *
 * Built here (not in `src/lib`) because `src/lib` may not import
 * `@/components`, and the Renewals path lives in `admin-page-sections`.
 */
export function renewalsItemHref(id: string): string {
  return `${ADMIN_PAGE_HREFS.renewals}?item=${encodeURIComponent(id)}`;
}

export function renewalsShowHref(filter: RenewalsShowFilter): string {
  return `${ADMIN_PAGE_HREFS.renewals}?show=${filter}`;
}

export const RENEWALS_RECORD_MISSING_HREF = `${ADMIN_PAGE_HREFS.renewals}?record=missing`;
