import type { Metadata } from "next";

import { PsychiatryHome, type PsychiatrySectionCounts } from "@/components/psychiatry/psychiatry-home";
import { differentialStaticParams, presentationStaticParams } from "@/lib/differentials";
import { dsmStaticParams } from "@/lib/dsm";
import { formRecords } from "@/lib/forms";
import { formulationMechanisms } from "@/lib/formulation";
import { specifierRecords } from "@/lib/specifiers";
import { therapySlugs } from "@/lib/therapies";

export const metadata: Metadata = {
  title: "Psychiatry | PsychSift",
  description: "Diagnosis, specifiers, formulation, therapy and Mental Health Act forms in one place.",
};

/**
 * The Psychiatry mode home: a dashboard of the sections it gathers, not a
 * redirect stub.
 *
 * Psychiatry gathers existing modes rather than owning content, and each of
 * those keeps its own address and search. Like On Call and CME it declares no
 * search surface (`resultsSurface: "none"`), so it renders a body here instead
 * of forwarding to the shared search home.
 *
 * The section counts are read here, on the server, so the catalogues never
 * reach the browser just to be counted.
 */
export default function PsychiatryHomeRoute() {
  const counts: PsychiatrySectionCounts = {
    dsm: dsmStaticParams().length,
    differentials: differentialStaticParams().length,
    presentations: presentationStaticParams().length,
    specifiers: specifierRecords.length,
    formulation: formulationMechanisms.length,
    therapy: therapySlugs().length,
    forms: formRecords.length,
  };
  return <PsychiatryHome counts={counts} />;
}
