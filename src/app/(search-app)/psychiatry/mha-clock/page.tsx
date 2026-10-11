import type { Metadata } from "next";

import { MhaClockPage } from "@/components/psychiatry/mha-clock-page";
import { mhaClockForms } from "@/lib/psychiatry-hub/mha-clock-forms";

export const metadata: Metadata = {
  title: "MHA clock | PsychSift",
  description: "Every Mental Health Act form you are holding, with how long it has been running and its time limits.",
};

/**
 * Psychiatry · MHA clock, the hub's shortcut. The same clock is the Clinical
 * Forms mode's Clock tab at /forms/clock. The form list is read here, on the
 * server, so the forms catalogue never reaches the browser: only forms with time
 * limits in the governed timeframe data are offered.
 */
export default function MhaClockRoute() {
  return <MhaClockPage forms={mhaClockForms()} />;
}
