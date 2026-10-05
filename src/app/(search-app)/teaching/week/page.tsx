import type { Metadata } from "next";

import { TeachingThisWeek } from "@/components/teaching/teaching-this-week";
import { teachingDemoMode } from "@/lib/teaching/sample";

export const metadata: Metadata = {
  title: "This week | Teaching | PsychSift",
  description: "The teaching session on now with one-tap check in, then every session this week, day by day.",
};

/*
 * Week folded into This week (mock-up v5). The address keeps rendering the same page rather than
 * redirecting, so links from My Day, On Call and work search keep their #on-call-entry anchors on a
 * client-side navigation too. The tab bar marks it as This week.
 */
export default async function TeachingWeekRoute() {
  return <TeachingThisWeek demoMode={await teachingDemoMode()} />;
}
