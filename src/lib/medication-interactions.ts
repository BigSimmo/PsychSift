// Patient-medication-list → drug-interaction evaluation.
//
// The companion to `medication-patient-alerts.ts`. That module answers "does
// this patient's *physiology* change how I use this drug?"; this one answers
// "does this drug collide with something the patient is *already taking*?".
// Both are pure and framework-free so the prescribing workspace, the medication
// detail page, and unit tests can share them.
//
// Input is the generated `data/medication-interaction-index.json` (see
// `scripts/build-medication-interaction-index.ts`): per source medication, one
// entry per `Key Interactions` row, carrying normalised severity and the
// resolved catalogue counterparties. The verbatim row text is NOT duplicated
// into the index — it is read back off the `MedicationRecord` by `rowIndex`.
//
// THE ONE INVARIANT THAT MATTERS
// `success` (green) must be unreachable on incomplete analysis. Four separate
// things can make the analysis incomplete, and each has to keep green off:
//
//   1. A row whose counterparty could not be resolved → `unresolvedRowCount`.
//   2. A medication the index has no entry for at all → `dataAvailable: false`,
//      which reports a synthetic `unresolvedRowCount` of 1. Without this, a drug
//      we know nothing about scored zero unresolved rows and composed straight
//      to green — a false all-clear on absent data, the worst failure this
//      module has.
//   3. An unparsed severity token → `SEVERITY_TONE.unknown` is `neutral`, never
//      `success`.
//   4. An entered medication outside both ends of every resolved interaction edge →
//      `unreachableCounterparties`. Case 2 covers the drug being VIEWED; this
//      covers the drugs in the PATIENT's list. Both of that pair are uncheckable
//      for the same reason, and only one of them used to stop green: a patient
//      on a drug the corpus never mentions produced no interactions, zero
//      unresolved rows, and a confident green.
//   6. A high-risk medication (`HIGH_RISK_INTERACTION_MEDICINES`) on either side
//      of the pair whose record is not marked `coverageReviewed` →
//      `unreviewedHighRiskMedications`. Cases 1-5 assume a record's rows list
//      every interaction it has. A thin record breaks that silently: lithium
//      carried one row and no unresolved ones, so it composed to green against
//      carbamazepine, sertraline and SGLT2 inhibitors. For these medicines green
//      needs a person to have confirmed the record is complete.
//   5. An entered medication carrying its own unresolved rows →
//      `reverseUnresolvedCounterparties`. Case 1 counts only the VIEWED drug's
//      rows, but the reverse scan reads the PATIENT's rows too, and an
//      unresolved one there (e.g. clarithromycin's CYP3A4/P-gp row) may reach
//      the viewed drug without naming it. Viewing diltiazem for a patient on
//      clarithromycin used to compose straight to green.
//
// Missing analysis is not the same as a negative finding. `composeMedicationVerdict`
// is where that is finally enforced.
//
// SYMMETRY
// Interaction prose is not reliably symmetric: drug A's rows may name drug B
// while drug B's rows never mention A. Evaluating only the viewed drug's rows
// therefore misses real pairs in one direction. Both directions are scanned and
// the results de-duplicated, preferring the copy that carries source text.

import interactionIndex from "../../data/medication-interaction-index.json";
import medicationSourceLinkMap from "@/data/medication-source-links.json";
import {
  contentReviewSchedule,
  type ContentReviewSchedule,
  type ContentReviewScheduleInput,
} from "@/lib/content-review-schedule";
import { SEMANTIC_TONE_PRIORITY, type SemanticTone } from "@/lib/semantic-tone";

export type InteractionSeverity =
  "critical" | "high" | "moderate" | "caution" | "low" | "none" | "safe" | "beneficial" | "unknown";

export type MedicationInteraction = {
  id: string;
  counterpartySlug: string;
  counterpartyName: string;
  matchedTerms: string[];
  severity: InteractionSeverity;
  tone: SemanticTone;
  kind: string;
  note: string;
};

export type MedicationInteractionResult = {
  interactions: MedicationInteraction[];
  counts: Record<SemanticTone, number>;
  highestTone: SemanticTone | null;
  unresolvedRowCount: number;
  totalRowCount: number;
  dataAvailable: boolean;
  /**
   * Entered medications outside the catalogue's resolved interaction graph,
   * so they could not be cross-checked in either direction. See
   * `UNREACHABLE_SLUGS` — this is the fourth route to an incomplete analysis.
   */
  unreachableCounterparties: string[];
  /**
   * Entered medications whose own interaction rows include at least one that
   * could not be resolved, so the reverse scan may have missed an edge to the
   * viewed drug. Excludes `unreachableCounterparties`, which already says so.
   * The fifth route to an incomplete analysis.
   */
  reverseUnresolvedCounterparties: string[];
  /**
   * High-risk medications in this pair (the viewed drug or an entered one) whose
   * interaction record has not been reviewed as complete (`coverageReviewed`).
   * Empty when no medication list is entered. The sixth route to an incomplete
   * analysis.
   */
  unreviewedHighRiskMedications: string[];
};

type IndexRow = {
  rowKey: string;
  rowIndex: number;
  severity: string;
  counterparties: string[];
  termIds: string[];
  resolved: boolean;
  /** Verbatim row text, carried so the reverse direction has wording too. */
  note: string;
  /**
   * Groups of slugs where at least one member of EVERY group must be present
   * in the patient's list before this row's alert fires. Set only for rows
   * whose prose requires a class combination ("ACEi + Diuretic + NSAID") —
   * see `scripts/build-medication-interaction-index.ts`. Absent for the
   * ordinary either-of `counterparties` rows, which fire on any single match
   * as before.
   */
  requiredGroups?: string[][];
};

/** Whether every required group of a row has at least one member in `present`. */
function requiredGroupsSatisfied(row: IndexRow, present: ReadonlySet<string>): boolean {
  if (!row.requiredGroups || row.requiredGroups.length === 0) return true;
  return row.requiredGroups.every((group) => group.some((slug) => present.has(slug)));
}

type InteractionIndexShape = {
  version: number;
  sourceRowCount: number;
  names: Record<string, string>;
  /** Source-check date of each medication record, which every interaction row inside it shares. */
  reviewedOn?: Record<string, string | null>;
  bySlug: Record<
    string,
    {
      rows: IndexRow[];
      unresolvedRowCount: number;
      /**
       * True only when a clinical reviewer has confirmed this record lists every
       * interaction it should. Absent means not reviewed. Only `true` counts:
       * any other value is read as not reviewed. See `HIGH_RISK_INTERACTION_MEDICINES`.
       */
      coverageReviewed?: boolean;
    }
  >;
};

const INDEX = interactionIndex as unknown as InteractionIndexShape;

/**
 * Medications whose interactions are dangerous enough that "No interaction found"
 * must never be shown unless their record has been reviewed as complete
 * (owner decision 26 Oct 2026). Matched on whole words in the catalogue slug and
 * display name, so a generic, a salt form or a brand-named entry all match.
 * Names only, no clinical content.
 */
export const HIGH_RISK_INTERACTION_MEDICINES = [
  { id: "lithium", terms: ["lithium", "lithicarb", "quilonum", "priadel"] },
  { id: "clozapine", terms: ["clozapine", "clozaril", "clopine"] },
  {
    id: "valproate",
    terms: ["valproate", "valproic", "divalproex", "epilim", "valpro", "valprease"],
  },
  { id: "methadone", terms: ["methadone", "biodone", "physeptone", "methadose"] },
  {
    id: "maoi",
    terms: [
      "maoi",
      "moclobemide",
      "aurorix",
      "phenelzine",
      "nardil",
      "tranylcypromine",
      "parnate",
      "selegiline",
      "eldepryl",
      "emsam",
      "isocarboxazid",
      "marplan",
      "rasagiline",
      "azilect",
    ],
  },
] as const satisfies readonly { id: string; terms: readonly string[] }[];

export type HighRiskInteractionMedicineId = (typeof HIGH_RISK_INTERACTION_MEDICINES)[number]["id"];

function normaliseMedicationWords(value: string): string {
  return ` ${value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

/** Which high-risk group a medication belongs to, matched on its slug and display name. */
export function highRiskInteractionMedicineId(slug: string): HighRiskInteractionMedicineId | null {
  const haystack = `${normaliseMedicationWords(slug)}${normaliseMedicationWords(medicationDisplayName(slug))}`;
  for (const group of HIGH_RISK_INTERACTION_MEDICINES) {
    if (group.terms.some((term) => haystack.includes(` ${term} `))) return group.id;
  }
  return null;
}

/** Whether a reviewer has marked this medication's interaction record complete. Only `true` counts. */
export function isInteractionCoverageReviewed(slug: string): boolean {
  return INDEX.bySlug[slug]?.coverageReviewed === true;
}

/**
 * Catalogue medications outside both ends of every resolved interaction edge.
 *
 * 35 of 328 today. A drug in here cannot produce an alert from any direction:
 * not from its own resolved rows, not from anyone else's. Entering it therefore yields
 * silence, and silence in this UI is otherwise indistinguishable from "checked,
 * nothing found" — which is the single most misleading state this feature can
 * reach, because the reassurance is unearned.
 *
 * Most of it is genuine corpus coverage (antibiotics, antidiabetics, aperients,
 * vitamins) that only new interaction rows can fix. It is derived here rather
 * than baked into the generated index so the two cannot drift, and computed once
 * at module load — a single pass over ~520 rows.
 */
const UNREACHABLE_SLUGS: ReadonlySet<string> = (() => {
  const reachable = new Set<string>();
  for (const [sourceSlug, entry] of Object.entries(INDEX.bySlug)) {
    for (const row of entry.rows) {
      if (row.counterparties.length > 0) reachable.add(sourceSlug);
      for (const slug of row.counterparties) reachable.add(slug);
    }
  }
  return new Set(Object.keys(INDEX.names).filter((slug) => !reachable.has(slug)));
})();

/** Whether no resolved interaction edge in the catalogue includes this medication. */
export function isUnreachableCounterparty(slug: string): boolean {
  return UNREACHABLE_SLUGS.has(slug);
}

export function medicationDisplayName(slug: string): string {
  return INDEX.names[slug] ?? slug;
}

export type MedicationOption = { slug: string; name: string };
let cachedOptions: MedicationOption[] | null = null;

export function catalogueMedicationOptions(): MedicationOption[] {
  cachedOptions ??= Object.entries(INDEX.names)
    .map(([slug, name]) => ({ slug, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return cachedOptions;
}

export function isCatalogueMedicationSlug(slug: string): boolean {
  return Object.hasOwn(INDEX.names, slug);
}

/**
 * Severity token → badge/verdict tone.
 *
 * `success` is the tone the verdict band prints as "No alert found", so it
 * belongs to "checked, nothing found" and to nothing else. It used to be shared
 * with the four documented-but-not-alerting severities, which composed a
 * catalogued interaction straight into the all-clear: a patient on mesalazine
 * and digoxin got a green shield headed "NO ALERT FOUND" with "1 interaction"
 * printed underneath and the row's own wording — "Decreases absorption of
 * Digoxin" — inside a success-toned notice below that.
 *
 * They map to `info` instead: documented, stated, and visibly not an alert
 * level. `unknown` stays `neutral` — missing analysis is not a negative finding,
 * which is the invariant in this module's header.
 */
export const SEVERITY_TONE: Record<InteractionSeverity, SemanticTone> = {
  critical: "danger",
  high: "danger",
  moderate: "warning",
  caution: "warning",
  low: "info",
  none: "info",
  safe: "info",
  beneficial: "info",
  unknown: "neutral",
};

const EMPTY_COUNTS: Record<SemanticTone, number> = {
  danger: 0,
  warning: 0,
  clinical: 0,
  success: 0,
  neutral: 0,
  info: 0,
};

const SEVERITY_ORDER: InteractionSeverity[] = [
  "critical",
  "high",
  "moderate",
  "caution",
  "unknown",
  "low",
  "none",
  "safe",
  "beneficial",
];

function normaliseSeverity(value: string): InteractionSeverity {
  return (SEVERITY_ORDER as string[]).includes(value) ? (value as InteractionSeverity) : "unknown";
}

// The catalogue writes every interaction row as `SEVERITY — body`, e.g.
// "CRITICAL — MAOIs, Tramadol… Massive risk of Serotonin Syndrome". The prefix
// is the same value already carried in `severity`, so rendering it inside the
// paragraph both repeats the badge beside it and opens every entry with a
// shouty all-caps token and a dangling dash — which is what made the block read
// as unformatted dump rather than prose. Only recognised severity labels are
// removable: a broad all-caps pattern can eat clinical acronyms or instructions
// such as "NSAID-induced" and "NEVER-combine".
const SEVERITY_PREFIX = new RegExp(`^\\s*(?:${SEVERITY_ORDER.join("|")})\\s*[—–-]\\s*`, "i");

/**
 * The interaction row's text with that redundant severity prefix removed.
 *
 * Deliberately NOT a summariser: no sentence is dropped, reordered or reworded,
 * because the wording is the clinical claim and the surface promises it
 * verbatim. A row that does not carry the prefix is returned untouched.
 */
export function interactionNoteBody(note: string): string {
  return note.replace(SEVERITY_PREFIX, "").trim();
}

/** Display label for a severity, e.g. "critical" → "Critical". */
export function severityLabel(severity: InteractionSeverity): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

export function interactionRowCount(slug: string): number {
  return INDEX.bySlug[slug]?.rows.length ?? 0;
}

function sourceRowsFor(record?: { sections?: { type: string; rows?: { key: string; val: string }[] }[] } | null) {
  return record?.sections?.find((section) => section.type === "inter")?.rows ?? [];
}

function interactionFromRow(
  sourceSlug: string,
  row: IndexRow,
  counterpartySlug: string,
  note: string,
  reverse = false,
): MedicationInteraction {
  const severity = normaliseSeverity(row.severity);
  return {
    id: reverse
      ? `${sourceSlug}:reverse:${row.rowIndex}:${counterpartySlug}`
      : `${sourceSlug}:${row.rowIndex}:${counterpartySlug}`,
    counterpartySlug,
    counterpartyName: medicationDisplayName(counterpartySlug),
    matchedTerms: row.termIds,
    severity,
    tone: SEVERITY_TONE[severity],
    kind: row.rowKey,
    note,
  };
}

/**
 * The review schedule for one interaction (owner decision 21 Oct 2026: interactions
 * every 12 months, and immediately when a cited guideline changes).
 *
 * An interaction is a row inside one medication record — the viewed drug's own row, or
 * the patient drug's row for a reverse match — and it is reviewed with that record. So
 * it shares that record's source-check date and that record's cited sources. The
 * carrying record is the first segment of the interaction id.
 */
export function interactionReviewInput(interaction: Pick<MedicationInteraction, "id">): ContentReviewScheduleInput {
  const carryingSlug = interaction.id.split(":")[0] ?? "";
  const links = medicationSourceLinkMap as Readonly<Record<string, readonly string[]>>;
  return {
    kind: "interaction",
    lastReviewedAt: INDEX.reviewedOn?.[carryingSlug] ?? null,
    citedSourceIds: Object.hasOwn(links, carryingSlug) ? links[carryingSlug] : [],
  };
}

export function interactionReviewSchedule(
  interaction: Pick<MedicationInteraction, "id">,
  referenceDate?: Date,
): ContentReviewSchedule {
  return contentReviewSchedule({ ...interactionReviewInput(interaction), referenceDate });
}

export function evaluateMedicationInteractions(
  slug: string,
  patientMedicationSlugs: readonly string[],
  record?: { sections?: { type: string; rows?: { key: string; val: string }[] }[] } | null,
): MedicationInteractionResult {
  const entry = INDEX.bySlug[slug];
  const dataAvailable = Boolean(entry && entry.rows.length > 0);
  const patient = new Set(patientMedicationSlugs.filter((value) => value !== slug));
  const interactions: MedicationInteraction[] = [];
  const sourceRows = sourceRowsFor(record);

  if (entry) {
    for (const row of entry.rows) {
      if (!requiredGroupsSatisfied(row, patient)) continue;
      for (const counterpartySlug of row.counterparties) {
        if (!patient.has(counterpartySlug)) continue;
        // Prefer the live record's wording; fall back to the indexed copy when no
        // record was supplied. The two are kept identical by
        // `check:medication-interactions`, which fails on a stale artefact.
        interactions.push(interactionFromRow(slug, row, counterpartySlug, sourceRows[row.rowIndex]?.val || row.note));
      }
    }
  }

  // Interaction prose is not guaranteed to be symmetric. Check each entered
  // medication's index entry as well so a clinically material edge is not missed
  // merely because it is documented on the existing drug rather than the candidate.
  // The viewed drug itself can satisfy a required group from the reverse row's
  // perspective (e.g. it supplies the "ACEi" side of the patient's diuretic row),
  // so it is included alongside `patient` when checking that gate.
  const patientWithViewed = new Set([...patient, slug]);
  for (const patientSlug of patient) {
    const reverseEntry = INDEX.bySlug[patientSlug];
    if (!reverseEntry) continue;
    for (const row of reverseEntry.rows) {
      if (!row.counterparties.includes(slug)) continue;
      if (!requiredGroupsSatisfied(row, patientWithViewed)) continue;
      // The reverse row belongs to the PATIENT's medication, whose record this
      // caller does not hold — so its wording can only come from the index. It
      // used to be passed as "", which rendered a drug name and a severity chip
      // with nothing underneath explaining either.
      interactions.push(interactionFromRow(patientSlug, row, patientSlug, row.note, true));
    }
  }

  // Keep the strongest form of an equivalent pair. Distinct rows are retained
  // because they may encode different mechanisms or severities.
  const deduped = new Map<string, MedicationInteraction>();
  for (const interaction of interactions) {
    const key = `${interaction.counterpartySlug}:${interaction.kind}:${interaction.severity}`;
    const existing = deduped.get(key);
    if (!existing || (!existing.note && interaction.note)) deduped.set(key, interaction);
  }
  const resultInteractions = Array.from(deduped.values());

  resultInteractions.sort((a, b) => {
    const byTone = SEMANTIC_TONE_PRIORITY[b.tone] - SEMANTIC_TONE_PRIORITY[a.tone];
    if (byTone !== 0) return byTone;
    const bySeverity = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
    if (bySeverity !== 0) return bySeverity;
    return a.counterpartyName.localeCompare(b.counterpartyName);
  });

  const counts: Record<SemanticTone, number> = { ...EMPTY_COUNTS };
  for (const interaction of resultInteractions) counts[interaction.tone] += 1;

  // The graph calculation already includes both endpoints of every resolved
  // edge. Keep this result filter as a defensive invariant so the UI can never
  // call a medication uncheckable directly above an alert about that drug.
  // With no medication list there is no pairing to call clear, so nothing to flag.
  const unreviewedHighRiskMedications =
    patient.size === 0
      ? []
      : [slug, ...Array.from(patient).sort((a, b) => medicationDisplayName(a).localeCompare(medicationDisplayName(b)))]
          .filter((value) => highRiskInteractionMedicineId(value) !== null)
          .filter((value) => !isInteractionCoverageReviewed(value));

  const unreachableCounterparties = Array.from(patient)
    .filter((value) => UNREACHABLE_SLUGS.has(value))
    .filter((value) => !resultInteractions.some((item) => item.counterpartySlug === value))
    .sort((a, b) => medicationDisplayName(a).localeCompare(medicationDisplayName(b)));

  return {
    interactions: resultInteractions,
    counts,
    highestTone: resultInteractions[0]?.tone ?? null,
    unresolvedRowCount: dataAvailable ? (entry?.unresolvedRowCount ?? 0) : 1,
    totalRowCount: entry?.rows.length ?? 0,
    dataAvailable,
    unreachableCounterparties,
    reverseUnresolvedCounterparties: Array.from(patient)
      .filter((value) => (INDEX.bySlug[value]?.unresolvedRowCount ?? 0) > 0)
      .filter((value) => !unreachableCounterparties.includes(value))
      .sort((a, b) => medicationDisplayName(a).localeCompare(medicationDisplayName(b))),
    unreviewedHighRiskMedications,
  };
}

export type MedicationVerdict = {
  tone: SemanticTone;
  incomplete: boolean;
  interactionCount: number;
  considerationCount: number;
  unresolvedRowCount: number;
};

export function composeMedicationVerdict(input: {
  considerationTone: SemanticTone | null;
  considerationCount: number;
  unassessedCount: number;
  interactionTone: SemanticTone | null;
  interactionCount: number;
  unresolvedRowCount: number;
  /**
   * Entered medications outside the resolved interaction graph. Optional so existing callers
   * keep compiling, but a caller that omits it can still reach green while an
   * uncheckable drug sits in the patient's list.
   */
  unreachableCounterpartyCount?: number;
  /**
   * Entered medications carrying unresolved rows of their own. Optional for the
   * same reason as `unreachableCounterpartyCount`, with the same consequence if
   * a caller omits it.
   */
  reverseUnresolvedCounterpartyCount?: number;
  /**
   * High-risk medications in the pair whose record is not reviewed as complete.
   * Required, unlike the two above: omitting it would let lithium, clozapine,
   * valproate, methadone or an MAOI reach green on a thin record.
   */
  unreviewedHighRiskCount: number;
}): MedicationVerdict {
  const incomplete =
    input.unassessedCount > 0 ||
    input.unresolvedRowCount > 0 ||
    (input.unreachableCounterpartyCount ?? 0) > 0 ||
    (input.reverseUnresolvedCounterpartyCount ?? 0) > 0 ||
    input.unreviewedHighRiskCount > 0;
  const candidates = [input.considerationTone, input.interactionTone].filter(
    (tone): tone is SemanticTone => tone !== null,
  );

  let tone: SemanticTone = candidates.length
    ? candidates.reduce((best, current) =>
        SEMANTIC_TONE_PRIORITY[current] > SEMANTIC_TONE_PRIORITY[best] ? current : best,
      )
    : "success";

  // "Could not finish the check" outranks both "nothing found" (`success`) and
  // "documented, no alert level" (`info`): the reader needs the manual-review
  // headline, not a green or an informational one, whenever an engine left
  // something unassessed. `info` is included because the documented severities
  // moved onto it; before that they arrived here as `success` and were caught by
  // this same line.
  if (incomplete && (tone === "success" || tone === "info")) tone = "neutral";

  return {
    tone,
    incomplete,
    interactionCount: input.interactionCount,
    considerationCount: input.considerationCount,
    unresolvedRowCount: input.unresolvedRowCount,
  };
}
