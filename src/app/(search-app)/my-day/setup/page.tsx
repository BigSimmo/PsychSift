import type { Metadata } from "next";
import { Suspense } from "react";

import { WorkSetupPage } from "@/components/work-setup/work-setup-page";

export const metadata: Metadata = {
  title: "Set up Work | My Day | PsychSift",
  description: "A short walkthrough to set up your stage, areas, time zone, roster, rotation and alerts.",
};

export default function WorkSetupRoute() {
  return (
    <Suspense fallback={null}>
      <WorkSetupPage />
    </Suspense>
  );
}
