import type { MhaClockForm } from "@/components/psychiatry/mha-clock-page";
import { formCatalogDetails, formRecords } from "@/lib/forms";
import { hasMhaTimeline } from "@/lib/mha-timeline";

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
