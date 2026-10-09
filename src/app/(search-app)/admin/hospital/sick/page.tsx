import type { Metadata } from "next";
import { Suspense } from "react";

import { ModeHomeRouteLoading } from "@/components/mode-home-page-skeleton";
import { AdminHospitalSickPage } from "@/components/work-screens/hospital/hospital-sick-page";

export const metadata: Metadata = {
  title: "Sick calls | Hospital | PsychSift",
  description:
    "Sick calls across a hospital's teams for Medical Workforce. No reason or health detail is asked for or kept.",
};

export default function AdminHospitalSickRoute() {
  // The page reads `?hospitalId=` through `useSearchParams`, which needs a Suspense boundary.
  return (
    <Suspense fallback={<ModeHomeRouteLoading />}>
      <AdminHospitalSickPage />
    </Suspense>
  );
}
