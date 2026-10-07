import type { Metadata } from "next";

import { AssessmentsExportScreen } from "@/components/work-screens/assessments/assessments-screens";
import { isDemoMode } from "@/lib/env";
import { exampleDataOn } from "@/lib/example-data/server";

export const metadata: Metadata = {
  title: "Export | Assessments | PsychSift",
  description: "Save your supervision records as spreadsheets and printable forms. Example records only.",
  robots: { index: false, follow: false },
};

export default async function Page() {
  return <AssessmentsExportScreen demoMode={isDemoMode() || (await exampleDataOn("assess"))} />;
}
