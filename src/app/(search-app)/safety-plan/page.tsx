import type { Metadata } from "next";

import { PatientSafetyPlan } from "@/components/patient-safety-plan";

export const metadata: Metadata = {
  title: "Safety plan generator - PsychSift",
  description:
    "Build an identifier-free patient safety plan with the Stanley-Brown six steps in a transient browser session, then export it through an approved clinical workflow.",
};

export default function SafetyPlanPage() {
  return <PatientSafetyPlan />;
}
