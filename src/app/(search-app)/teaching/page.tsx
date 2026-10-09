import type { Metadata } from "next";

import { TeachingToday } from "@/components/teaching/teaching-today";
import { teachingDemoMode } from "@/lib/teaching/sample";

export const metadata: Metadata = {
  title: "Today | Teaching | PsychSift",
  description: "The teaching session that matters now, with check in and Log to CPD, then what needs you.",
};

/*
 * Today (work-mode redesign, owner request 6 Oct 2026): the hero by phase, Next for you, Needs you,
 * the rest of the week and attendance. The week itself is the Week tab (/teaching/week). Like My
 * Work and CPD it declares no search surface, so it renders its own body. Demo mode is read on the
 * server.
 */
export default async function TeachingTodayRoute() {
  return <TeachingToday demoMode={await teachingDemoMode()} />;
}
