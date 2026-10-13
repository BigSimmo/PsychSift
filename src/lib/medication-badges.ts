import { SEMANTIC_TONE_PRIORITY, type SemanticIconKey, type SemanticTone } from "@/lib/semantic-tone";
import type {
  MedicationPatientMetadata,
  MedicationRecord,
  MedicationSectionRow,
  MedicationStat,
} from "@/lib/medications";

export type MedicationGovernance = {
  sourceStatus?: string;
  validationStatus?: string;
  /**
   * ISO calendar date (yyyy-mm-dd) the record's sources were last checked against
   * the publisher, when that is known. Absent or null means the date could not be
   * read, which is reported as such rather than smoothed over.
   */
  sourceCheckedAt?: string | null;
  /**
   * Whether the record carries any source text at all. Absent means the caller did
   * not derive it, and the badge then makes the weaker of the two claims — asserting
   * "no sources recorded" about a record whose sources were simply never inspected
   * would be a fabrication, where "date unknown" is merely incomplete.
   */
  sourcesRecorded?: boolean;
};

export type MedicationBadge = {
  id: string;
  label: string;
  tone: SemanticTone;
  // Optional semantic icon key resolved by ClinicalBadge (e.g. controlled-drug
  // lock). Danger/warning badges already get a default icon from their tone, so
  // this is only set where a specific icon is meaningful.
  iconKey?: SemanticIconKey;
};

const TAG_TONES: Record<string, SemanticTone> = {
  PBS: "success",
  TGA: "info",
  OFF: "warning",
};

const FACTOR_LABELS: Record<string, string> = {
  renal: "Renal",
  hepatic: "Hepatic",
  pregnancy: "Pregnancy",
  lactation: "Breastfeeding",
  elderly: "Elderly",
  paediatric: "Paediatric",
};

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

function firstRow(record: MedicationRecord, type: string, keyIncludes?: string) {
  const section = sectionByType(record, type);
  if (!section) return undefined;
  return keyIncludes
    ? section.rows.find((item) => item.key.toLowerCase().includes(keyIncludes.toLowerCase()))
    : section.rows[0];
}

function quickValue(record: MedicationRecord, labelIncludes: string) {
  const row = record.quick.find((item) => item.label.toLowerCase().includes(labelIncludes.toLowerCase()));
  return row?.value?.trim() ?? "";
}

function pushBadge(badges: MedicationBadge[], badge: MedicationBadge) {
  if (!badges.some((existing) => existing.id === badge.id)) {
    badges.push(badge);
  }
}

export function dedupeBadges(badges: MedicationBadge[]): MedicationBadge[] {
  const seen = new Set<string>();
  return badges.filter((badge) => {
    if (seen.has(badge.id)) return false;
    seen.add(badge.id);
    return true;
  });
}

export function sortBadgesByPriority(badges: MedicationBadge[]): MedicationBadge[] {
  return [...badges].sort((a, b) => SEMANTIC_TONE_PRIORITY[b.tone] - SEMANTIC_TONE_PRIORITY[a.tone]);
}

/**
 * The first strength in the text that is genuinely a strength PER DOSE UNIT.
 *
 * `(\d+)\s*mg` was none of the three things it needed to be. It dropped the
 * decimal point, so varenicline "Tablets (0.5 mg, 1 mg)" badged as "5 mg" — a
 * tenfold error on the record's most glanceable line, and the same shape as the
 * "1.5 mg" bug `firstClinicalSentence` (medications.ts) was already fixed for.
 * It also read two token shapes that are not unit strengths at all:
 *
 *   - a concentration ("5 mg/mL", "80 mg/2 mL") is per volume, so the number is
 *     a strength only once a volume is chosen;
 *   - a combination product ("2/0.5 mg", "500/125 mg") states two actives, and
 *     neither number alone is the product's strength.
 *
 * Both are skipped rather than repaired. `sawStrength` reports that some strength
 * token existed, so the caller can emit NO badge instead of a wrong one; the
 * verbatim formulation text is still on the record below. Deliberately not a
 * first-number fallback — see the generator comment in
 * `scripts/build-medication-interaction-index.ts` for why bare first-token
 * heuristics misfire on this corpus.
 */
function firstUnitStrengthMg(text: string): { mg: string | null; sawStrength: boolean } {
  let sawStrength = false;
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*mg\b/gi)) {
    sawStrength = true;
    const start = match.index ?? 0;
    if (/\d\s*\/\s*$/.test(text.slice(0, start))) continue;
    if (/^\s*\//.test(text.slice(start + match[0].length))) continue;
    return { mg: match[1], sawStrength };
  }
  return { mg: null, sawStrength };
}

export function formulationShortLabel(value: string): string | null {
  const cleaned = value
    .replace(/\*\*/g, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
  if (!cleaned) return null;

  const { mg, sawStrength } = firstUnitStrengthMg(cleaned);
  if (mg) {
    const isEc = /enteric/i.test(cleaned);
    const isTab = /tablet/i.test(cleaned);
    if (isEc && isTab) return `${mg} mg EC tablet`;
    if (isTab) return `${mg} mg tablet`;
    if (isEc) return `${mg} mg EC`;
    return `${mg} mg`;
  }
  // A strength was stated but none of it is a per-unit strength. Say nothing
  // rather than badge a concentration or half a combination as a tablet.
  if (sawStrength) return null;

  const firstSentence = cleaned.split(".")[0]?.trim() ?? "";
  if (!firstSentence) return null;
  return firstSentence.length > 28 ? `${firstSentence.slice(0, 28).trim()}…` : firstSentence;
}

function parsePbsBadges(pbsText: string, badges: MedicationBadge[]) {
  const upper = pbsText.toUpperCase();
  if (upper.includes("STREAMLINED PBS")) {
    pushBadge(badges, { id: "identity-pbs-streamlined", label: "PBS streamlined", tone: "success" });
  } else if (/AUTHORITY REQUIRED/i.test(pbsText)) {
    pushBadge(badges, { id: "identity-pbs-authority", label: "Authority required", tone: "warning" });
  }

  const itemMatch = pbsText.match(/\bitem\s+(\d{4}[A-Z])\b/i) ?? pbsText.match(/\b(\d{4}[A-Z])\b/);
  if (itemMatch?.[1]) {
    pushBadge(badges, { id: `identity-pbs-item-${itemMatch[1]}`, label: itemMatch[1], tone: "neutral" });
  }
}

/**
 * "Reviewed" is a clinical-validation claim, so only a recorded validation status earns it.
 *
 * This used to fall back to the record's own Sources text containing "checked", which
 * conflates two different facts: when a source was last looked at, and whether a clinician
 * reviewed the entry. Every snapshot record carries a "checked <date>" row, so the fallback
 * showed a green Reviewed badge beside dosing content for all of them. It also matched the
 * negative forms — "not checked" and "unchecked" both contain the substring.
 */
function isReviewed(_record: MedicationRecord, governance?: MedicationGovernance) {
  return governance?.validationStatus === "locally_reviewed" || governance?.validationStatus === "approved";
}

function patientBadges(patient: MedicationPatientMetadata, prefix: string, badges: MedicationBadge[]) {
  const match = patient.match ?? {};
  const scr = match.scr as { gt?: number } | undefined;
  if (typeof scr?.gt === "number") {
    pushBadge(badges, {
      id: `${prefix}-scr-gt-${scr.gt}`,
      label: `Cr >${scr.gt} avoid`,
      tone: "danger",
    });
  }

  const age = match.age as { lt?: number; gt?: number } | undefined;
  if (typeof age?.lt === "number") {
    pushBadge(badges, {
      id: `${prefix}-age-lt-${age.lt}`,
      label: `Avoid <${age.lt} years`,
      tone: "warning",
    });
  }
  if (typeof age?.gt === "number") {
    pushBadge(badges, {
      id: `${prefix}-age-gt-${age.gt}`,
      label: `Avoid >${age.gt} years`,
      tone: "warning",
    });
  }

  const action = patient.action ?? "";
  const severity = patient.severity === "danger" ? "danger" : action === "contraindication" ? "danger" : "warning";
  const factorTone: SemanticTone =
    action === "monitor" || action === "dose-adjust" ? "clinical" : severity === "danger" ? "danger" : "warning";

  for (const factor of patient.factors ?? []) {
    const label = FACTOR_LABELS[factor] ?? factor.charAt(0).toUpperCase() + factor.slice(1);
    pushBadge(badges, {
      id: `${prefix}-factor-${factor}`,
      label,
      tone: action === "contraindication" ? "danger" : factorTone,
    });
  }
}

function textHeuristicBadges(
  row: MedicationSectionRow,
  sectionType: string,
  prefix: string,
  badges: MedicationBadge[],
) {
  const val = row.val.replace(/\*\*/g, "");
  const keyLower = row.key.toLowerCase();
  const combined = `${row.key} ${val}`.toLowerCase();

  if (/^critical\b/i.test(val) || /^contraindicated\b/i.test(val)) {
    pushBadge(badges, { id: `${prefix}-contraindicated`, label: "Contraindicated", tone: "danger" });
  }

  if (sectionType === "risk") {
    const severityMatch = val.match(/^(HIGH|MODERATE|LOW)\b/i);
    if (severityMatch?.[1]) {
      const level = severityMatch[1].toUpperCase();
      pushBadge(badges, {
        id: `${prefix}-severity-${level}`,
        label: level.charAt(0) + level.slice(1).toLowerCase(),
        tone: level === "HIGH" ? "warning" : "neutral",
      });
    }
  }

  if (combined.includes("<60 kg") || combined.includes("< 60 kg")) {
    pushBadge(badges, { id: `${prefix}-reduce-60kg`, label: "Reduce <60 kg", tone: "warning" });
  }
  if (combined.includes("child-pugh c")) {
    pushBadge(badges, { id: `${prefix}-child-pugh-c`, label: "Child-Pugh C", tone: "danger" });
  }
  if (combined.includes("do not crush")) {
    pushBadge(badges, { id: `${prefix}-do-not-crush`, label: "Do not crush", tone: "warning" });
  }
  if (combined.includes("take with food") || combined.includes("with meals")) {
    pushBadge(badges, { id: `${prefix}-with-food`, label: "Take with food", tone: "clinical" });
  }

  if (sectionType === "dose" && keyLower.includes("renal")) {
    pushBadge(badges, { id: `${prefix}-renal-adjust`, label: "Renal adjustment", tone: "warning" });
  }
}

const SOURCE_CHECK_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

// Formatted from the ISO parts by hand rather than through `toLocaleDateString`, so
// the label a server render produces is byte-identical to the one the browser
// hydrates — no locale or timezone can shift the month by a day.
function sourceCheckedMonthLabel(sourceCheckedAt?: string | null): string | null {
  if (!sourceCheckedAt) return null;
  const match = /^(\d{4})-(0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.exec(sourceCheckedAt);
  if (!match) return null;
  return `${SOURCE_CHECK_MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

/**
 * Source-freshness badge, or `null` where there is nothing worth a chip.
 *
 * A DEFICIENCY badge, not a status readout. `current` gets no badge at all: it is the
 * unremarkable case, its text was identical for 327 of the 330 snapshot records, and
 * the identity cluster is already saturated. Every one of those records produces at
 * least five badges and the detail hero renders `limit={5}`, so an always-on chip does
 * not add a row — it evicts one, and the tone ordering made it evict prescribing
 * information: measured at a 2026-09-02 reference date, 201 of 330 records lost their
 * Poisons Schedule (122) or TGA/OFF indication tag (77) chip to a "Source checked …"
 * chip carrying almost no information. A record showing neither `TGA` nor `OFF` reads
 * as unknown regulatory status rather than approved, and the overflow `+N` chip is
 * plain text with no tooltip, so what it swallows is genuinely unreachable. Re-toning
 * `current` does not help; the cluster is full either way. Surface a last-checked date
 * for a healthy record as text, never as a chip.
 *
 * What DOES earn a chip is a deficiency the reader cannot otherwise see: sources that
 * are due a re-check, sources whose date could not be read, no recorded sources at all,
 * or a recorded supersession. Those never look identical to a record checked last month
 * again, which is the whole point of the status.
 *
 * The wording describes when the sources were last checked against the publisher and
 * stops there. It never says the entry was "checked" unqualified — that reads as a
 * claim that someone validated the content, which is the same conflation `isReviewed`
 * above exists to prevent.
 */
function sourceFreshnessBadge(governance: MedicationGovernance): MedicationBadge | null {
  const checkedMonth = sourceCheckedMonthLabel(governance.sourceCheckedAt);

  if (governance.sourceStatus === "current") {
    return null;
  }
  if (governance.sourceStatus === "review_due") {
    // The actionable half leads, because the chip truncates from the end.
    return {
      id: "identity-source-review-due",
      label: checkedMonth ? `Source check due — sources last checked ${checkedMonth}` : "Source check due",
      tone: "warning",
    };
  }
  if (governance.sourceStatus === "outdated") {
    // Dormant by design: nothing derives `outdated` today. Age alone cannot establish
    // that guidance has been superseded — that is a clinical judgement nobody has
    // recorded — so this branch waits for a recorded-supersession flow instead of
    // being inferred from a second, longer age threshold.
    return { id: "identity-source-superseded", label: "Source superseded", tone: "danger" };
  }
  // Anything else — an explicit `unknown`, a missing status, or a value this build does
  // not recognise — degrades to a visible warning rather than to silence. Split by which
  // deficiency it actually is: a record with no `src` section whatsoever is worse off
  // than one whose date merely would not parse, and saying so costs nothing.
  if (governance.sourcesRecorded === false) {
    return { id: "identity-source-none", label: "No sources recorded", tone: "warning" };
  }
  return { id: "identity-source-unknown", label: "Source date unknown", tone: "warning" };
}

export function medicationIdentityBadges(
  record: MedicationRecord,
  governance?: MedicationGovernance,
): MedicationBadge[] {
  const badges: MedicationBadge[] = [];

  if (record.tag) {
    pushBadge(badges, { id: "identity-tag", label: record.tag, tone: "neutral" });
  }
  if (record.schedule) {
    // S8 (controlled drug) is a regulatory classification, not a clinical stop
    // state. Give it a dedicated "controlled" treatment — warning tone + lock
    // icon — so red stays reserved for true contraindications/do-not-use.
    const isControlled = record.schedule === "S8";
    pushBadge(badges, {
      id: "identity-schedule",
      label: record.schedule,
      tone: isControlled ? "warning" : "info",
      ...(isControlled ? { iconKey: "controlled" as const } : {}),
    });
  }

  const brand = firstRowValue(record, "form", "brand");
  if (brand) {
    pushBadge(badges, { id: "identity-brand", label: brand.replace(/\*\*/g, ""), tone: "neutral" });
  }

  const formulation = formulationShortLabel(quickValue(record, "route / formulation"));
  if (formulation) {
    pushBadge(badges, { id: "identity-formulation", label: formulation, tone: "neutral" });
  }

  const primaryRow = firstRow(record, "ind", "primary");
  for (const tag of primaryRow?.tags ?? []) {
    pushBadge(badges, {
      id: `identity-ind-tag-${tag}`,
      label: tag,
      tone: TAG_TONES[tag] ?? "neutral",
    });
  }

  const pbsText = firstRowValue(record, "form", "prescribing & pbs");
  if (pbsText) {
    parsePbsBadges(pbsText, badges);
  }

  if (isReviewed(record, governance)) {
    pushBadge(badges, { id: "identity-reviewed", label: "Reviewed", tone: "success" });
  }

  if (governance) {
    const sourceBadge = sourceFreshnessBadge(governance);
    if (sourceBadge) {
      pushBadge(badges, sourceBadge);
    }
  }

  return sortBadgesByPriority(dedupeBadges(badges));
}

export function medicationRowBadges(row: MedicationSectionRow, sectionType: string): MedicationBadge[] {
  const badges: MedicationBadge[] = [];
  const prefix = `row-${sectionType}-${row.key}`.replace(/\s+/g, "-").toLowerCase();

  if (row.patient) {
    patientBadges(row.patient, prefix, badges);
  }

  for (const tag of row.tags ?? []) {
    pushBadge(badges, {
      id: `${prefix}-tag-${tag}`,
      label: tag,
      tone: TAG_TONES[tag] ?? "info",
    });
  }

  textHeuristicBadges(row, sectionType, prefix, badges);

  const limit = sectionType === "contra" || badges.some((badge) => badge.tone === "danger") ? 4 : 3;
  return sortBadgesByPriority(dedupeBadges(badges)).slice(0, limit);
}

export function medicationAccessBadges(record: MedicationRecord): MedicationBadge[] {
  const badges: MedicationBadge[] = [];
  const brand = firstRowValue(record, "form", "brand");
  if (brand) {
    pushBadge(badges, { id: "access-brand", label: brand.replace(/\*\*/g, ""), tone: "neutral" });
  }

  const pbsText = firstRowValue(record, "form", "prescribing & pbs");
  if (pbsText) {
    parsePbsBadges(pbsText, badges);
    const itemMatch = pbsText.match(/\bitem\s+(\d{4}[A-Z])\b/i);
    if (itemMatch?.[1]) {
      pushBadge(badges, { id: `access-item-${itemMatch[1]}`, label: `Item ${itemMatch[1]}`, tone: "neutral" });
    }
  }

  const routes = firstRowValue(record, "form", "oral routes");
  if (routes) {
    const short = formulationShortLabel(routes);
    if (short) {
      pushBadge(badges, { id: "access-formulation", label: short, tone: "neutral" });
    }
  }

  return sortBadgesByPriority(dedupeBadges(badges)).slice(0, 4);
}

export function medicationStatTone(stat: MedicationStat): SemanticTone {
  const cls = stat.cls?.toLowerCase() ?? "";
  const flag = stat.flag?.toLowerCase() ?? "";
  if (cls === "hi" || flag === "hi") return "danger";
  if (cls === "warn" || flag === "warn") return "warning";
  if (cls === "good") return "success";
  return "neutral";
}

export function medicationAccessFields(record: MedicationRecord): Array<{ label: string; value: string }> {
  const fields: Array<{ label: string; value: string }> = [];
  const brand = firstRowValue(record, "form", "brand");
  if (brand) fields.push({ label: "Brand", value: brand.replace(/\*\*/g, "") });

  const pbsText = firstRowValue(record, "form", "prescribing & pbs");
  if (pbsText) {
    if (/STREAMLINED PBS/i.test(pbsText)) {
      fields.push({ label: "PBS status", value: "PBS streamlined" });
    } else if (/AUTHORITY REQUIRED/i.test(pbsText)) {
      fields.push({ label: "PBS status", value: "Authority required" });
    }
    const itemMatch = pbsText.match(/\bitem\s+(\d{4}[A-Z])\b/i);
    if (itemMatch?.[1]) {
      fields.push({ label: "PBS item", value: itemMatch[1] });
    }
  }

  const routes = firstRowValue(record, "form", "oral routes");
  if (routes) {
    // The whole field: forms can sit in separate sentences ("Oral liquid… Tablets…"),
    // and a record row must never hide one. A "." split once cut "Tablets (12.5…" short.
    fields.push({
      label: "Formulation",
      value: routes.replace(/\*\*/g, "").replace(/\s+/g, " ").trim() || routes,
    });
  }

  return fields;
}
