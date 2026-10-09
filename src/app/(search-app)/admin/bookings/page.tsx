import type { Metadata } from "next";
import { Suspense } from "react";

import { ModeHomeRouteLoading } from "@/components/mode-home-page-skeleton";
import { AdminBookingsPage } from "@/components/work-screens/admin/bookings-page";
import { requireLivePreview } from "@/lib/live-version/server";

export const metadata: Metadata = {
  title: "Bookings | Admin | PsychSift",
  description:
    "Book courses and work requirements an organiser posts. Every booking goes in your calendar, and changes update it.",
};

export default async function AdminBookingsRoute() {
  await requireLivePreview("course-bookings");
  // The page reads `?view` and `?course` through `useSearchParams`, which needs a Suspense boundary.
  return (
    <Suspense fallback={<ModeHomeRouteLoading />}>
      <AdminBookingsPage />
    </Suspense>
  );
}
