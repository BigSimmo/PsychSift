"use client";

import type { ComponentProps } from "react";
import { NewWorkModeOnly } from "@/components/work-mode-launch/work-mode-launch-provider";
import { CalendarDays } from "lucide-react";

import { WorkCard, WorkIconRow } from "@/components/mode-kit/work";

/**
 * The way into "From your team roster", for On Call People and Who's on (and
 * the More sheet's "Who's on"). A literal link, so the route-reachability guard
 * can read it.
 */
function RosterWhosOnEntryLinkShown({
  sub = "Who is on, straight from the published roster",
}: {
  readonly sub?: string;
}) {
  return (
    <WorkCard>
      <WorkIconRow
        icon={CalendarDays}
        title="From your team roster"
        sub={sub}
        href="/on-call/whos-on/roster"
        testId="on-call-roster-whos-on-entry"
      />
    </WorkCard>
  );
}

/** Leads to a new work mode screen, so it shows only to readers the launch switch has let in. */
export function RosterWhosOnEntryLink(props: ComponentProps<typeof RosterWhosOnEntryLinkShown>) {
  return (
    <NewWorkModeOnly>
      <RosterWhosOnEntryLinkShown {...props} />
    </NewWorkModeOnly>
  );
}
