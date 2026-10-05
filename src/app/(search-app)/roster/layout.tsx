import type { ReactNode } from "react";

import { ModeBand } from "@/components/mode-band/mode-band";

export default function RosterLayout({ children }: { children: ReactNode }) {
  // The status line is filled only by the signed-out sample (RosterSampleGate).
  return (
    <ModeBand modeId="roster" statusSlot>
      {children}
    </ModeBand>
  );
}
