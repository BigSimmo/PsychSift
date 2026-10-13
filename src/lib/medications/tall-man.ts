/**
 * ISMP & ACSQHC (Australian Commission on Safety and Quality in Health Care)
 * Standard Tall Man Lettering Registry for High-Risk Psychotropics and Confusable Pairs.
 *
 * Look-Alike / Sound-Alike (LASA) drug errors can lead to fatal inadvertent administrations
 * (e.g. cloZAPine vs cloNIDine, hydrOXYzine vs hydrALAZINE).
 */
export const ISMP_TALL_MAN_MEDICATIONS: Readonly<Record<string, string>> = Object.freeze({
  // Antipsychotics & Confusable Pairs
  clozapine: "cloZAPine",
  clonidine: "cloNIDine",
  olanzapine: "olanzaPINE",
  quetiapine: "queTIApine",
  aripiprazole: "aripipRAZOLE",
  risperidone: "risperiDONE",
  chlorpromazine: "chlorproMAZINE",
  promethazine: "proMETHAZINE",
  fluphenazine: "FLUphenazine",
  flupentixol: "fluPENtixol",
  zuclopenthixol: "zucloPENthixol",

  // Antidepressants & Anxiolytics
  fluoxetine: "fluOXEtine",
  fluvoxamine: "fluvOXAMine",
  paroxetine: "parOXEtine",
  sertraline: "serTRALine",
  citalopram: "citaloPRAM",
  escitalopram: "escitaloPRAM",
  duloxetine: "dulOXEtine",
  venlafaxine: "venlaFAXine",
  bupropion: "buPROPion",
  buspirone: "busPIRone",

  // Benzodiazepines & Sedatives
  clonazepam: "clonazePAM",
  lorazepam: "lorazePAM",
  diazepam: "diazePAM",
  oxazepam: "oxazePAM",
  temazepam: "temazePAM",
  alprazolam: "alPRAZolam",
  midazolam: "midazolAM",

  // Mood Stabilizers & Anticonvulsants
  carbamazepine: "carbaMAZEpine",
  valproate: "VALproate",
  lamotrigine: "lamoTRIgine",

  // Vasodilators / Antihistamines
  hydroxyzine: "hydrOXYzine",
  hydralazine: "hydrALAZINE",
});

/**
 * Formats a medication name using standard ISMP Tall Man lettering if recognized.
 * Returns the original medication name unmodified if not present in the LASA registry.
 */
export function formatTallMan(name: string): string {
  if (!name) return name;
  const key = name.toLowerCase().trim();
  return ISMP_TALL_MAN_MEDICATIONS[key] ?? name;
}

/**
 * Checks whether a given medication is an ISMP / ACSQHC identified high-alert LASA drug.
 */
export function isTallManMedication(name: string): boolean {
  if (!name) return false;
  const key = name.toLowerCase().trim();
  return key in ISMP_TALL_MAN_MEDICATIONS;
}
