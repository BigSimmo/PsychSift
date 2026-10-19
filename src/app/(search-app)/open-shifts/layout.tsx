import type { ReactNode } from "react";

import { ModeBand } from "@/components/mode-band/mode-band";
import type { Metadata } from "next";
import { PRIVATE_APP_ROBOTS_METADATA } from "@/lib/crawler-policy";

// Personal work area: kept out of search results (repository audit F-30).
export const metadata: Metadata = {
  robots: PRIVATE_APP_ROBOTS_METADATA,
};

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
      {/* The pages' main landmark: none of the Open shifts pages draws its own. */}
      <main className="min-w-0">{children}</main>
    </ModeBand>
  );
}
