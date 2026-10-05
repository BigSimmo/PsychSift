import type { Metadata } from "next";

import { OnCallShiftPulsePage } from "@/components/on-call/pulse/shift-pulse-page";

export const metadata: Metadata = {
  title: "Shift pulse | On Call | PsychSift",
  description: "Calls by hour, counts only, and the rest before your next rostered shift.",
};

export default function OnCallShiftPulseRoute() {
  return <OnCallShiftPulsePage />;
}
