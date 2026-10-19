import type { Metadata } from "next";
import { FileText } from "lucide-react";

import { FrontDoorPage } from "@/components/front-door/front-door-page";
import {
  TERMS_PAGE_DESCRIPTION,
  TERMS_PAGE_TITLE,
  TERMS_SECTIONS,
  TERMS_VERSION,
  TERMS_VERSION_DATE,
} from "@/lib/front-door-content";

export const metadata: Metadata = {
  title: TERMS_PAGE_TITLE,
  description: TERMS_PAGE_DESCRIPTION,
};

const versionDate = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
}).format(new Date(`${TERMS_VERSION_DATE}T00:00:00Z`));

/**
 * Terms of Use. DRAFT copy lives in `src/lib/front-door-content.ts`; the
 * acceptance prompt (`TermsAcceptancePrompt`) asks again whenever
 * `TERMS_VERSION` changes.
 */
export default function TermsPage() {
  return (
    <FrontDoorPage
      title={TERMS_PAGE_TITLE}
      description={TERMS_PAGE_DESCRIPTION}
      icon={FileText}
      sections={TERMS_SECTIONS}
      meta={`Version ${TERMS_VERSION}, written ${versionDate}`}
      testId="terms-page"
    />
  );
}
