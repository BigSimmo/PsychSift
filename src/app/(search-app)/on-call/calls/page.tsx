import type { Metadata } from "next";

import { OnCallCallLogPage } from "@/components/on-call/shift/call-log-page";

export const metadata: Metadata = {
  title: "Call log | On Call | PsychSift",
  description: "Calls you take this shift, kept on this phone only and cleared when the shift ends.",
};

export default function OnCallCallLogRoute() {
  return <OnCallCallLogPage />;
}
