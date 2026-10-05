import type { ReactNode } from "react";

import { ModeBand } from "@/components/mode-band/mode-band";

export default function PsychiatryLayout({ children }: { children: ReactNode }) {
  return (
    <ModeBand modeId="psychiatry" lead={{ kind: "date" }}>
      {children}
    </ModeBand>
  );
}
