"use client";

import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import { closeWorkHelp, useOpenWorkHelp } from "@/components/work-help/work-help-store";
import { workHelpTopic, workHelpTopicForArea } from "@/lib/work-help";

// The sheet and its words load apart from the page, fetched when the phone is idle
// so a first open still works after the signal drops.
const loadSheet = () => import("@/components/work-help/work-help-sheet");
const WorkHelpSheet = dynamic(loadSheet, { ssr: false });

/**
 * Mounted once by the work frame. Draws the help sheet for whichever area asked
 * (`openWorkHelp`), and puts it away when the page changes, so following a link
 * out of the sheet never leaves it standing over the new page.
 */
export function WorkHelpHost() {
  const area = useOpenWorkHelp();
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? "";
  const where = `${pathname}?${search}`;
  const shownAt = useRef(where);
  useEffect(() => {
    if (shownAt.current === where) return;
    shownAt.current = where;
    closeWorkHelp();
  }, [where]);
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 2000));
    idle(() => void loadSheet().catch(() => undefined));
  }, []);
  if (!area) return null;
  // Open shifts lives inside Roster's frame but has its own help.
  const topic = pathname?.startsWith("/open-shifts") ? workHelpTopic("open-shifts") : null;
  return <WorkHelpSheet topic={topic ?? workHelpTopicForArea(area)} open onClose={closeWorkHelp} />;
}
