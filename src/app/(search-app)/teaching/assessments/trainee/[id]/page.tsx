import type { Metadata } from "next";

import { AssessmentsTraineeScreen } from "@/components/work-screens/assessments/assessments-screens";
import { isDemoMode } from "@/lib/env";
import { exampleDataOn } from "@/lib/example-data/server";

export const metadata: Metadata = {
  title: "Doctor | Assessments | PsychSift",
  description: "Review a doctor's requests, confirm supervision and ask for a correction. Example records only.",
  robots: { index: false, follow: false },
};

/** A malformed link shows the page's own unknown-doctor state instead of an error. */
function safeDecode(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AssessmentsTraineeScreen demoMode={isDemoMode() || (await exampleDataOn("assess"))} doctorId={safeDecode(id)} />
  );
}
