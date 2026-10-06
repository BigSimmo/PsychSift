import { explicitlyBindsEntityToClinicalValue, type ClinicalTextSpan } from "@/lib/clinical-value-binding";

const medicationCatalog = `
acamprosate
acarbose
acetylcysteine
aciclovir
adrenaline
agomelatine
alendronate
alimemazine
allopurinol
alprazolam
amikacin
amiloride
amiodarone
amisulpride
amitriptyline
amlodipine
amoxicillin
apixaban
aripiprazole
armodafinil
ascorbic acid
asenapine
aspirin
atenolol
atomoxetine
atorvastatin
azithromycin
aztreonam
baclofen
beclometasone
benserazide
benzathine benzylpenicillin
benzatropine
betamethasone
bisacodyl
bisoprolol
brexpiprazole
budesonide
bupivacaine
buprenorphine
bupropion
calcium carbonate
candesartan
capsaicin
carbamazepine
carbimazole
cariprazine
carvedilol
cefazolin
cefepime
ceftriaxone
cefuroxime
celecoxib
cephalexin
cetirizine
chlorpromazine
ciclesonide
ciprofloxacin
citalopram
clarithromycin
clavulanate
clindamycin
clobetasol
clomipramine
clonazepam
clonidine
clopidogrel
clotrimazole
clozapine
co-trimoxazole
codeine
colchicine
colistin
copper
cyclizine
cyproheptadine
dabigatran
dalteparin
dantrolene
dapagliflozin
denosumab
desvenlafaxine
dexamethasone
dexamfetamine
dexmedetomidine
diazepam
diclofenac
dicloxacillin
digoxin
diltiazem
diphenhydramine
dipyridamole
disulfiram
docusate sodium
domperidone
donepezil
dosulepin
doxepin
doxycycline
droperidol
dulaglutide
duloxetine
dutasteride
edoxaban
empagliflozin
enoxaparin
epinephrine
eplerenone
ertapenem
erythromycin
escitalopram
esomeprazole
ethinylestradiol
exenatide
ezetimibe
famotidine
felodipine
fenofibrate
fentanyl
fexofenadine
finasteride
flecainide
flucloxacillin
fluconazole
fludrocortisone
flumazenil
fluoxetine
flupentixol decanoate
fluticasone
fluvoxamine
folic acid
formoterol
fortrans
fosfomycin
frusemide
gabapentin
gentamicin
gliclazide
glipizide
glycerol
glyceryl trinitrate
guanfacine
haloperidol
haloperidol decanoate
heparin
humalog mix
hydralazine
hydrochlorothiazide
hydrocortisone
hydromorphone
hydroxychloroquine
hyoscine butylbromide
hyoscine hydrobromide
ibuprofen
imipramine
indapamide
insulin aspart
insulin degludec
insulin detemir
insulin glargine
insulin glulisine
insulin lispro
iodine
ipratropium
iron
ispaghula husk
ketamine
ketorolac
labetalol
lactulose
lamotrigine
levetiracetam
levodopa
levomepromazine
levonorgestrel
levothyroxine
lidocaine
lignocaine
linagliptin
lisdexamfetamine
lithium
lithium carbonate
loperamide
loratadine
lorazepam
lurasidone
macrogol
magnesium oxide
magnesium sulfate
medroxyprogesterone
meloxicam
memantine
meropenem
mesalazine
metaraminol
metformin
methadone
methotrexate
methylphenidate
methylprednisolone
metoclopramide
metoprolol
metronidazole
midazolam
minocycline
mirtazapine
moclobemide
mometasone
montelukast
morphine
movicol
moxifloxacin
naloxone
naltrexone
naproxen
niacin
nicotinamide
nicotine
nifedipine
nitrazepam
nitrofurantoin
noradrenaline
norfloxacin
nortriptyline
novomix
nystatin
olanzapine
olanzapine pamoate
ondansetron
orphenadrine
oseltamivir
osmolax
oxazepam
oxcarbazepine
oxybutynin
oxycodone
paliperidone
pantoprazole
paracetamol
parecoxib
paroxetine
periciazine
perindopril
phenelzine
phenoxymethylpenicillin
phenytoin
piperacillin
polyethylene glycol
potassium chloride
prazosin
prednisolone
prednisone
pregabalin
probenecid
prochlorperazine
promethazine
propranolol
psyllium
pyridoxine
quetiapine
ramipril
reboxetine
riboflavin
risedronate
risperidone
rivaroxaban
rosuvastatin
roxithromycin
salbutamol
selenium
semaglutide
senna
sertraline
sildenafil
simvastatin
sitagliptin
sodium chloride
sodium nitroprusside
sodium phosphate
sodium picosulfate
sodium valproate
solifenacin
sotalol
spironolactone
sulfasalazine
sumatriptan
tadalafil
tamsulosin
tapentadol
tazobactam
temazepam
thiamine
ticagrelor
tiotropium
topiramate
tramadol
tranexamic acid
tranylcypromine
trazodone
triamcinolone
trifluoperazine
trimethoprim
valaciclovir
valproate
vancomycin
varenicline
vasopressin
venlafaxine
verapamil
vitamin a
vitamin b12
vitamin d
vitamin e
vitamin k
vortioxetine
warfarin
zinc sulfate
ziprasidone
ziprasidone im
zoledronic acid
zolpidem
zopiclone
zuclopenthixol
zuclopenthixol acetate
zuclopenthixol decanoate
`
  .trim()
  .split(/\r?\n/);

// This is deliberately a compact, static safety catalogue derived from the
// medication snapshot. Importing the full snapshot would add several megabytes
// of presentation data to the answer path. Aliases establish identity for
// safety checks and are not used to expand RAG retrieval queries. Medication
// catalog search may borrow this list for brand↔generic recall via
// medication-query.ts only.
const medicationIdentityGroups = [
  ["adrenaline", "epinephrine"],
  ["aripiprazole", "abilify"],
  ["benzodiazepine", "benzodiazepines", "benzo", "bzd"],
  ["carbamazepine", "tegretol"],
  ["clozapine", "clozaril"],
  ["flupentixol", "flupentixol decanoate"],
  ["frusemide", "furosemide"],
  ["haloperidol", "haldol", "haloperidol decanoate"],
  ["lidocaine", "lignocaine"],
  ["lithium", "lithium carbonate", "lithium level", "lithicarb", "quilonum sr"],
  ["lorazepam", "ativan"],
  ["macrogol", "movicol", "osmolax", "polyethylene glycol"],
  ["mirtazapine", "avanza", "remeron"],
  ["olanzapine", "olanzapine pamoate", "zyprexa"],
  ["paliperidone", "invega"],
  ["promethazine", "phenergan"],
  ["quetiapine", "seroquel"],
  ["ramipril", "tritace", "ramace", "prilace"],
  ["risperidone", "risperdal"],
  ["sertraline", "zoloft"],
  ["simvastatin", "zocor", "lipex", "simvar"],
  ["valproate", "sodium valproate", "valproic acid", "epilim"],
  ["ziprasidone", "ziprasidone im"],
  ["zuclopenthixol", "zuclopenthixol acetate", "zuclopenthixol decanoate"],
] as const;

const contextAmbiguousEntities = new Set([
  "copper",
  "glycerol",
  "iodine",
  "iron",
  "nicotinamide",
  "riboflavin",
  "selenium",
  "thiamine",
  "vitamin a",
  "vitamin b12",
  "vitamin d",
  "vitamin e",
  "vitamin k",
]);

function normalizeMedicationPhrase(value: string) {
  return value
    .toLowerCase()
    .replace(/[\s-]+/g, " ")
    .trim();
}

const canonicalMedicationByAlias = new Map<string, string>(
  medicationCatalog.map((medication) => [normalizeMedicationPhrase(medication), medication]),
);

for (const [canonical, ...aliases] of medicationIdentityGroups) {
  for (const alias of [canonical, ...aliases]) {
    canonicalMedicationByAlias.set(normalizeMedicationPhrase(alias), canonical);
  }
}

const medicationAliasesByCanonical = new Map<string, string[]>();
for (const [alias, canonical] of canonicalMedicationByAlias) {
  const aliases = medicationAliasesByCanonical.get(canonical) ?? [];
  aliases.push(alias);
  medicationAliasesByCanonical.set(canonical, aliases);
}

function escapePattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const medicationEntityPattern = new RegExp(
  `\\b(?:${Array.from(canonicalMedicationByAlias.keys())
    .sort((left, right) => right.length - left.length || left.localeCompare(right))
    .map((alias) => alias.split(" ").map(escapePattern).join("[\\s-]+"))
    .join("|")})\\b`,
  "gi",
);

export type MedicationEntityMatch = {
  canonical: string;
  start: number;
  end: number;
};

/** Canonical medication identities and offsets explicitly named in text. */
export function medicationEntityMatchesInText(text: string): MedicationEntityMatch[] {
  if (!text.trim()) return [];
  medicationEntityPattern.lastIndex = 0;
  const matches: MedicationEntityMatch[] = [];
  for (const match of text.matchAll(medicationEntityPattern)) {
    const canonical = canonicalMedicationByAlias.get(normalizeMedicationPhrase(match[0]));
    if (!canonical) continue;
    matches.push({ canonical, start: match.index, end: match.index + match[0].length });
  }
  medicationEntityPattern.lastIndex = 0;
  return matches;
}

/** Canonical medication identities explicitly named in text, in encounter order. */
export function medicationEntitiesInText(text: string) {
  const entities: string[] = [];
  const seen = new Set<string>();
  for (const match of medicationEntityMatchesInText(text)) {
    if (seen.has(match.canonical)) continue;
    seen.add(match.canonical);
    entities.push(match.canonical);
  }
  return entities;
}

/** Unambiguous medication identities suitable for answer-subject safety gates. */
export function medicationSafetyEntitiesInText(text: string) {
  return medicationEntitiesInText(text).filter((entity) => !contextAmbiguousEntities.has(entity));
}

const antipsychoticMedicationEntities = new Set([
  "amisulpride",
  "aripiprazole",
  "asenapine",
  "brexpiprazole",
  "cariprazine",
  "chlorpromazine",
  "clozapine",
  "droperidol",
  "flupentixol",
  "haloperidol",
  "levomepromazine",
  "lurasidone",
  "olanzapine",
  "paliperidone",
  "periciazine",
  "prochlorperazine",
  "quetiapine",
  "risperidone",
  "trifluoperazine",
  "ziprasidone",
  "zuclopenthixol",
]);

/** Whether a canonical medication identity belongs to the antipsychotic/neuroleptic class. */
export function isAntipsychoticMedicationEntity(entity: string) {
  return antipsychoticMedicationEntities.has(entity);
}

/** All recognized aliases for a canonical medication identity. */
export function medicationAliasesForEntity(entity: string) {
  const canonical =
    canonicalMedicationByAlias.get(normalizeMedicationPhrase(entity)) ?? medicationEntitiesInText(entity)[0];
  return canonical ? [...(medicationAliasesByCanonical.get(canonical) ?? [canonical])] : [];
}

/** Whether evidence names a different unambiguous medication from the query. */
export function hasForeignMedicationEntity(query: string, evidenceText: string) {
  const queryEntities = new Set(medicationEntitiesInText(query));
  if (queryEntities.size === 0) return false;
  return medicationEntitiesInText(evidenceText).some(
    (entity) => !queryEntities.has(entity) && !contextAmbiguousEntities.has(entity),
  );
}

const clinicalValuePattern =
  /(?:\bbetween\s+\d+(?:\.\d+)?\s+and\s+\d+(?:\.\d+)?|\b\d+(?:\.\d+)?\s*(?:[-–—]|\bto\b)\s*\d+(?:\.\d+)?|(?:[<>≤≥]\s*)?\b\d+(?:\.\d+)?)\s*(?:%|mmol\/?l|mol\/?l|mg\/?l|mg|mcg\/?l|mcg|ng\/?ml|ng|g|ml|units?|msec|ms|hours?|days?|weeks?|months?|years?)\b|\bevery\s+(?:\d+(?:\.\d+)?\s+)?(?:hours?|days?|weeks?|months?|years?)\b|\b(?:hourly|daily|weekly|fortnightly|monthly|quarterly|annually|yearly)\b/gi;

/**
 * Whether a clinical value is explicitly bound, within the same clause, to a
 * medication other than the medication asked about. Contextual co-medications
 * without their own value do not trigger this guard.
 */
export function hasForeignMedicationClinicalValueBinding(query: string, evidenceText: string) {
  const queryEntities = new Set(medicationEntitiesInText(query));
  if (queryEntities.size === 0) return false;

  const evidenceMatches = medicationEntityMatchesInText(evidenceText);
  const queryMatches = evidenceMatches.filter((match) => queryEntities.has(match.canonical));
  const foreignMatches = evidenceMatches.filter(
    (match) => !queryEntities.has(match.canonical) && !contextAmbiguousEntities.has(match.canonical),
  );
  if (foreignMatches.length === 0) return false;

  const valueSpans: ClinicalTextSpan[] = Array.from(
    evidenceText.matchAll(new RegExp(clinicalValuePattern.source, "gi")),
    (match) => ({
      start: match.index,
      end: match.index + match[0].length,
    }),
  );
  if (valueSpans.length === 0 || queryMatches.length === 0) return true;

  return foreignMatches.some((medication) =>
    valueSpans.some((value) => {
      if (!explicitlyBindsEntityToClinicalValue(medication, value, evidenceText)) return false;
      const boundQueryMatches = queryMatches.filter((queryMedication) =>
        explicitlyBindsEntityToClinicalValue(queryMedication, value, evidenceText),
      );
      if (boundQueryMatches.length === 0) return true;
      // A value already tied to the medication being asked about is not stolen by a
      // co-medication that merely sits nearby ("lithium at 0.6 mmol/L with aspirin").
      const foreignDistance = textSpanDistance(medication, value);
      const nearestQueryDistance = Math.min(
        ...boundQueryMatches.map((queryMedication) => textSpanDistance(queryMedication, value)),
      );
      return foreignDistance < nearestQueryDistance;
    }),
  );
}

function textSpanDistance(entity: { start: number; end: number }, value: { start: number; end: number }) {
  return Math.max(0, Math.max(entity.start, value.start) - Math.min(entity.end, value.end));
}
