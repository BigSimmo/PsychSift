import type { Metadata } from "next";

import { AssessmentsExportScreen } from "@/components/work-screens/assessments/assessments-screens";
import { teachingDemoMode } from "@/lib/teaching/sample";

export const metadata: Metadata = {
  title: "Export | Assessments | PsychSift",
  description: "Save your supervision records as spreadsheets and printable forms. Made-up example records.",
  robots: { index: false, follow: false },
};

export default async function Page() {
  return <AssessmentsExportScreen demoMode={await teachingDemoMode()} />;
}
