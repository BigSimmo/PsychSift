import type { Metadata } from "next";

import { TeachingExamPrep } from "@/components/teaching/teaching-exam-prep";
import { teachingDemoMode } from "@/lib/teaching/sample";

export const metadata: Metadata = {
  title: "Exam prep | Teaching | PsychSift",
  description: "A countdown to your exam, your study days, topic progress and study group.",
  robots: { index: false, follow: false },
};

/* Demo mode is read on the server; exam prep itself is kept on this device. */
export default async function TeachingExamPrepRoute() {
  return <TeachingExamPrep demoMode={await teachingDemoMode()} />;
}
