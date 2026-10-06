import type { Metadata } from "next";
import { Suspense } from "react";

import { ModeHomeRouteLoading } from "@/components/mode-home-page-skeleton";
import { MyDayPage } from "@/components/my-day/my-day-page";

export const metadata: Metadata = {
  title: "My Day | PsychSift",
  description:
    "One list of what needs you across On Call, Roster, CPD, Teaching and Admin: overdue first, then due soon, then the rest.",
};

/** My Day (mode id `my-day`): a read-only merged list with no search surface. */
export default function MyDayRoute() {
  // The page reads `?view=all` (the full list's own address) through
  // `useSearchParams`, which needs a Suspense boundary in the App Router. Its
  // fallback is the same skeleton as the route's own loading.
  return (
    <Suspense fallback={<ModeHomeRouteLoading />}>
      <MyDayPage />
    </Suspense>
  );
}
