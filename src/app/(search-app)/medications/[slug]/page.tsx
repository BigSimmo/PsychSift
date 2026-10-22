import type { Metadata } from "next";

import { MedicationRecordPage } from "@/components/clinical-dashboard/medication-record-page";
import type { ContentReviewScheduleInput } from "@/lib/content-review-schedule";
import { deriveMedicationSourceGovernance } from "@/lib/medication-records";
import { medicationSourceLinkIds, medicationSourceLinks } from "@/lib/medication-source-links";
import { getMedicationRecord, loadMedicationSnapshot } from "@/lib/medication-snapshot";
import { ClinicalPageSignInNotice } from "@/components/mode-kit/clinical-page-sign-in-notice";
import { clinicalPageSignInRequired } from "@/lib/clinical-page-access";
import { CLINICAL_SIGN_IN_COPY } from "@/lib/front-door-content";

type MedicationPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export function generateStaticParams() {
  return loadMedicationSnapshot().map((record) => ({ slug: record.slug }));
}

export async function generateMetadata({ params }: MedicationPageProps): Promise<Metadata> {
  // #3738: a signed-out response names no record either.
  if (await clinicalPageSignInRequired()) return { title: "Medication | PsychSift" };
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
  // #3738: no record content in a signed-out server response.
  if (await clinicalPageSignInRequired()) {
    return <ClinicalPageSignInNotice copy={CLINICAL_SIGN_IN_COPY.medicines} testId="medications-sign-in" />;
  }
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

  // The 12-month review date counts from the record's own source-check date, and a
  // confirmed change to any source the record cites (signed off or only proposed) makes
  // it due now. The page is prerendered, so only the inputs are passed: the notice works
  // the schedule out in the browser on the day it is read. Owner-only slugs have no
  // snapshot record, so their schedule waits for the live record's own date.
  const citedSourceIds = Object.hasOwn(medicationSourceLinkIds, slug) ? medicationSourceLinkIds[slug] : [];
  const reviewInput: ContentReviewScheduleInput | undefined = fallbackGovernance
    ? { kind: "medication", lastReviewedAt: fallbackGovernance.sourceCheckedAt, citedSourceIds }
    : undefined;

  // Only owner-confirmed source links reach the page; until a record is signed off this is empty.
  return (
    <MedicationRecordPage
      slug={slug}
      fallbackRecord={record}
      fallbackGovernance={fallbackGovernance}
      sourceLinks={medicationSourceLinks(slug)}
      reviewInput={reviewInput}
      citedSourceIds={citedSourceIds}
    />
  );
}
