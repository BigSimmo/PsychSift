import type { ReactNode } from "react";

import { ClinicalCatalogueGate } from "@/components/mode-kit/clinical-catalogue-gate";
import { ClinicalPageSignInNotice } from "@/components/mode-kit/clinical-page-sign-in-notice";
import { clinicalPageSignInRequired } from "@/lib/clinical-page-access";
import { CLINICAL_SIGN_IN_COPY } from "@/lib/front-door-content";

// #3728 / #3738: these pages and their APIs need sign-in from 1 November 2026. The server
// checks first, so a signed-out response carries the sign-in card and no record. Each page
// checks again itself, because a layout does not stop its page from rendering.
export default async function Layout({ children }: { children: ReactNode }) {
  if (await clinicalPageSignInRequired()) {
    return <ClinicalPageSignInNotice copy={CLINICAL_SIGN_IN_COPY.medicines} testId="medications-sign-in" />;
  }
  return (
    <ClinicalCatalogueGate copy={CLINICAL_SIGN_IN_COPY.medicines} testId="medications-sign-in" serverSignedIn>
      {children}
    </ClinicalCatalogueGate>
  );
}
