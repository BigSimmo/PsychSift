import { normalizeSearchText, rankCatalogRecords } from "@/lib/catalog-search";
import { medicationStatTone } from "@/lib/medication-badges";
import type { SemanticTone } from "@/lib/semantic-tone";

export type MedicationPatientMetadata = {
  factors?: string[];
  action?: string;
  severity?: string;
  match?: Record<string, unknown>;
  note?: string;
};

export type MedicationSectionRow = {
  key: string;
  val: string;
  tags?: string[];
  patient?: MedicationPatientMetadata | null;
};

export type MedicationSection = {
  title: string;
  type: string;
  rows: MedicationSectionRow[];
};

export type MedicationStat = {
  label: string;
  value: string;
  cls?: string;
  flag?: string;
};

export type MedicationQuickRow = {
  label: string;
  value: string;
};

export type MedicationRecord = {
  slug: string;
  name: string;
  class: string;
  subclass: string;
  category: string;
  accent: string;
  tag: string;
  schedule: string;
  stats: MedicationStat[];
  sections: MedicationSection[];
  quick: MedicationQuickRow[];
};

export type MedicationSearchMatch = {
  medication: MedicationRecord;
  score: number;
  reasons: string[];
};

export type MedicationResultTone = "teal" | "blue" | "slate";

export type MedicationActionTone = "danger" | "warning" | "neutral";

export type MedicationSearchResult = {
  id: string;
  name: string;
  indication: string;
  match: string;
  dose: string;
  ceiling: string;
  action: string;
  actionTone: MedicationActionTone;
  tone: MedicationResultTone;
  href: string;
};

export function normalizeMedicationSlug(value: string) {
  return value.trim().toLowerCase();
}

export { normalizeSearchText };

export function normalizeRecord(record: MedicationRecord): MedicationRecord {
  return {
    ...record,
    slug: normalizeMedicationSlug(record.slug),
    name: record.name.trim(),
    class: record.class?.trim() ?? "",
    subclass: record.subclass?.trim() ?? "",
    category: record.category?.trim() ?? "",
    // Per-record user colour (Postgres medications.accent default). Stored as a
    // hex swatch for inline styles; not --clinical-accent (app chrome).
    accent: record.accent?.trim() || "#0f766e",
    tag: record.tag?.trim() ?? "",
    schedule: record.schedule?.trim() ?? "",
    stats: Array.isArray(record.stats) ? record.stats : [],
    sections: Array.isArray(record.sections) ? record.sections : [],
    quick: Array.isArray(record.quick) ? record.quick : [],
  };
}

function sectionByType(record: MedicationRecord, type: string) {
  return record.sections.find((section) => section.type === type);
}

function firstRowValue(record: MedicationRecord, type: string, keyIncludes?: string) {
  const section = sectionByType(record, type);
  if (!section) return "";
  const row = keyIncludes
    ? section.rows.find((item) => item.key.toLowerCase().includes(keyIncludes.toLowerCase()))
    : section.rows[0];
  return row?.val?.trim() ?? "";
}

function statValue(record: MedicationRecord, labelIncludes: string) {
  const stat = record.stats.find((item) => item.label.toLowerCase().includes(labelIncludes.toLowerCase()));
  return stat?.value?.trim() ?? "";
}

function quickValue(record: MedicationRecord, labelIncludes: string) {
  const row = record.quick.find((item) => item.label.toLowerCase().includes(labelIncludes.toLowerCase()));
  return row?.value?.trim() ?? "";
}

/**
 * Parse a Brand Names cell into identity tokens only.
 * Strip parenthetical annotations before splitting so internal "/" or ","
 * (e.g. "Benadryl (Sleep/Allergy formulations)") cannot fabricate brands, and
 * drop sentence-level prose after the brand list ("Bactrim, Resprim. Available…").
 */
export function parseMedicationBrandNameList(value: string): string[] {
  const withoutMarkup = value.replace(/\*\*/g, "").trim();
  if (!withoutMarkup) return [];

  // Annotations first — then list separators — so slash/comma inside "(…)" never tokenize.
  const withoutAnnotations = withoutMarkup.replace(/\([^)]*\)/g, " ");
  // Brand lists are comma/semicolon separated; truncate trailing prose after a sentence end.
  const brandListHead = withoutAnnotations.split(/\.\s+(?=[A-Z])/)[0] ?? withoutAnnotations;

  const brands: string[] = [];
  const seen = new Set<string>();
  for (const part of brandListHead.split(/[,;/]/g)) {
    const brand = part.replace(/\s+/g, " ").trim();
    if (brand.length < 2) continue;
    // Reject leftover narrative fragments that are not brand-like (too many words).
    if (brand.split(/\s+/).length > 4) continue;
    const key = brand.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    brands.push(brand);
  }
  return brands;
}

/** Brand names from the Formulation & Access "Brand Names" row (prescription names). */
export function medicationBrandNames(record: MedicationRecord): string[] {
  const values = record.sections
    .filter((section) => section.type === "form")
    .flatMap((section) => section.rows)
    .filter((row) => /brand\s*names?/i.test(row.key))
    .map((row) => row.val.replace(/\*\*/g, "").trim())
    .filter(Boolean);

  const brands: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    for (const brand of parseMedicationBrandNameList(value)) {
      const key = brand.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      brands.push(brand);
    }
  }
  return brands;
}

export function medicationSearchText(record: MedicationRecord) {
  const sectionText = record.sections
    .flatMap((section) => [section.title, ...section.rows.flatMap((row) => [row.key, row.val, ...(row.tags ?? [])])])
    .join(" ");
  const quickText = record.quick.map((row) => `${row.label} ${row.value}`).join(" ");
  const statText = record.stats.map((stat) => `${stat.label} ${stat.value}`).join(" ");
  return normalizeSearchText(
    [
      record.name,
      record.slug,
      record.class,
      record.subclass,
      record.category,
      record.tag,
      record.schedule,
      medicationBrandNames(record).join(" "),
      sectionText,
      quickText,
      statText,
    ].join(" "),
  );
}

export function medicationIndication(record: MedicationRecord) {
  const raw =
    firstRowValue(record, "ind", "primary") ||
    firstRowValue(record, "summary", "overview") ||
    record.subclass ||
    record.category;
  // Emit a single clinical clause so constrained surfaces (search rows, cross-mode
  // subtitles, the detail header) get one crisp line; the full indication list
  // still lives in the record's indication/summary sections.
  return firstClinicalSentence(raw.replace(/\*\*/g, "")) || raw;
}

// Shared "short & sharp" length cap for constrained surfaces (hero-metric tiles,
// search cells): strip markdown bold, then cap on a word boundary with an
// ellipsis. Generalises the slice(0, N)… idiom already used by
// formulationShortLabel (medication-badges.ts). It intentionally does NOT split
// on sentences — stat values are curated tokens that can carry dotted
// abbreviations ("L.O.T. DRUG", "b.d.") — so callers that want the first clause
// of prose compose firstClinicalSentence themselves (e.g. medicationIndication,
// medicationUsualDose). Full text always remains in the sections/reference.
export function shortValue(text: string, cap = 24): string {
  const cleaned = (text ?? "").replace(/\*\*/g, "").trim();
  if (cleaned.length <= cap) return cleaned;
  const slice = cleaned.slice(0, cap);
  const boundary = slice.lastIndexOf(" ");
  const head = (boundary > cap * 0.6 ? slice.slice(0, boundary) : slice).replace(/[\s,;:]+$/, "");
  return `${head}…`;
}

// Take the first sentence without mangling decimals ("1.5 mg") or common
// abbreviations ("e.g.", "i.e.", "etc.") the naive split(".")[0] used to cut
// mid-parenthesis ("Any hepatic impairment (e").
export function firstClinicalSentence(value: string): string {
  const text = value.trim();
  const periods = /\./g;
  let match: RegExpExecArray | null;
  while ((match = periods.exec(text))) {
    const next = text[match.index + 1];
    if (next !== undefined && !/\s/.test(next)) continue;
    const before = text.slice(0, match.index);
    if (/(?:^|[\s(])(?:e\.g|i\.e|etc|vs|approx|p\.r\.n|b\.i\.d|t\.i\.d|q\.i\.d|q\.d|prn|bid|tid|qid|qd)$/i.test(before))
      continue;
    // Genus abbreviations ("H. pylori", "E. coli", "C. difficile") are a lone
    // letter followed by a lowercase species — not a sentence end; splitting
    // there would drop the rest of the clause. Restrict the skip to that shape
    // so genuine single-letter sentence ends ("Pregnancy Category D. ...",
    // "Vitamin C. ...", "Penicillin G. ...") still split.
    const nextWord = text.slice(match.index + 1).match(/^\s+(\S)/);
    if (/(?:^|[\s(])[A-Za-z]$/.test(before) && nextWord && /[a-z]/.test(nextWord[1])) continue;
    return before.trim();
  }
  return text;
}

export function medicationUsualDose(record: MedicationRecord) {
  const quickDose = quickValue(record, "usual dose");
  if (quickDose) return firstClinicalSentence(quickDose.replace(/\*\*/g, "")) || quickDose;
  const doseRow = sectionByType(record, "dose")?.rows[0];
  const doseValue = doseRow?.val?.replace(/\*\*/g, "");
  return doseValue ? firstClinicalSentence(doseValue) || "See dosing" : "See dosing";
}

export function medicationCeiling(record: MedicationRecord) {
  return statValue(record, "max dose") || statValue(record, "ceiling") || "See reference";
}

// The action tone is derived from which source field supplied the text (not from
// output-text heuristics): avoid/contraindication content is a hard stop (danger),
// monitoring/laboratory content is a check-first caution (warning), and summary or
// fallback text is neutral reference material.
export function medicationActionDetail(record: MedicationRecord): { text: string; tone: MedicationActionTone } {
  const sources: Array<{ raw: string; tone: MedicationActionTone }> = [
    { raw: quickValue(record, "avoid"), tone: "danger" },
    { raw: firstRowValue(record, "contra", "absolute"), tone: "danger" },
    { raw: firstRowValue(record, "summary", "clinical focus"), tone: "neutral" },
    { raw: firstRowValue(record, "mon", "laboratory"), tone: "warning" },
  ];
  const picked = sources.find((source) => source.raw) ?? {
    raw: "Review full prescribing reference.",
    tone: "neutral" as const,
  };
  const text = firstClinicalSentence(picked.raw.replace(/\*\*/g, "")) || "Review full prescribing reference";
  return { text, tone: picked.tone === "danger" ? avoidTextTone(text) : picked.tone };
}

// Avoid/contraindication fields are heterogeneous: hard stops ("Contraindicated
// in ...", "Severe respiratory depression, paralytic ileus"), explicit
// no-contraindication statements ("NONE — ...") and caution-only guidance
// ("Pregnancy Category B2", "requires pharmacist review and dose reduction").
// Only hard stops may carry the danger icon / "Do not use" prefix. Condition
// lists without any keyword stay danger — under-warning is the failure mode to
// avoid — so downgrades are keyed to explicit none/caution phrasing only.
const HARD_STOP_PATTERN = /contraindicat|do not\b|avoid\b|hypersensitiv|anaphylax|never\b|must not/i;
const CAUTION_ONLY_PATTERN =
  /pregnancy category|\bcategory [ab]\d?\b|pharmacist|dose reduction|reduce dose|requires?\b[^.]*\breview|generally (?:considered )?safe/i;

function avoidTextTone(text: string): MedicationActionTone {
  if (/^(?:none\b|no\s+(?:absolute\s+)?contraindication)/i.test(text)) {
    return /caution/i.test(text) ? "warning" : "neutral";
  }
  if (!HARD_STOP_PATTERN.test(text) && CAUTION_ONLY_PATTERN.test(text)) {
    return "warning";
  }
  return "danger";
}

export function medicationResultTone(record: MedicationRecord, score: number): MedicationResultTone {
  if (score >= 12) return "teal";
  if (score >= 6) return "blue";
  return "slate";
}

export function medicationToSearchResult(match: MedicationSearchMatch): MedicationSearchResult {
  const { medication, score } = match;
  const action = medicationActionDetail(medication);
  return {
    id: medication.slug,
    name: medication.name,
    indication: medicationIndication(medication),
    match: score >= 12 ? "Exact clinical fit" : score >= 6 ? "Good clinical fit" : "Related match",
    dose: shortValue(medicationUsualDose(medication), 44),
    ceiling: medicationCeiling(medication),
    action: action.text,
    actionTone: action.tone,
    tone: medicationResultTone(medication, score),
    href: `/medications/${medication.slug}`,
  };
}

export function rankMedicationRecords(
  records: MedicationRecord[],
  query: string,
  limit = 50,
  // Low-weight synonym/acronym/alias terms (e.g. from analyzeClinicalQuery) threaded into the
  // shared ranker's expanded lane: they add recall via the content haystack without competing
  // with exact name/prefix scoring. Empty by default so existing callers are unchanged.
  expansions: string[] = [],
  // Governed Prescribing-only bonus for a complete multi-word expansion phrase (a
  // concept match, not a generic content hit). Off by default: `expansions` here is
  // also threaded into `searchMedicationsDomain` (universal-search, general clinical
  // search), where two concept-equivalent phrases (e.g. "blood pressure" and
  // "orthostatic hypotension") can otherwise stack bonuses and push an unrelated
  // medication class above real matches. Only `searchMedicationCatalog` (the
  // Prescribing mode's own catalogue search) opts in.
  applyExpandedPhraseBonus = false,
): MedicationSearchMatch[] {
  return rankCatalogRecords(records, query, {
    fields: [
      {
        id: "name",
        weight: 8,
        text: (medication) => normalizeSearchText(`${medication.name} ${medication.slug}`),
      },
      {
        // Prescription / trade names — same weight family as generic name so brand
        // queries (Campral, Zoloft) are not demoted to weak content hits.
        id: "brands",
        weight: 8,
        text: (medication) => normalizeSearchText(medicationBrandNames(medication).join(" ")),
      },
      {
        id: "taxonomy",
        weight: 3,
        text: (medication) =>
          normalizeSearchText(
            [medication.class, medication.subclass, medication.category, medication.tag, medication.schedule].join(" "),
          ),
      },
    ],
    fullText: medicationSearchText,
    contentWeight: 2,
    compactBonus: 6,
    compactExtraText: (medication) =>
      normalizeSearchText([medication.name, ...medicationBrandNames(medication)].join(" ")),
    phraseBonus: 4,
    exactValues: (medication) => [
      normalizeSearchText(medication.name),
      normalizeSearchText(medication.slug),
      ...medicationBrandNames(medication).map((brand) => normalizeSearchText(brand)),
    ],
    exactBonus: 10,
    prefixValues: (medication) => [
      normalizeSearchText(medication.name),
      normalizeSearchText(medication.slug),
      ...medicationBrandNames(medication).map((brand) => normalizeSearchText(brand)),
    ],
    prefixBonus: 5,
    expandTokens: expansions.length ? (terms) => [...terms, ...expansions] : undefined,
    expandedPhraseBonus: applyExpandedPhraseBonus ? 8 : 0,
    limit,
    tieBreak: (left, right) => left.name.localeCompare(right.name),
  }).map(({ record, score, signals }) => ({
    medication: record,
    score,
    reasons: [
      signals.fields.name ? "name" : "",
      signals.fields.brands ? "brand" : "",
      signals.prefix ? "name prefix" : "",
      signals.compact ? "exact name" : "",
      signals.fields.taxonomy ? "class/category" : "",
      signals.content ? "content" : "",
    ].filter(Boolean),
  }));
}

/**
 * PBS Section 100 Opioid Dependence Treatment Program (ODTP).
 * Since 1 July 2023, opioid dependence treatment medicines (including Suboxone sublingual
 * films and long-acting buprenorphine depot injections) are listed under the PBS Section 100
 * Opioid Dependence Treatment Program (ODTP) rather than the legacy Section 100 Highly
 * Specialised Drugs (HSD) Community Access program. Patients access PBS-subsidised treatment
 * with standard co-payments (accruing toward the Safety Net) at community pharmacies,
 * removing legacy private dispensing/dosing fees.
 */
export const PBS_SECTION_100_ODTP_PROGRAM = {
  name: "Section 100 Opioid Dependence Treatment Program (ODTP)",
  effectiveDate: "2023-07-01",
  legacyProgram: "Section 100 Highly Specialised Drugs (HSD) Community Access",
  transitionSummary:
    "Post-July 2023, ODT medicines (including buprenorphine depot and Suboxone films) transitioned to Section 100 ODTP with standard PBS co-payments and Safety Net accrual at community pharmacies.",
} as const;

export { medicationIdentityBadges } from "@/lib/medication-badges";

export type MedicationHeroMetric = {
  label: string;
  value: string;
  tone: SemanticTone;
};

// "Max Dose" (and a bare "Dose") carry flag:"hi" to mark the prescribing
// ceiling's importance, not a safety stop, so both tone and ordering treat it
// specially — share one label test so the two stay aligned.
export function isMaxDoseLabel(label: string): boolean {
  return /^(?:max(?:imum)?\s+)?doses?$/i.test(label.trim());
}

// Render Max Dose as the primary/clinical metric so red stays reserved for
// genuine risk signals (contraindications, toxicity, teratogenicity), matching
// the #659 colour contract.
function heroMetricTone(stat: MedicationStat): SemanticTone {
  if (isMaxDoseLabel(stat.label)) return "clinical";
  return medicationStatTone(stat);
}

// The top-of-page metric tiles. Every record already carries a curated ~4-item
// `stats` array of short, glanceable values (median 8 chars) — Max Dose plus
// half-life and drug-specific risk/caution flags — so those ARE the "max dose ·
// duration · cautions, short and sharp". We lead with Max Dose (the most-cited
// ceiling), cap each value with shortValue, and backfill from crisp derived
// tokens only for the rare record with fewer than four stats. Verbose derived
// sentences (indication/dosing/contraindications) are not tiled here — they live
// in the header subtitle and the detail sections instead.
export function medicationHeroMetrics(record: MedicationRecord): MedicationHeroMetric[] {
  const ordered = [
    ...record.stats.filter((stat) => isMaxDoseLabel(stat.label)),
    ...record.stats.filter((stat) => !isMaxDoseLabel(stat.label)),
  ];
  const metrics: MedicationHeroMetric[] = ordered.slice(0, 4).map((stat) => ({
    label: stat.label,
    // Never truncate the prescribing ceiling: multi-variant max doses (e.g.
    // "Buvidal 160 mg/month; Sublocade 300 mg/month") must stay complete, and the
    // full value lives nowhere else now that the Key-stats sidebar is gone. Other
    // stats are short curated tokens, so shortValue is only a safety-net cap.
    value: isMaxDoseLabel(stat.label) ? stat.value.replace(/\*\*/g, "").trim() : shortValue(stat.value),
    tone: heroMetricTone(stat),
  }));
  if (metrics.length >= 4) return metrics;

  const usualDose = medicationUsualDose(record);
  const backfills: MedicationHeroMetric[] = [
    { label: "Usual dose", value: shortValue(usualDose), tone: "clinical" },
    record.schedule ? { label: "Schedule", value: shortValue(record.schedule), tone: "neutral" } : null,
    record.category ? { label: "Category", value: shortValue(record.category), tone: "neutral" } : null,
  ].filter((metric): metric is MedicationHeroMetric => metric !== null);

  for (const fill of backfills) {
    if (metrics.length >= 4) break;
    if (metrics.some((metric) => metric.label.toLowerCase() === fill.label.toLowerCase())) continue;
    if (!fill.value || fill.value === "See dosing" || fill.value === "See reference") continue;
    metrics.push(fill);
  }
  return metrics;
}
