import type { Metadata } from "next";
import { Suspense } from "react";

import { ModeHomeRouteLoading } from "@/components/mode-home-page-skeleton";
import { EarlierAlertsPage } from "@/components/work-screens/my-day/earlier-alerts-page";

export const metadata: Metadata = {
  title: "Earlier alerts | Notifications | My Day | PsychSift",
  description: "The alerts that reached this phone in the last 7 days, by day, each opening the page it was for.",
};

export default function MyDayNotificationsEarlierRoute() {
  // The area filter lives in `?area=`, read through `useSearchParams`, which needs a
  // Suspense boundary in the App Router.
  return (
    <Suspense fallback={<ModeHomeRouteLoading />}>
      <EarlierAlertsPage inFrame />
    </Suspense>
  );
}
