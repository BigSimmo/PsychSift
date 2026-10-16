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
  rabeprazole: "rabePRAZOLE",
  risperidone: "risperiDONE",
  ropinirole: "ropiniROLE",
  chlorpromazine: "chlorproMAZINE",
  chlorpropamide: "chlorproPAMIDE",
  clomipramine: "clomiPRAMINE",
  promethazine: "proMETHAZINE",
  fluphenazine: "fluPHENazine",
  flupentixol: "FLUpentixol",
  flupenthixol: "FLUpenthixol",
  zuclopenthixol: "ZUCLOpenthixol",

  // Antidepressants & Anxiolytics
  fluoxetine: "FLUoxetine",
  fluvoxamine: "fluvoxaMINE",
  paroxetine: "PARoxetine",
  sertraline: "serTRALine",
  citalopram: "CITalopram",
  escitalopram: "ESCitalopram",
  duloxetine: "DULoxetine",
  venlafaxine: "venlaFAXine",
  bupropion: "buPROPion",
  buspirone: "busPIRone",

  // Benzodiazepines & Sedatives (aligned on differentiating prefixes per ACSQHC)
  clonazepam: "CLONazepam",
  lorazepam: "LORazepam",
  diazepam: "DIAZepam",
  oxazepam: "OXazepam",
  temazepam: "TEMazepam",
  alprazolam: "ALPRAZolam",
  midazolam: "MIDazolam",

  // Mood Stabilizers & Anticonvulsants
  carbamazepine: "carBAMazepine",
  lamotrigine: "lamoTRIgine",

  // Vasodilators / Antihistamines
  hydroxyzine: "hydrOXYzine",
  hydralazine: "hydrALAZINE",
});

/**
 * Formats a medication name using standard ISMP / ACSQHC Tall Man lettering if recognized.
 * Supports both exact generic names and compound strings (e.g. "Flupentixol decanoate", "Clozapine (Clopine)")
 * via word-boundary token matching.
 */
export function formatTallMan(name: string): string {
  if (!name) return name;
  const key = name.toLowerCase().trim();
  if (Object.prototype.hasOwnProperty.call(ISMP_TALL_MAN_MEDICATIONS, key)) {
    return ISMP_TALL_MAN_MEDICATIONS[key]!;
  }
  return name.replace(/\b([A-Za-z]+)\b/g, (token) => {
    const lower = token.toLowerCase();
    return Object.prototype.hasOwnProperty.call(ISMP_TALL_MAN_MEDICATIONS, lower)
      ? ISMP_TALL_MAN_MEDICATIONS[lower]!
      : token;
  });
}

/**
 * Checks whether a given medication (or compound medication string) contains an
 * ISMP / ACSQHC identified high-alert LASA drug.
 */
export function isTallManMedication(name: string): boolean {
  if (!name) return false;
  const key = name.toLowerCase().trim();
  if (Object.prototype.hasOwnProperty.call(ISMP_TALL_MAN_MEDICATIONS, key)) {
    return true;
  }
  const tokens = name.match(/\b([A-Za-z]+)\b/g);
  if (!tokens) return false;
  return tokens.some((token) =>
    Object.prototype.hasOwnProperty.call(ISMP_TALL_MAN_MEDICATIONS, token.toLowerCase()),
  );
}
