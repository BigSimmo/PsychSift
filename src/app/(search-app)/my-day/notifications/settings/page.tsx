import type { Metadata } from "next";

import { AlertsPage } from "@/components/alerts/alerts-page";

export const metadata: Metadata = {
  title: "Settings | Notifications | My Day | PsychSift",
  description: "What can reach your phone and when: alerts by area, quiet hours and this device's phone alerts.",
};

export default function MyDayNotificationsSettingsRoute() {
  return <AlertsPage inFrame />;
}
