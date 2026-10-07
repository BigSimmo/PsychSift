import type { Metadata } from "next";
import { Suspense } from "react";

import { StarterPackPage } from "@/components/admin/starter/starter-pack-page";
import { ModeHomeRouteLoading } from "@/components/mode-home-page-skeleton";

export const metadata: Metadata = {
  title: "Starter pack | Admin | PsychSift",
  description:
    "For doctors new to WA hospitals: how the hospital works, local words searchable by the word from home, your own visa and registration dates, and who to ask. Not visa or registration advice.",
};

export default function AdminStarterPackRoute() {
  // The page reads `?word=` through `useSearchParams`, which needs a Suspense
  // boundary in the App Router.
  return (
    <Suspense fallback={<ModeHomeRouteLoading />}>
      <StarterPackPage />
    </Suspense>
  );
}
