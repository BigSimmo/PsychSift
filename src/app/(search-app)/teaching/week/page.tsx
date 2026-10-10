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
export default async function TeachingWeekRoute({
  searchParams,
}: {
  searchParams: Promise<{ week?: string | string[] }>;
}) {
  const { week } = await searchParams;
  return <TeachingThisWeek demoMode={await teachingDemoMode()} week={weekParam(week)} />;
}

/** `?week=` from My Day's Calendar: a real calendar date, or nothing. */
function weekParam(week: string | string[] | undefined): string | null {
  if (typeof week !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(week)) return null;
  const date = new Date(`${week}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === week ? week : null;
}
