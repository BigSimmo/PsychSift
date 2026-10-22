import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DifferentialDiagnosisPageClient } from "@/components/differentials/differential-diagnosis-page-client";
import { differentialStaticParams, getDifferentialDetailContext } from "@/lib/differentials";
import { readDifferentialPageRecord } from "@/lib/site-content/differential-page-records";
import { ClinicalPageSignInNotice } from "@/components/mode-kit/clinical-page-sign-in-notice";
import { clinicalPageSignInRequired } from "@/lib/clinical-page-access";
import { CLINICAL_SIGN_IN_COPY } from "@/lib/front-door-content";

type DifferentialDiagnosisRouteProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return differentialStaticParams();
}

export async function generateMetadata({ params }: DifferentialDiagnosisRouteProps): Promise<Metadata> {
  // #3738: a signed-out response names no record either.
  if (await clinicalPageSignInRequired()) return { title: "Differential diagnosis - PsychSift" };
  const { slug } = await params;
  const record = await readDifferentialPageRecord(slug);
  if (!record) return { title: "Differential diagnosis not found - PsychSift" };

  return {
    title: `${record.title} - Differential diagnosis - PsychSift`,
    description: record.subtitle,
  };
}

export default async function DifferentialDiagnosisRoute({ params }: DifferentialDiagnosisRouteProps) {
  // #3738: no record content in a signed-out server response.
  if (await clinicalPageSignInRequired()) {
    return <ClinicalPageSignInNotice copy={CLINICAL_SIGN_IN_COPY.differentials} testId="differentials-sign-in" />;
  }
  const { slug } = await params;
  const record = await readDifferentialPageRecord(slug);
  if (!record) notFound();

  return (
    <DifferentialDiagnosisPageClient
      slug={slug}
      fallbackRecord={record}
      detailContext={getDifferentialDetailContext(record)}
    />
  );
}
