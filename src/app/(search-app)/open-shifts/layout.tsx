import type { ReactNode } from "react";

import { ModeBand } from "@/components/mode-band/mode-band";

export default function OpenShiftsLayout({ children }: { children: ReactNode }) {
  // A top-level mode: today's date where the back link would be. Advert,
  // posting, log and board pages carry their own sub-header, so the band
  // stays off them; the Post tab itself (`/open-shifts/post`) keeps it.
  return (
    <ModeBand
      modeId="open-shifts"
      lead={{ kind: "date" }}
      statusSlot
      hiddenOn={["/open-shifts/shift/", "/open-shifts/post/", "/open-shifts/log", "/open-shifts/board"]}
    >
      {children}
    </ModeBand>
  );
}
