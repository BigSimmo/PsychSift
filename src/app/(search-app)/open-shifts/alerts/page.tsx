import type { Metadata } from "next";

import { OpenShiftsAlertsPage } from "@/components/open-shifts/open-shifts-alerts-page";

export const metadata: Metadata = {
  title: "Alerts | Open shifts | PsychSift",
  description: "Choose which new extra shifts you hear about.",
};

export default function OpenShiftsAlertsRoute() {
  return <OpenShiftsAlertsPage />;
}
