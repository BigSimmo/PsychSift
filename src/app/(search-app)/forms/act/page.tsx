import type { Metadata } from "next";

import { loadActReferenceGroups, loadChiefPsychiatristStandards } from "@/components/forms/act-and-standards-content";
import { ActAndStandardsPage } from "@/components/forms/act-and-standards-page";
import { FormsModeNav } from "@/components/forms/forms-mode-nav";
import { consolidatedModeSearchPath } from "@/lib/consolidated-mode-home-redirect";
import { mhaActMetadata } from "@/lib/mha-act-sections";

export const metadata: Metadata = {
  title: "Act and Standards | PsychSift",
  description:
    "Plain-English summaries of the Mental Health Act 2014 (WA) sections and the Chief Psychiatrist's Standards for Clinical Care.",
};

export default function FormsActAndStandardsRoute() {
  return (
    <>
      <FormsModeNav current="forms-act" />
      <ActAndStandardsPage
        act={mhaActMetadata}
        groups={loadActReferenceGroups()}
        standards={loadChiefPsychiatristStandards()}
        backHref={consolidatedModeSearchPath("forms")}
      />
    </>
  );
}
