import type { Metadata } from "next";

import { MedicinesHome, type MedicinesSectionCounts } from "@/components/medicines/medicines-home";
import { calculators } from "@/lib/calculators/calculator-fixtures";
import { dictionaryEntries } from "@/lib/dictionary-data";
import { factsheetSlugs } from "@/lib/factsheets-data";
import { loadMedicationSnapshot } from "@/lib/medication-snapshot";
import { toolCatalogRecords } from "@/lib/tools-catalog";

export const metadata: Metadata = {
  title: "Medicines & tools | PsychSift",
  description: "Medication, calculators, clinical tools, factsheets and the dictionary in one place.",
};

/**
 * The Medicines & tools mode home: Psychiatry's twin (modes review, phase 3),
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
    calculators: calculators.length,
    tools: toolCatalogRecords.length,
    factsheets: factsheetSlugs().length,
    dictionary: dictionaryEntries.length,
  };
  return <MedicinesHome counts={counts} />;
}
