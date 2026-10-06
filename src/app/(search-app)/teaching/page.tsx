import type { Metadata } from "next";

import { TeachingThisWeek } from "@/components/teaching/teaching-this-week";
import { teachingDemoMode } from "@/lib/teaching/sample";

export const metadata: Metadata = {
  title: "This week | Teaching | PsychSift",
  description: "The teaching session on now with one-tap check in, then every session this week, day by day.",
};

/* Like My Work and CPD it declares no search surface, so it renders its own body. Demo mode is read on the server. */
export default async function TeachingThisWeekRoute() {
  return <TeachingThisWeek demoMode={await teachingDemoMode()} />;
}
