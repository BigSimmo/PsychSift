import { notFound } from "next/navigation";

import {
  SYNTHETIC_PRESENTATION_PARAMS,
  isSyntheticPatientId,
  isSyntheticPresentationId,
} from "@/components/care-plan/mockups/routes";

import { CarePlanRoutePage } from "../../../../route-page";

export function generateStaticParams() {
  return [...SYNTHETIC_PRESENTATION_PARAMS];
}

/**
 * An episode belongs to exactly one patient, and this page cannot check that.
 *
 * It is a server component with no view of the session's memory, and an episode
 * recorded during the session is a real address the fixture-derived pairing has
 * never heard of — so refusing anything outside that pairing would send a
 * clinician who has just recorded an ED Presentation to a 404 for the record
 * they created. The page refuses what is not an address at all; the surface,
 * which holds the state, decides whether the episode belongs to this patient and
 * shows identity uncertainty rather than a nearby person's episode.
 */
export default async function CarePlanPresentationPage({
  params,
}: {
  params: Promise<{ patientId: string; presentationId: string }>;
}) {
  const { patientId, presentationId } = await params;
  if (!isSyntheticPatientId(patientId) || !isSyntheticPresentationId(presentationId)) notFound();
  return <CarePlanRoutePage />;
}
