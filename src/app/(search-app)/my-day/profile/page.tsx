import type { Metadata } from "next";
import { Suspense } from "react";

import { ModeHomeRouteLoading } from "@/components/mode-home-page-skeleton";
import { WorkProfilePage } from "@/components/work-profile/work-profile-page";

export const metadata: Metadata = {
  title: "Work profile | My Day | PsychSift",
  description: "Your stage, workplaces, agreement rules, alerts and privacy: the Work settings you set once.",
};

export default function WorkProfileRoute() {
  return (
    <Suspense fallback={<ModeHomeRouteLoading />}>
      <WorkProfilePage />
    </Suspense>
  );
}
