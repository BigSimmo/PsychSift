import type { ReactNode } from "react";

import { OnCallSampleNotice } from "@/components/on-call/on-call-sample-notice";
import { ModeBand } from "@/components/mode-band/mode-band";

export default function OnCallLayout({ children }: { children: ReactNode }) {
  // A top-level mode: today's date where the back link would be.
  return (
    <ModeBand modeId="on-call" lead={{ kind: "date" }}>
      <OnCallSampleNotice mode="on-call" />
      {children}
    </ModeBand>
  );
}
