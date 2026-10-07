"use client";

import { Sparkles } from "lucide-react";

import { WorkCard, WorkIconRow } from "@/components/mode-kit/work";

/**
 * The way into "Your first week", for the On Call More sheet ("Starting out")
 * and the Handbook tab's "Your job orientation" group. A literal link, so the
 * route-reachability guard can read it.
 */
export function FirstWeekEntryLink({
  sub = "Who is who, what we expect, escalation and logins",
}: {
  readonly sub?: string;
}) {
  return (
    <WorkCard>
      <WorkIconRow
        icon={Sparkles}
        title="Your first week"
        sub={sub}
        href="/on-call/first-week"
        testId="on-call-first-week-entry"
      />
    </WorkCard>
  );
}
