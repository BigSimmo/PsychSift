import { notFound } from "next/navigation";

import { SYNTHETIC_PATIENT_PARAMS, isSyntheticPatientId } from "@/components/care-plan/mockups/routes";

import { CarePlanRoutePage } from "../../../../route-page";

export function generateStaticParams() {
  return [...SYNTHETIC_PATIENT_PARAMS];
}

export default async function CarePlanPatientPlanPrintPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  if (!isSyntheticPatientId(patientId)) notFound();
  return <CarePlanRoutePage />;
}
