import type { Metadata } from "next";

import { TeachingTerm } from "@/components/teaching/teaching-term";
import { teachingDemoMode } from "@/lib/teaching/sample";

export const metadata: Metadata = {
  title: "Term | Teaching | PsychSift",
  description: "Your term at a glance: assessments due, EPAs and your supervisor meeting.",
  robots: { index: false, follow: false },
};

/* Demo mode is read on the server; the term itself is kept on this device. */
export default async function TeachingTermRoute() {
  return <TeachingTerm demoMode={await teachingDemoMode()} />;
}
