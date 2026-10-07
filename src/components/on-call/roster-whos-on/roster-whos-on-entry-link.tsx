"use client";

import { CalendarDays } from "lucide-react";

import { WorkCard, WorkIconRow } from "@/components/mode-kit/work";

/**
 * The way into "From your team roster", for On Call People and Who's on (and
 * the More sheet's "Who's on"). A literal link, so the route-reachability guard
 * can read it.
 */
export function RosterWhosOnEntryLink({
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
