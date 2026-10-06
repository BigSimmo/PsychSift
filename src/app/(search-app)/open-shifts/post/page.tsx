import type { Metadata } from "next";

import { OpenShiftsPostedPage } from "@/components/open-shifts/open-shifts-posted-page";

export const metadata: Metadata = {
  title: "Post | Open shifts | PsychSift",
  description: "Extra shifts you have posted for your Roster teams.",
};

export default function OpenShiftsPostedRoute() {
  return <OpenShiftsPostedPage />;
}
