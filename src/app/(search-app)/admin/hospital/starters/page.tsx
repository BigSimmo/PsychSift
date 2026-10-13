import type { Metadata } from "next";
import { Suspense } from "react";

import { ModeHomeRouteLoading } from "@/components/mode-home-page-skeleton";
import { AdminHospitalStartersPage } from "@/components/work-screens/hospital/hospital-starters-page";

export const metadata: Metadata = {
  title: "New starters | Hospital | PsychSift",
  description:
    "New job progress for Medical Workforce, from doctors in the hospital's teams who chose to share it. Personal items are never shared.",
};

export default function AdminHospitalStartersRoute() {
  // The page reads `?hospitalId=` through `useSearchParams`, which needs a Suspense boundary.
  return (
    <Suspense fallback={<ModeHomeRouteLoading />}>
      <AdminHospitalStartersPage />
    </Suspense>
  );
}
