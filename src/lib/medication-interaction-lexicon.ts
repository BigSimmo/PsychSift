// Curated counterparty lexicon for the drug-interaction index.

import type { MedicationRecord } from "@/lib/medications";

export type LexiconTermKind = "catalogue" | "external" | "nonDrug" | "mechanism";

export type CatalogueSelector = {
  slugs?: string[];
  classes?: string[];
  /**
   * Substring match against `record.subclass`. Correct for a family name that
   * legitimately appears inside longer subclasses ("NSAID" inside "NSAID
   * (COX-2 preferential)"), and WRONG for a short acronym that can hide inside
   * an unrelated word — "ARB" sits inside "C-arb-apenem", which put two
   * carbapenem antibiotics in the ARB class across 16 CRITICAL/HIGH rows until
   * the review report surfaced it. Use `subclassEquals` for short acronyms.
   */
  subclassIncludes?: string[];
  /** Exact (case-insensitive) match against `record.subclass`. */
  subclassEquals?: string[];
  denySlugs?: string[];
};

export type LexiconTerm = {
  id: string;
  surfaces: string[];
  kind: LexiconTermKind;
  select?: CatalogueSelector;
  /** Source records that can mention this term without declaring a matching counterparty. */
  sourceDenySlugs?: string[];
  /** Clinical rationales for why source records are excluded from declaring this term as a counterparty. */
  sourceDenyRationales?: Record<string, string>;
  note?: string;
};

const CATALOGUE_TERMS: LexiconTerm[] = [
  {
    id: "benzodiazepines",
    surfaces: ["benzodiazepines", "benzodiazepine", "benzos", "benzo"],
    kind: "catalogue",
    select: { classes: ["Benzodiazepine"], denySlugs: ["clozapine", "olanzapine-wafer-odt"] },
  },
  {
    id: "opioids",
    surfaces: ["opioids", "opioid", "opioid analgesia", "opiates", "full agonists"],
    kind: "catalogue",
    // `loperamide` is denied for the same reason as the antagonists: the subclass
    // match is a substring one, and the catalogue classifies it "Peripheral Opioid
    // Agonist" — P-gp keeps it out of the CNS at therapeutic doses, so it does not
    // add to the sedation and respiratory-depression rows this term drives (35 of
    // its 36 rows are CRITICAL or HIGH). Its real risk, QTc prolongation in
    // overdose or with P-gp inhibitors, is carried by the catalogue's own per-drug
    // QTc data and the `qtc-prolonging` mechanism term, not by this one.
    select: { subclassIncludes: ["Opioid"], denySlugs: ["naltrexone", "naloxone", "loperamide"] },
    // Loperamide's own P-gp row describes possible opioid sedation, but does
    // not declare every opioid as a counterparty.
    sourceDenySlugs: ["loperamide"],
    sourceDenyRationales: {
      loperamide:
        "Peripheral opioid agonist with CNS restriction via P-gp; does not declare broad drug-drug interaction against all opioids.",
    },
  },
  { id: "ssris", surfaces: ["ssris", "ssri"], kind: "catalogue", select: { subclassIncludes: ["SSRI"] } },
  { id: "snris", surfaces: ["snris", "snri"], kind: "catalogue", select: { subclassIncludes: ["SNRI"] } },
  {
    id: "maois",
    surfaces: ["maois", "maoi", "monoamine oxidase inhibitors", "rima", "rimas", "moclobemide"],
    kind: "catalogue",
    select: { subclassIncludes: ["MAOI", "RIMA"] },
  },
  {
    id: "tcas",
    surfaces: ["tcas", "tca", "tricyclics", "tricyclic antidepressants", "anticholinergic tcas"],
    kind: "catalogue",
    // `dosulepin`, not `dothiepin`: same drug, and the catalogue keys it on the
    // current INN. The old spelling matched no record, so a TCA the catalogue
    // marks FATAL in overdose fired none of this term's 20 CRITICAL/HIGH rows.
    // tests/medication-interaction-lexicon-coverage.test.ts now fails on any slug
    // that resolves to nothing, so a dead selector cannot ship again.
    select: { slugs: ["amitriptyline", "nortriptyline", "imipramine", "clomipramine", "doxepin", "dosulepin"] },
  },
  {
    id: "antipsychotics",
    surfaces: ["antipsychotics", "antipsychotic"],
    kind: "catalogue",
    select: { classes: ["Antipsychotic", "LAI Antipsychotic"] },
  },
  {
    id: "nsaids",
    surfaces: ["nsaids", "nsaid"],
    kind: "catalogue",
    select: { subclassIncludes: ["NSAID", "COX-2"], denySlugs: ["aspirin"] },
  },
  {
    id: "beta-blockers",
    surfaces: ["beta-blockers", "beta blockers", "beta-blocker", "beta blocker", "non-selective beta-blockers"],
    kind: "catalogue",
    select: { subclassIncludes: ["Beta Blocker", "Beta-Blocker"] },
  },
  {
    id: "acei",
    surfaces: ["acei", "aceis", "ace inhibitors", "ace inhibitor"],
    kind: "catalogue",
    select: { subclassIncludes: ["ACE Inhibitor"] },
  },
  // Exact, not substring: "ARB" is a substring of "Carbapenem", which put
  // ertapenem and meropenem in the ARB class across 16 CRITICAL/HIGH rows.
  { id: "arbs", surfaces: ["arbs", "arb"], kind: "catalogue", select: { subclassEquals: ["ARB"] } },
  {
    id: "diuretics",
    surfaces: ["diuretics", "diuretic"],
    kind: "catalogue",
    select: { subclassIncludes: ["Diuretic"] },
  },
  {
    id: "thiazide-diuretics",
    surfaces: ["thiazide diuretics", "thiazides", "thiazide"],
    kind: "catalogue",
    select: { subclassIncludes: ["Thiazide"] },
  },
  {
    id: "loop-diuretics",
    surfaces: ["loop diuretics", "loop diuretic"],
    kind: "catalogue",
    select: { subclassIncludes: ["Loop Diuretic"] },
  },
  {
    id: "antihypertensives",
    surfaces: ["antihypertensives", "antihypertensive"],
    kind: "catalogue",
    select: { classes: ["Antihypertensive"] },
  },
  {
    id: "anticoagulants",
    surfaces: ["anticoagulants", "anticoagulant", "doacs", "doac"],
    kind: "catalogue",
    select: { classes: ["Anticoagulant"], denySlugs: ["aspirin"] },
  },
  {
    id: "antiplatelets",
    surfaces: ["antiplatelets", "antiplatelet"],
    kind: "catalogue",
    select: { subclassIncludes: ["Antiplatelet"] },
  },
  {
    id: "macrolides",
    surfaces: ["macrolides", "macrolide"],
    kind: "catalogue",
    select: { subclassIncludes: ["Macrolide"] },
  },
  {
    id: "fluoroquinolones",
    surfaces: ["fluoroquinolones", "fluoroquinolone", "quinolones"],
    kind: "catalogue",
    select: { subclassIncludes: ["Fluoroquinolone"] },
  },
  {
    id: "aminoglycosides",
    surfaces: ["aminoglycosides", "aminoglycoside"],
    kind: "catalogue",
    select: { subclassIncludes: ["Aminoglycoside"] },
  },
  {
    id: "ppis",
    surfaces: ["ppis", "ppi", "proton pump inhibitors"],
    kind: "catalogue",
    select: { subclassIncludes: ["Proton Pump"] },
  },
  {
    id: "antacids",
    surfaces: ["antacids", "antacid"],
    kind: "catalogue",
    select: { slugs: ["magnesium-oxide", "calcium-carbonate"] },
  },
  {
    id: "statins",
    surfaces: ["statins", "statin"],
    kind: "catalogue",
    select: { subclassIncludes: ["Statin", "HMG"] },
    // Simvastatin's and atorvastatin's own gemfibrozil rows ("blocks statin
    // glucuronidation/uptake") use "statin" to describe their OWN drug class's
    // mechanism, not to name a second interacting drug family — resolving it
    // added every other statin as a false counterparty for a HIGH,
    // gemfibrozil-specific alert they have nothing to do with.
    sourceDenySlugs: ["simvastatin", "atorvastatin"],
    sourceDenyRationales: {
      simvastatin:
        "Own-class mechanism notes ('blocks statin glucuronidation/uptake') rather than cross-drug interactions with other statins.",
      atorvastatin:
        "Own-class mechanism notes ('blocks statin glucuronidation/uptake') rather than cross-drug interactions with other statins.",
    },
  },
  {
    id: "gabapentinoids",
    surfaces: ["gabapentinoids", "gabapentinoid"],
    kind: "catalogue",
    select: { slugs: ["gabapentin", "pregabalin"] },
  },
  {
    id: "anticholinergics",
    surfaces: ["anticholinergics", "anticholinergic", "atropine-like medicines"],
    kind: "catalogue",
    select: { subclassIncludes: ["Anticholinergic"] },
  },
  {
    // Every row this term fires on is about additive ANTICHOLINERGIC burden, not
    // about histamine blockade — one says so in its own words: "if given with
    // TCAs, sedating antihistamines, or antipsychotics". The second-generation
    // agents are denied because they carry essentially no anticholinergic
    // activity, and the catalogue labels them as such ("H1 Antihistamine (2nd
    // Gen)"). Before this, benzatropine + loratadine produced a CRITICAL
    // "anticholinergic toxidrome ... risk of toxic megacolon" alert and
    // oxybutynin + cetirizine produced "frank delirium and bowel impaction".
    //
    // Cyclizine, promethazine, alimemazine and diphenhydramine stay: all four
    // are genuinely anticholinergic and are what the rows mean.
    // Clinical review 2026-08-22 (ledger #1YPV51).
    id: "antihistamines",
    surfaces: ["antihistamines", "antihistamine"],
    kind: "catalogue",
    select: { subclassIncludes: ["Antihistamine"], denySlugs: ["cetirizine", "fexofenadine", "loratadine"] },
  },
  {
    // Every row is a SYSTEMIC effect: five are insulin resistance and raised
    // BSL, one is tendon rupture with ciprofloxacin, one is additive
    // hypokalaemia. A steroid cream does not massively increase insulin
    // requirements, so the four purely topical agents are denied — the
    // catalogue marks them "Topical Glucocorticoid".
    //
    // Inhaled agents are deliberately KEPT. The hypokalaemia row is about a
    // formoterol inhaler and names "high-dose corticosteroids", and high-dose
    // inhaled steroids do carry systemic effects. Beclometasone and mometasone
    // are catalogued "Topical/Inhaled" and are kept on the same reasoning.
    // Fludrocortisone is a mineralocorticoid and is kept: it raises BSL and
    // drives hypokalaemia, which is exactly what these rows describe.
    // Clinical review 2026-08-22 (ledger #1YPV51).
    id: "corticosteroids",
    surfaces: ["corticosteroids", "corticosteroid", "steroids", "steroid"],
    kind: "catalogue",
    select: {
      classes: ["Steroid"],
      denySlugs: ["betamethasone", "clobetasol", "hydrocortisone-1", "triamcinolone"],
    },
  },
  {
    // Not a class — a name alias, and the most consequential one in the file.
    //
    // The catalogue record is "Lithium carbonate (IR/SR)", but every row that
    // names lithium as a counterparty just says "Lithium". Drug-name matching
    // derives its surfaces from the record name, and `stripDosageForm` only
    // removes bare trailing tokens, so a parenthesised "(IR/SR)" survives and
    // the generated surfaces are "Lithium carbonate (IR/SR)" and friends —
    // never "Lithium". The result was that lithium was named in eight HIGH
    // rows and reachable from none of them: NSAIDs (diclofenac, meloxicam,
    // naproxen), diuretics (frusemide, hydrochlorothiazide, indapamide),
    // psyllium and iodine. In a psychiatry catalogue that is close to the worst
    // possible drug to be silent about.
    //
    // Fixed here rather than by loosening `stripDosageForm`, because the
    // generic first-word fallback that would catch this also matches "Sodium"
    // in a row about sodium content, "Vitamin" against Vitamin K in the
    // warfarin rows, and "Potassium" against hyperkalaemia prose. A name alias
    // is precise, and unlike a matcher change it shows up in the review sheet
    // for a clinician to confirm.
    id: "lithium",
    surfaces: ["lithium", "lithium carbonate"],
    kind: "catalogue",
    select: { slugs: ["lithium-carbonate-ir-sr"] },
  },
  {
    id: "valproate",
    surfaces: ["valproate", "sodium valproate", "valproic acid", "epilim"],
    kind: "catalogue",
    select: { slugs: ["sodium-valproate-oral-iv"] },
  },
  {
    id: "nitrates",
    surfaces: ["nitrates", "nitrate"],
    kind: "catalogue",
    select: { slugs: ["glyceryl-trinitrate-gtn"] },
  },
  {
    id: "calcium-channel-blockers",
    surfaces: [
      "calcium channel blockers",
      "calcium channel blocker",
      "ccbs",
      "ccb",
      "non-dhp ccbs",
      "dhp calcium channel blockers",
    ],
    kind: "catalogue",
    select: { subclassIncludes: ["Calcium Channel Blocker", "CCB"] },
  },
  {
    id: "cephalosporins",
    surfaces: ["cephalosporins", "cephalosporin"],
    kind: "catalogue",
    select: { subclassIncludes: ["Cephalosporin"] },
  },
  {
    id: "penicillins",
    surfaces: ["penicillins", "penicillin"],
    kind: "catalogue",
    select: {
      slugs: [
        "amoxicillin",
        "amoxicillin-clavulanate",
        "benzathine-benzylpenicillin",
        "dicloxacillin",
        "flucloxacillin",
        "phenoxymethylpenicillin",
        "piperacillin-tazobactam",
      ],
    },
  },
  {
    // Almost every row is an enzyme inducer destroying the COMBINED pill —
    // carbamazepine, St John's wort, topiramate above 200 mg — plus one about
    // estrogen and VTE risk with tranexamic acid. Depot medroxyprogesterone is
    // the method a woman is switched TO when she is on an inducer, so warning
    // that it will fail does not merely cry wolf: it argues against the option
    // that still works. Removed on clinical review 2026-08-22 (ledger #1YPV51).
    // Levonorgestrel is kept: implant and pill formulations are inducer-affected.
    id: "oral-contraceptives",
    surfaces: ["oral contraceptives", "oral contraceptive", "combined oral contraceptive pill", "cocp", "ocps", "ocp"],
    kind: "catalogue",
    select: { slugs: ["ethinylestradiol", "levonorgestrel"] },
  },
  {
    id: "fibrates",
    surfaces: ["fibrates", "fibrate"],
    kind: "catalogue",
    select: { subclassIncludes: ["Fibrate"] },
    // Simvastatin's and atorvastatin's gemfibrozil rows write "Gemfibrozil
    // (Fibrate)" — a specific, uncatalogued drug's name with its class in
    // parentheses, not a general fibrate-class warning. Fenofibrate is this
    // catalogue's only other fibrate member and the corpus's own fenofibrate
    // row rates a statin combination "extreme caution", not the Contraindicated
    // severity gemfibrozil's row carries — so resolving "Fibrate" here would
    // misattribute that severity to the wrong drug. Denied at the source rather
    // than narrowing the surface, since the term is correct wherever a row
    // names the class generically.
    sourceDenySlugs: ["simvastatin", "atorvastatin"],
    sourceDenyRationales: {
      simvastatin: "Refers specifically to uncatalogued gemfibrozil rather than general fibrates (fenofibrate).",
      atorvastatin: "Refers specifically to uncatalogued gemfibrozil rather than general fibrates (fenofibrate).",
    },
  },
  {
    id: "immunosuppressants",
    surfaces: ["immunosuppressants", "immunosuppressant"],
    kind: "catalogue",
    select: { slugs: ["methotrexate"] },
  },
  {
    id: "nrt",
    surfaces: ["transdermal nrt", "nicotine transdermal systems", "nicotine patches"],
    kind: "catalogue",
    select: {
      slugs: [
        "nicotine-gum",
        "nicotine-inhalator",
        "nicotine-lozenge",
        "nicotine-mouth-spray",
        "nicotine-patch",
        "nicotine-sublingual-tablet",
      ],
    },
  },
  {
    id: "antibiotics",
    surfaces: ["antibiotics", "antibiotic", "oral antibiotics", "broad-spectrum antibiotics"],
    kind: "catalogue",
    select: { classes: ["Antibiotic"] },
    sourceDenySlugs: ["magnesium-oxide", "meropenem"],
    sourceDenyRationales: {
      "magnesium-oxide":
        "Row names the chelating classes (tetracyclines, fluoroquinolones); 'their antibiotic absorption' is not a claim against every antibiotic.",
      meropenem:
        "Valproate row; 'use alternative antibiotic' is advice, not an interaction with every other antibiotic.",
    },
  },
  {
    id: "sulfonylureas",
    surfaces: ["sulfonylureas", "sulfonylurea"],
    kind: "catalogue",
    select: { subclassIncludes: ["Sulfonylurea"] },
  },
];

const NON_CATALOGUE_TERMS: LexiconTerm[] = [
  {
    id: "alcohol",
    surfaces: ["alcohol", "alcohol-containing preparations", "ethanol"],
    kind: "nonDrug",
    note: "Substance use, not a prescribable catalogue entry.",
  },
  {
    id: "grapefruit",
    surfaces: ["grapefruit", "grapefruit juice"],
    kind: "nonDrug",
    note: "Dietary CYP3A4 inhibitor.",
  },
  {
    id: "acidic-drinks",
    surfaces: ["acidic drinks", "coffee", "juice", "soft drinks", "cola"],
    kind: "nonDrug",
    note: "Buccal/oral absorption timing, not a drug interaction.",
  },
  {
    id: "smoking",
    surfaces: ["smoking", "cigarette smoke", "tobacco smoke"],
    kind: "nonDrug",
    note: "CYP1A2 induction by polycyclic aromatic hydrocarbons, not by nicotine.",
  },
  { id: "food", surfaces: ["food", "dairy", "milk", "high-fat meals", "tyramine"], kind: "nonDrug", note: "Dietary." },
  {
    id: "st-johns-wort",
    surfaces: ["st john's wort", "st johns wort", "hypericum"],
    kind: "external",
    note: "Herbal CYP3A4 inducer; not stocked in the catalogue.",
  },
  {
    id: "azole-antifungals",
    surfaces: ["ketoconazole", "azoles", "azole antifungals"],
    kind: "external",
    note: "Ketoconazole is not in the catalogue; fluconazole/itraconazole resolve by name.",
  },
  {
    id: "barbiturates",
    surfaces: ["barbiturates", "barbiturate", "phenobarbital", "phenobarbitone"],
    kind: "external",
    note: "Not stocked in the catalogue.",
  },
  {
    id: "antiretrovirals",
    surfaces: ["antiretrovirals", "antiretroviral", "protease inhibitors"],
    kind: "external",
    note: "Ritonavir and relatives are outside the catalogue.",
  },
  {
    id: "cotrimoxazole",
    surfaces: ["bactrim", "co-trimoxazole", "cotrimoxazole"],
    kind: "external",
    note: "Combination product; trimethoprim resolves by name.",
  },
  {
    id: "cyp-inhibitors",
    surfaces: [
      "cyp inhibitors",
      "cyp inhibitor",
      "strong cyp inhibitors",
      "cyp3a4 inhibitors",
      "cyp2d6 inhibitors",
      "cyp1a2 inhibitors",
      "cyp2c19 inhibitors",
    ],
    kind: "mechanism",
    note: "Enumerating inhibitors needs pharmacokinetic data the catalogue does not carry.",
  },
  {
    id: "cyp-inducers",
    surfaces: ["cyp inducers", "cyp inducer", "strong cyp inducers", "cyp3a4 inducers", "enzyme inducers"],
    kind: "mechanism",
    note: "See cyp-inhibitors.",
  },
  {
    id: "cyp-substrates",
    surfaces: ["cyp substrates", "cyp2d6 substrates", "cyp3a4 substrates", "narrow therapeutic index drugs"],
    kind: "mechanism",
  },
  { id: "pgp", surfaces: ["p-gp", "p-gp inhibitors", "p-glycoprotein", "oatp"], kind: "mechanism" },
  {
    id: "cns-depressants",
    surfaces: ["cns depressants", "cns depressant", "sedatives", "sedative", "sedating drugs"],
    kind: "mechanism",
    note: "Deliberately unenumerable: the surface spans benzodiazepines, opioids, antihistamines, alcohol and more.",
  },
  {
    id: "qtc-prolonging",
    surfaces: [
      "qtc prolonging drugs",
      "qt prolonging drugs",
      "concurrent qtc prolonging drugs",
      "qt-prolonging agents",
    ],
    kind: "mechanism",
    note: "The catalogue carries QTc risk per drug but not a curated interacting set.",
  },
  {
    id: "serotonergic",
    surfaces: ["serotonergic drugs", "serotonergic agents", "other serotonergics"],
    kind: "mechanism",
  },
  {
    id: "bile-acid-sequestrants",
    surfaces: ["bile acid sequestrants", "cholestyramine"],
    kind: "external",
    note: "Bile acid sequestrants (e.g. Cholestyramine); not stocked in catalogue.",
  },
  {
    id: "retinoids",
    surfaces: ["isotretinoin", "acitretin"],
    kind: "external",
    note: "Systemic retinoids; outside current catalogue.",
  },
  {
    id: "orlistat",
    surfaces: ["orlistat"],
    kind: "external",
    note: "Lipase inhibitor; outside catalogue.",
  },
  {
    id: "anaesthetics",
    surfaces: ["anaesthetic agents", "anaesthetics", "anaesthetic", "neuromuscular blocking agents"],
    kind: "external",
    note: "Hospital-only surgical anaesthetics and neuromuscular blockers.",
  },
  {
    id: "laiv",
    surfaces: ["live attenuated influenza vaccine", "laiv"],
    kind: "external",
    note: "Live attenuated influenza vaccine, not prescribable drug.",
  },
  {
    id: "barrier-contraception",
    surfaces: ["condoms", "latex condoms", "diaphragms"],
    kind: "nonDrug",
    note: "Barrier contraception methods damaged by oil-based formulations.",
  },
  {
    id: "liquid-paraffin",
    surfaces: ["liquid paraffin", "mineral oil laxatives"],
    kind: "external",
    note: "Mineral oil laxative; outside catalogue.",
  },
  {
    id: "iv-calcium-solutions",
    surfaces: ["iv calcium solutions", "hartmann's", "plasmalyte"],
    kind: "nonDrug",
    note: "Intravenous electrolyte infusion solutions, not prescribable drugs.",
  },
  {
    id: "oral-absorption",
    surfaces: ["concomitant oral medications", "rapidly acting oral medications"],
    kind: "mechanism",
    note: "General absorption delay / transit-time alteration for oral formulations.",
  },
];

export const INTERACTION_LEXICON: readonly LexiconTerm[] = Object.freeze([...CATALOGUE_TERMS, ...NON_CATALOGUE_TERMS]);
export const UNENUMERATED_MECHANISM_TERM_IDS: ReadonlySet<string> = new Set(
  INTERACTION_LEXICON.filter((term) => term.kind === "mechanism").map((term) => term.id),
);

export const LEXICON_SURFACES_BY_LENGTH: readonly { surface: string; term: LexiconTerm }[] = Object.freeze(
  INTERACTION_LEXICON.flatMap((term) =>
    term.surfaces.map((surface) => ({ surface: surface.toLowerCase(), term })),
  ).sort((a, b) => b.surface.length - a.surface.length),
);

export function selectCatalogueSlugs(select: CatalogueSelector, records: readonly MedicationRecord[]): string[] {
  const deny = new Set(select.denySlugs ?? []);
  const matched = new Set<string>();

  for (const slug of select.slugs ?? []) {
    if (records.some((record) => record.slug === slug)) matched.add(slug);
  }
  for (const record of records) {
    const recordClass = (record.class ?? "").toLowerCase();
    const recordSubclass = (record.subclass ?? "").toLowerCase();
    const classHit = (select.classes ?? []).some((value) => value.toLowerCase() === recordClass);
    const subclassHit = (select.subclassIncludes ?? []).some((value) => recordSubclass.includes(value.toLowerCase()));
    const subclassExact = (select.subclassEquals ?? []).some((value) => value.toLowerCase() === recordSubclass);
    if (classHit || subclassHit || subclassExact) matched.add(record.slug);
  }

  for (const slug of deny) matched.delete(slug);
  return Array.from(matched).sort();
}
