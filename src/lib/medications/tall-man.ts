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
  olanzapine: "OLANZapine",
  quetiapine: "QUEtiapine",
  aripiprazole: "ARIPiprazole",
  risperidone: "risperiDONE",
  chlorpromazine: "chlorproMAZINE",
  promethazine: "proMETHAZINE",
  fluphenazine: "fluPHENazine",
  flupentixol: "fluPENtixol",
  zuclopenthixol: "zucloPENthixol",

  // Antidepressants & Anxiolytics
  fluoxetine: "FLUoxetine",
  fluvoxamine: "fluvoxaMINE",
  paroxetine: "PARoxetine",
  sertraline: "serTRALine",
  citalopram: "citaloPRAM",
  escitalopram: "escitaloPRAM",
  duloxetine: "DULoxetine",
  venlafaxine: "venlaFAXine",
  bupropion: "buPROPion",
  buspirone: "busPIRone",

  // Benzodiazepines & Sedatives
  clonazepam: "clonazePAM",
  lorazepam: "lorazePAM",
  diazepam: "diazePAM",
  oxazepam: "oxazePAM",
  temazepam: "temazePAM",
  alprazolam: "ALPRAZolam",
  midazolam: "midazolAM",

  // Mood Stabilizers & Anticonvulsants
  carbamazepine: "carBAMazepine",
  valproate: "VALproate",
  lamotrigine: "lamoTRIgine",

  // Vasodilators / Antihistamines
  hydroxyzine: "hydrOXYzine",
  hydralazine: "hydrALAZINE",
});

const hasEntry = (key: string) => Object.prototype.hasOwnProperty.call(ISMP_TALL_MAN_MEDICATIONS, key);

/**
 * Formats a medication name using standard ISMP Tall Man lettering if recognized.
 * A registered generic is matched as a whole word inside a catalogue name, so formulation-qualified
 * names keep their suffix ("Bupropion SR" -> "buPROPion SR", "Olanzapine (wafer/ODT)" ->
 * "OLANZapine (wafer/ODT)"). Whole words only: "escitalopram" never matches "citalopram".
 * Returns the original medication name unmodified if no registered generic is present.
 */
export function formatTallMan(name: string): string {
  if (!name || !isTallManMedication(name)) return name;
  return name.trim().replace(/[A-Za-z]+/g, (word) => {
    const key = word.toLowerCase();
    return hasEntry(key) ? ISMP_TALL_MAN_MEDICATIONS[key] : word;
  });
}

/**
 * Checks whether a given medication (or a formulation-qualified catalogue name containing one) is
 * an ISMP / ACSQHC identified high-alert LASA drug.
 */
export function isTallManMedication(name: string): boolean {
  if (!name) return false;
  return (name.match(/[A-Za-z]+/g) ?? []).some((word) => hasEntry(word.toLowerCase()));
}
