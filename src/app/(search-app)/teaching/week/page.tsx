import type { Metadata } from "next";

import { TeachingThisWeek } from "@/components/teaching/teaching-this-week";
import { teachingDemoMode } from "@/lib/teaching/sample";

export const metadata: Metadata = {
  title: "Week | Teaching | PsychSift",
  description: "Every teaching session this week, day by day, with roster clashes and your On Call teaching list.",
};

/*
 * Week (work-mode redesign, owner request 6 Oct 2026): the week's sessions day by day. Links from My
 * Day, On Call and work search land here with their #on-call-entry anchors.
 */
export default async function TeachingWeekRoute() {
  return <TeachingThisWeek demoMode={await teachingDemoMode()} />;
}
