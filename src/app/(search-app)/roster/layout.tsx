import type { ReactNode } from "react";

import { ModeBand } from "@/components/mode-band/mode-band";
import type { Metadata } from "next";
import { PRIVATE_APP_ROBOTS_METADATA } from "@/lib/crawler-policy";

// Personal work area: kept out of search results (repository audit F-30).
export const metadata: Metadata = {
  robots: PRIVATE_APP_ROBOTS_METADATA,
};

export default function RosterLayout({ children }: { children: ReactNode }) {
  // The status line is filled only by the signed-out sample (RosterSampleGate).
  return (
    <ModeBand modeId="roster" statusSlot>
      {children}
    </ModeBand>
  );
}
