import type { Metadata } from "next";
import { Suspense } from "react";

import { AgreementAskPage } from "@/components/agreement-ask/agreement-ask-page";
import { ModeHomeRouteLoading } from "@/components/mode-home-page-skeleton";

export const metadata: Metadata = {
  title: "Ask the agreement | My Day | PsychSift",
  description:
    "Hours and rest questions answered only with quotes from the WA Health AMA Industrial Agreement 2024, each with its clause. No AI.",
};

export default function AgreementAskRoute() {
  return (
    <Suspense fallback={<ModeHomeRouteLoading />}>
      <AgreementAskPage />
    </Suspense>
  );
}
