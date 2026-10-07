import type { ReactNode } from "react";

import "@/components/on-call/on-call-work.css";

import { OnCallSampleNotice } from "@/components/on-call/on-call-sample-notice";
import { ModeBand } from "@/components/mode-band/mode-band";

export default function OnCallLayout({ children }: { children: ReactNode }) {
  // A top-level mode: today's date where the back link would be.
  return (
    <ModeBand modeId="on-call" lead={{ kind: "date" }}>
      {/* On Call's teal for every action link and the one filled button
          (mock-up v10). Custom properties inherit through `contents`, so the
          wrapper scopes the colour without adding a box. */}
      <div data-mode-identity="on-call" className="contents">
        <OnCallSampleNotice mode="on-call" />
        {children}
      </div>
    </ModeBand>
  );
}
