import type { Metadata } from "next";
import { Suspense } from "react";

import { WorkHelpPage } from "@/components/work-help/work-help-page";

export const metadata: Metadata = {
  title: "Help | My Day | PsychSift",
  description: "How each Work area works: tabs, common questions and where to set things up.",
};

export default function WorkHelpRoute() {
  return (
    <Suspense fallback={null}>
      <WorkHelpPage />
    </Suspense>
  );
}
