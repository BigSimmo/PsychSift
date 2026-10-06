import type { Metadata } from "next";

import { TeachingAssessments } from "@/components/teaching/assessments/teaching-assessments";
import { teachingDemoMode } from "@/lib/teaching/sample";

export const metadata: Metadata = {
  title: "Assessments | Teaching | PsychSift",
  robots: { index: false, follow: false },
};

export default async function Page() {
  return <TeachingAssessments demoMode={await teachingDemoMode()} />;
}
