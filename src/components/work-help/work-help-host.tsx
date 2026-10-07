"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { closeWorkHelp, useOpenWorkHelp } from "@/components/work-help/work-help-store";
import { workHelpTopicForArea } from "@/lib/work-help";

// The sheet and its words load on first open, never with the page.
const WorkHelpSheet = dynamic(() => import("@/components/work-help/work-help-sheet"), { ssr: false });

/**
 * Mounted once by the work frame. Draws the help sheet for whichever area asked
 * (`openWorkHelp`), and puts it away when the page changes, so following a link
 * out of the sheet never leaves it standing over the new page.
 */
export function WorkHelpHost() {
  const area = useOpenWorkHelp();
  const pathname = usePathname();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    closeWorkHelp();
  }, [pathname]);
  if (!area) return null;
  return <WorkHelpSheet topic={workHelpTopicForArea(area)} open onClose={closeWorkHelp} />;
}
