import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AlertsPage } from "@/components/alerts/alerts-page";
import { getWorkModeLaunch } from "@/lib/work-mode-launch/server";

export const metadata: Metadata = {
  title: "Alerts | My Day | PsychSift",
  description: "What can reach your phone and when: alerts by area, quiet hours and this device's phone alerts.",
};

/** Readers on the new work mode find these settings under My Day › Notifications. */
export default async function MyDayAlertsRoute() {
  if ((await getWorkModeLaunch()).newWorkMode) redirect("/my-day/notifications/settings");
  return <AlertsPage />;
}
