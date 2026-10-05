import type { Metadata } from "next";

import { OpenShiftsMinePage } from "@/components/open-shifts/open-shifts-mine-page";

export const metadata: Metadata = {
  title: "My shifts | Open shifts | PsychSift",
  description: "Extra shifts you have applied for or been given.",
};

export default function OpenShiftsMineRoute() {
  return <OpenShiftsMinePage />;
}
