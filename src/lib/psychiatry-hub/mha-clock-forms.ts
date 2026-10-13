import { formCatalogDetails, formRecords } from "@/lib/forms";
import { hasMhaTimeline } from "@/lib/mha-timeline";

/** One form the MHA clock can track. */
export interface MhaClockForm {
  readonly code: string;
  readonly title: string;
  readonly slug: string;
}

/**
 * The forms the MHA clock offers: only forms with time limits in the governed
 * timeframe data. Called by the two clock routes (Psychiatry and Forms) on the
 * server, so the forms catalogue never reaches the browser.
 */
export function mhaClockForms(): MhaClockForm[] {
  return formRecords.flatMap((record) => {
    const code = formCatalogDetails(record)?.form;
    return code && hasMhaTimeline(code) ? [{ code, title: record.title, slug: record.slug }] : [];
  });
}
