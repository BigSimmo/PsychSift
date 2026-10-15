/**
 * Mixed-case ("Tall Man") lettering for look-alike, sound-alike (LASA) medicine names, taken from
 * the Australian Commission on Safety and Quality in Health Care, National Mixed-Case Lettering
 * List (April 2024), Tables 1 and 3, limited to medicines this catalogue lists.
 *
 * The Commission warns that overuse reduces the technique's effect, so names that appear only on
 * the US (FDA and ISMP) list are not lettered here. One local exception is kept: cloZAPine, because
 * a clozapine selection error is high harm and the name is widely lettered in Australian practice.
 */
export const ACSQHC_MIXED_CASE_MEDICATIONS: Readonly<Record<string, string>> = Object.freeze({
  // Antipsychotics
  aripiprazole: "ARIPiprazole",
  chlorpromazine: "cHLORPROMAZine",
  quetiapine: "QUETIAPine",
  risperidone: "riSPERIDONe",
  clozapine: "cloZAPine", // local exception, not on the ACSQHC list

  // Antidepressants
  amitriptyline: "amiTRIPTYLine",
  clomipramine: "cLOMIPRAMine",
  dosulepin: "doSULepin",
  doxepin: "doXepin",
  duloxetine: "DULoxetine",
  fluvoxamine: "fluVOXAMine",
  paroxetine: "PARoxetine",
  sertraline: "SERTRALine",

  // Benzodiazepines
  clobazam: "cloBAZam",
  clonazepam: "CLONazepam",
  diazepam: "DIAzepam",
  lorazepam: "LORazepam",
  oxazepam: "OXazepam",

  // Mood stabilisers and anticonvulsants
  carbamazepine: "CARBAMazepine",
  oxcarbazepine: "OXCARBazepine",
  lamotrigine: "lamOTRIGine",

  // Other
  methadone: "methADONe",
  methylphenidate: "methYLPHENIDATE",
  promethazine: "proMETHazine",
  prochlorperazine: "proCHLORPERazine",
  hydralazine: "hydrALAZINE",
});

/**
 * Formats a medicine name with its mixed-case lettering when it is on the list.
 * Returns the name unchanged when it is not.
 */
export function formatTallMan(name: string): string {
  if (!name) return name;
  const key = name.toLowerCase().trim();
  return Object.prototype.hasOwnProperty.call(ACSQHC_MIXED_CASE_MEDICATIONS, key)
    ? ACSQHC_MIXED_CASE_MEDICATIONS[key]
    : name;
}

/**
 * Checks whether a medicine name has mixed-case lettering on the list.
 */
export function isTallManMedication(name: string): boolean {
  if (!name) return false;
  const key = name.toLowerCase().trim();
  return Object.prototype.hasOwnProperty.call(ACSQHC_MIXED_CASE_MEDICATIONS, key);
}
