import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ModeHomeRouteLoading } from "@/components/mode-home-page-skeleton";
import { MyDayPage } from "@/components/my-day/my-day-page";
import { getWorkModeLaunch } from "@/lib/work-mode-launch/server";

export const metadata: Metadata = {
  title: "My Day | PsychSift",
  description:
    "One list of what needs you across On Call, Roster, CPD, Teaching and Admin: overdue first, then due soon, then the rest.",
};

type MyDayRouteProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

/** My Day (mode id `my-day`): a read-only merged list with no search surface. */
export default async function MyDayRoute({ searchParams }: MyDayRouteProps) {
  // The full list (`?view=all`) is My Day › Notifications on the new work mode.
  // Every other address, and every classic reader, gets My Day as before.
  const params = searchParams ? await searchParams : {};
  if (params.view === "all" && (await getWorkModeLaunch()).newWorkMode) redirect("/my-day/notifications");
  // The page reads `?view=all` (the full list's own address) through
  // `useSearchParams`, which needs a Suspense boundary in the App Router. Its
  // fallback is the same skeleton as the route's own loading.
  return (
    <Suspense fallback={<ModeHomeRouteLoading />}>
      <MyDayPage />
    </Suspense>
  );
}
