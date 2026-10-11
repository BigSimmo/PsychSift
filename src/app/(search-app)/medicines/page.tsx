import type { Metadata } from "next";

import { MedicinesHome, type MedicinesSectionCounts } from "@/components/medicines/medicines-home";
import { factsheetSlugs } from "@/lib/factsheets-data";
import { loadMedicationSnapshot } from "@/lib/medication-snapshot";

export const metadata: Metadata = {
  title: "Medicines | PsychSift",
  description: "Medication, factsheets, statewide charts and outside references in one place.",
};

/**
 * The Medicines mode home: Psychiatry's twin (modes review, phase 3),
 * a dashboard of the sections it gathers rather than a redirect stub.
 *
 * Each section keeps its own address and search, and the mode declares no
 * search surface (`resultsSurface: "none"`), so it renders a body here. The
 * section counts are read on the server, so the catalogues never reach the
 * browser just to be counted.
 */
export default function MedicinesHomeRoute() {
  const counts: MedicinesSectionCounts = {
    medications: loadMedicationSnapshot().length,
    factsheets: factsheetSlugs().length,
  };
  return <MedicinesHome counts={counts} />;
}
