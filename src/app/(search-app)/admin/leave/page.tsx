import type { Metadata } from "next";
import { Suspense } from "react";

import { LeaveWalletPage } from "@/components/admin/leave/leave-wallet-page";
import { ModeHomeRouteLoading } from "@/components/mode-home-page-skeleton";

export const metadata: Metadata = {
  title: "Leave wallet | Admin | PsychSift",
  description:
    "Every leave type in one place: how to apply, what Roster already holds, and a ready message you copy and send yourself. Figures link to your agreement.",
};

export default function AdminLeaveRoute() {
  // The page reads `?card=` through `useSearchParams`, which needs a Suspense
  // boundary in the App Router.
  return (
    <Suspense fallback={<ModeHomeRouteLoading />}>
      <LeaveWalletPage />
    </Suspense>
  );
}
