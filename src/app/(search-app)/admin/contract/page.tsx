import type { Metadata } from "next";
import { Suspense } from "react";

import { ContractEndPage } from "@/components/admin/contract/contract-end-page";
import { ModeHomeRouteLoading } from "@/components/mode-home-page-skeleton";

export const metadata: Metadata = {
  title: "Contract end | Admin | PsychSift",
  description:
    "Your contract end date, reminders 3 months and 6 weeks before, what to ask, and a message for Medical Workforce that you send yourself.",
};

export default function AdminContractRoute() {
  // The page reads `?question=` through `useSearchParams`, which needs a
  // Suspense boundary in the App Router.
  return (
    <Suspense fallback={<ModeHomeRouteLoading />}>
      <ContractEndPage />
    </Suspense>
  );
}
