import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ModeHomeRouteLoading } from "@/components/mode-home-page-skeleton";
import { EarlierAlertsPage } from "@/components/work-screens/my-day/earlier-alerts-page";
import { getWorkModeLaunch } from "@/lib/work-mode-launch/server";

export const metadata: Metadata = {
  title: "Earlier alerts | My Day | PsychSift",
  description: "The alerts that reached this phone in the last 7 days, by day, each opening the page it was for.",
};

type MyDayEarlierAlertsRouteProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Earlier alerts now lives under My Day › Notifications. A new work mode reader
 * is sent there with the area filter kept; the proxy already 404s this screen
 * for a reader on the classic work mode.
 */
export default async function MyDayEarlierAlertsRoute({ searchParams }: MyDayEarlierAlertsRouteProps) {
  if ((await getWorkModeLaunch()).newWorkMode) {
    const area = (searchParams ? await searchParams : {}).area;
    const query = typeof area === "string" && area ? `?${new URLSearchParams({ area }).toString()}` : "";
    redirect(`/my-day/notifications/earlier${query}`);
  }
  // The area filter lives in `?area=`, read through `useSearchParams`, which needs a
  // Suspense boundary in the App Router.
  return (
    <Suspense fallback={<ModeHomeRouteLoading />}>
      <EarlierAlertsPage />
    </Suspense>
  );
}
