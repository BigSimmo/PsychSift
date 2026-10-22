import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { appModeSelectionHref } from "@/lib/app-modes";
import { unsubmittedModeSearchTargetForSearchParams } from "@/lib/consolidated-mode-home-redirect";
import { DifferentialsHomePage } from "@/components/differentials/differentials-home-page";
import { ClinicalPageSignInNotice } from "@/components/mode-kit/clinical-page-sign-in-notice";
import { clinicalPageSignInRequired } from "@/lib/clinical-page-access";
import { CLINICAL_SIGN_IN_COPY } from "@/lib/front-door-content";

export const metadata: Metadata = {
  title: "Search differential diagnoses | PsychSift",
  description: "Compare differential causes and clinical clues against the indexed library.",
};

type RouteProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Submitted differential searches.
 *
 * Split out of the bare `/differentials` path when that became a redirect onto the shared
 * home: results need a route of their own, or `appModeHomeHref` would send a
 * submitted query back through the redirect and loop. An empty query has no
 * browse view of its own — diagnoses and presentations are separate tabs — so
 * it forwards to the shared home. `/calculators/search` is a browse catalogue
 * on an empty query and no longer shares this redirect.
 * The proxy issues the 307; this page-level redirect is the backstop and uses
 * the same target builder so navigation context is not dropped.
 */
export default async function DifferentialsSearchRoute(props: RouteProps) {
  // #3738: no record content in a signed-out server response.
  if (await clinicalPageSignInRequired()) {
    return <ClinicalPageSignInNotice copy={CLINICAL_SIGN_IN_COPY.differentials} testId="differentials-sign-in" />;
  }
  const params = props.searchParams ? await props.searchParams : {};
  const query = firstValue(params.q)?.trim() || firstValue(params.query)?.trim() || "";
  if (!query) {
    redirect(
      unsubmittedModeSearchTargetForSearchParams("/differentials/search", params) ??
        appModeSelectionHref("differentials"),
    );
  }

  return <DifferentialsHomePage query={query} autoRunSearch />;
}
