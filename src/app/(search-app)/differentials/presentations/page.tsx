import type { Metadata } from "next";
import { DifferentialStreamPage } from "@/components/differentials/differential-stream-page";
import { ClinicalPageSignInNotice } from "@/components/mode-kit/clinical-page-sign-in-notice";
import { clinicalPageSignInRequired } from "@/lib/clinical-page-access";
import { CLINICAL_SIGN_IN_COPY } from "@/lib/front-door-content";

export const metadata: Metadata = {
  title: "Presentations | Differentials | PsychSift",
  description: "Browse presentations and the diagnoses to consider for each.",
};

type DifferentialPresentationsRouteProps = {
  searchParams?: Promise<{ query?: string | string[]; q?: string | string[] }>;
};

function firstSearchParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DifferentialPresentationsRoute({ searchParams }: DifferentialPresentationsRouteProps) {
  // #3738: no record content in a signed-out server response.
  if (await clinicalPageSignInRequired()) {
    return <ClinicalPageSignInNotice copy={CLINICAL_SIGN_IN_COPY.differentials} testId="differentials-sign-in" />;
  }
  const params = searchParams ? await searchParams : {};
  const query = firstSearchParam(params.query ?? params.q)?.trim() ?? "";

  return <DifferentialStreamPage stream="presentations" query={query} />;
}
