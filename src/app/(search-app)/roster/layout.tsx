import type { ReactNode } from "react";

import { ModeBand } from "@/components/mode-band/mode-band";

export default function RosterLayout({ children }: { children: ReactNode }) {
  // Roster has no saving yet, so its band says so plainly on every page.
  return (
    <ModeBand modeId="roster" status={{ kind: "text", text: "Practice only · nothing here is saved yet", info: true }}>
      {children}
    </ModeBand>
  );
}
