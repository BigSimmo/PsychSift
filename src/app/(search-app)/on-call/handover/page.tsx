import type { Metadata } from "next";

import { OnCallHandoverPage } from "@/components/on-call/handover/handover-page";

export const metadata: Metadata = {
  title: "Handover | On Call | PsychSift",
  description: "A fast psychiatry handover, one patient at a time, kept on this phone and made into a table.",
};

export default function OnCallHandoverRoute() {
  return <OnCallHandoverPage />;
}
