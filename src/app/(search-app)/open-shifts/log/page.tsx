import type { Metadata } from "next";

import { OpenShiftsLogPage } from "@/components/open-shifts/open-shifts-log-page";

export const metadata: Metadata = {
  title: "Log | Open shifts | PsychSift",
  description: "What has happened to the extra shifts in your Roster teams.",
};

export default function OpenShiftsLogRoute() {
  return <OpenShiftsLogPage />;
}
