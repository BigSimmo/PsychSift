import type { Metadata } from "next";
import { Suspense } from "react";

import { ModeHomeRouteLoading } from "@/components/mode-home-page-skeleton";
import { AdminCoursesPage } from "@/components/work-screens/admin/courses-page";

export const metadata: Metadata = {
  title: "Courses | Admin | PsychSift",
  description:
    "The organiser's side of Bookings: post courses and work requirements, see who is booked, edit or cancel.",
};

export default async function AdminCoursesRoute() {
  // The page reads `?new` and `?course` through `useSearchParams`, which needs a Suspense boundary.
  return (
    <Suspense fallback={<ModeHomeRouteLoading />}>
      <AdminCoursesPage />
    </Suspense>
  );
}
