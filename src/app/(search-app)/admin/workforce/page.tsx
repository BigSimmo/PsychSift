import type { Metadata } from "next";
import { Suspense } from "react";

import { ModeHomeRouteLoading } from "@/components/mode-home-page-skeleton";
import { AdminWorkforcePage } from "@/components/work-screens/admin/workforce-page";

export const metadata: Metadata = {
  title: "Workforce | Admin | PsychSift",
  description:
    "The health service's side for Medical Workforce staff: starters, contract ends, requests and readiness. Not live yet, shown as a labelled sample.",
};

export default function AdminWorkforceRoute() {
  // The page reads `?view=sample` through `useSearchParams`, which needs a Suspense boundary.
  return (
    <Suspense fallback={<ModeHomeRouteLoading />}>
      <AdminWorkforcePage />
    </Suspense>
  );
}
