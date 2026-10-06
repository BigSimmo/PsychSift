import type { Metadata } from "next";

import { AlertsPage } from "@/components/alerts/alerts-page";

export const metadata: Metadata = {
  title: "Alerts | My Day | PsychSift",
  description: "What can reach your phone and when: alerts by area, quiet hours and this device's phone alerts.",
};

export default function MyDayAlertsRoute() {
  return <AlertsPage />;
}
