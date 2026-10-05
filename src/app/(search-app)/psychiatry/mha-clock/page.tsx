import type { Metadata } from "next";

import { MhaClockPage, type MhaClockForm } from "@/components/psychiatry/mha-clock-page";
import { formCatalogDetails, formRecords } from "@/lib/forms";
import { hasMhaTimeline } from "@/lib/mha-timeline";

export const metadata: Metadata = {
  title: "MHA clock | PsychSift",
  description: "Every Mental Health Act form you are holding, with how long it has been running and its time limits.",
};

/**
 * Psychiatry · MHA clock. The form list is read here, on the server, so the forms catalogue never
 * reaches the browser: only forms with time limits in the governed timeframe data are offered.
 */
export default function MhaClockRoute() {
  const forms: MhaClockForm[] = formRecords.flatMap((record) => {
    const code = formCatalogDetails(record)?.form;
    return code && hasMhaTimeline(code) ? [{ code, title: record.title, slug: record.slug }] : [];
  });
  return <MhaClockPage forms={forms} />;
}
