import type { Metadata } from "next";
import { Suspense } from "react";

import { ModeHomeRouteLoading } from "@/components/mode-home-page-skeleton";
import { AdminHospitalShortStaffedPage } from "@/components/work-screens/hospital/hospital-short-staffed-page";

export const metadata: Metadata = {
  title: "Short-staffed days | Hospital | PsychSift",
  description:
    "Upcoming days on which a hospital's teams are below their safe number, for Medical Workforce. Counts and team names only.",
};

export default function AdminHospitalShortStaffedRoute() {
  // The page reads `?hospitalId=` through `useSearchParams`, which needs a Suspense boundary.
  return (
    <Suspense fallback={<ModeHomeRouteLoading />}>
      <AdminHospitalShortStaffedPage />
    </Suspense>
  );
}
