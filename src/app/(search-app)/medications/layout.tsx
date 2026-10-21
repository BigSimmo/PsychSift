import type { ReactNode } from "react";

import { ClinicalCatalogueGate } from "@/components/mode-kit/clinical-catalogue-gate";
import { CLINICAL_SIGN_IN_COPY } from "@/lib/front-door-content";

// #3728: these pages and their APIs need sign-in from 1 November 2026.
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <ClinicalCatalogueGate copy={CLINICAL_SIGN_IN_COPY.medicines} testId="medications-sign-in">
      {children}
    </ClinicalCatalogueGate>
  );
}
