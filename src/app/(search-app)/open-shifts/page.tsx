import type { Metadata } from "next";

import { OpenShiftsBrowsePage } from "@/components/open-shifts/open-shifts-browse-page";

export const metadata: Metadata = {
  title: "Open shifts | PsychSift",
  description: "Extra shifts advertised in your Roster teams.",
};

export default function OpenShiftsBrowseRoute() {
  return <OpenShiftsBrowsePage />;
}
