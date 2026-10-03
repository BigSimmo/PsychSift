import type { Metadata } from "next";

import { MedicationRecordPage } from "@/components/clinical-dashboard/medication-record-page";
import { deriveMedicationSourceGovernance } from "@/lib/medication-records";
import { medicationSourceLinks } from "@/lib/medication-source-links";
import { getMedicationRecord, loadMedicationSnapshot } from "@/lib/medication-snapshot";

type MedicationPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export function generateStaticParams() {
  return loadMedicationSnapshot().map((record) => ({ slug: record.slug }));
}

export async function generateMetadata({ params }: MedicationPageProps): Promise<Metadata> {
  const { slug } = await params;
  const record = getMedicationRecord(slug);
  if (!record) {
    return {
      title: "Medication | PsychSift",
    };
  }

  return {
    title: `${record.name} | PsychSift`,
    description: `${record.name} prescribing summary, dosing, safety checks, monitoring, access, and provenance.`,
  };
}

export default async function MedicationPage({ params }: MedicationPageProps) {
  const { slug } = await params;

  // The public snapshot record is already in hand server-side. Pass it (plus the
  // governance derived exactly as the public API does) so the page paints real
  // clinical content on first load instead of a skeleton, while the client hook
  // refreshes in place for authenticated owner records. Slugs absent from the
  // snapshot (owner-only medications) pass `undefined` and keep the loading path.
  const record = getMedicationRecord(slug);
  const fallbackGovernance = record
    ? (() => {
        const derived = deriveMedicationSourceGovernance(record.sections);
        // Validation/review status is a governance decision that must come from
        // the live/authoritative response, not a hard-coded guess used only for
        // the pre-fetch content-first paint.
        return {
          sourceStatus: derived.sourceStatus,
          sourceCheckedAt: derived.sourceCheckedAt,
          sourcesRecorded: derived.sourcesRecorded,
          validationStatus: "unverified" as const,
        };
      })()
    : undefined;

  // Only owner-confirmed source links reach the page; until a record is signed off this is empty.
  return (
    <MedicationRecordPage
      slug={slug}
      fallbackRecord={record}
      fallbackGovernance={fallbackGovernance}
      sourceLinks={medicationSourceLinks(slug)}
    />
  );
}
