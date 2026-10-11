"use client";

import { usePathname } from "next/navigation";

import { WorkChip, WorkChips } from "@/components/mode-kit/work";

/**
 * "Starting here": the three pages a doctor new to a hospital needs, as one place
 * (usefulness audit, 11 Oct 2026). They were three entries in two menu groups; now
 * one More entry opens them and this row moves between them. Each page keeps its
 * own content and ticks; only the way between them is shared.
 */
export function OnCallStartingHereChips() {
  const pathname = usePathname() ?? "";
  return (
    <WorkChips label="Starting here">
      {/* Literal hrefs, so the route-reachability scan sees each one. */}
      <WorkChip
        href="/on-call/first-week"
        current={pathname.startsWith("/on-call/first-week")}
        testId="on-call-starting-here-first-week"
      >
        Before you start
      </WorkChip>
      <WorkChip
        href="/on-call/first-night"
        current={pathname.startsWith("/on-call/first-night")}
        testId="on-call-starting-here-first-night"
      >
        First night
      </WorkChip>
      <WorkChip
        href="/on-call/orientation"
        current={pathname.startsWith("/on-call/orientation")}
        testId="on-call-starting-here-orientation"
      >
        Hospital pack
      </WorkChip>
    </WorkChips>
  );
}
