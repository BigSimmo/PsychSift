import type { Metadata } from "next";

import { OpenShiftsBoardPage } from "@/components/open-shifts/open-shifts-board-page";

export const metadata: Metadata = {
  title: "Board | Open shifts | PsychSift",
  description: "Every open shift in your Roster teams at a glance.",
};

export default function OpenShiftsBoardRoute() {
  return <OpenShiftsBoardPage />;
}
