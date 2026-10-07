import type { Metadata } from "next";

import { TeachingLogbook } from "@/components/teaching/teaching-logbook";
import { teachingDemoMode } from "@/lib/teaching/sample";

export const metadata: Metadata = {
  title: "Logbook | Teaching | PsychSift",
  description: "Your teaching check-ins, feedback you owe, sessions not yet in CPD and counts for your supervisor.",
};

/* Demo mode is read on the server. */
export default async function TeachingLogbookRoute() {
  return <TeachingLogbook demoMode={await teachingDemoMode()} />;
}
