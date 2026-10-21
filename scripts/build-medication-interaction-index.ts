// Builds `data/medication-interaction-index.json` from the medication catalogue
// snapshot plus the curated lexicon in `src/lib/medication-interaction-lexicon.ts`.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  INTERACTION_LEXICON,
  LEXICON_SURFACES_BY_LENGTH,
  UNENUMERATED_MECHANISM_TERM_IDS,
  selectCatalogueSlugs,
  type LexiconTerm,
} from "../src/lib/medication-interaction-lexicon";
import { deriveMedicationSourceGovernance } from "../src/lib/medication-records";
import type { MedicationRecord } from "../src/lib/medications";

const SNAPSHOT_PATH = "data/medications-snapshot.json";
const OUTPUT_PATH = "data/medication-interaction-index.json";

// The reference date only decides `sourceStatus`; the checked date itself does not
// depend on it except to drop a date in the future. A fixed far-future clock keeps the
// artefact byte-stable from day to day while still refusing nothing real.
const STABLE_REFERENCE_DATE = new Date("2100-01-01T00:00:00.000Z");

function sourceCheckedOn(record: MedicationRecord): string | null {
  return deriveMedicationSourceGovernance(record.sections, STABLE_REFERENCE_DATE).sourceCheckedAt;
}

const SEVERITY_BY_TOKEN: Record<string, string> = {
  CRITICAL: "critical",
  HIGH: "high",
  MODERATE: "moderate",
  CAUTION: "caution",
  LOW: "low",
  NONE: "none",
  SAFE: "safe",
  BENEFICIAL: "beneficial",
};

const SEVERITY_PATTERN = /^\s*([A-Z][A-Z \-/]{2,30}?)\s*[—–-]\s*([\s\S]*)$/;

/**
 * A row whose entire content is a severity token asserting that nothing
 * interacts: today `triamcinolone` and `riboflavin`, both written "NONE.".
 *
 * `SEVERITY_PATTERN` needs a dash, so these parsed as severity `unknown` and
 * counted as unresolved — the tool reporting it could not read a row that says
 * exactly one thing, and holding both drugs at "needs manual review" over it.
 *
 * Restricted to tokens that assert ABSENCE, which is the whole safety argument.
 * A bare "CRITICAL." would name a severity without naming what interacts, and
 * that genuinely is unreadable; it must stay unresolved. Only a declaration that
 * there is nothing to find can be honoured with no counterparty attached.
 */
const ABSENCE_TOKENS = new Set(["NONE", "SAFE"]);
const BARE_TOKEN_PATTERN = /^\s*([A-Za-z]{3,12})\s*[.!]?\s*$/;

function bareAbsenceDeclaration(value: string): string | null {
  const match = BARE_TOKEN_PATTERN.exec(value.replace(/\*\*/g, ""));
  if (!match) return null;
  const token = match[1].toUpperCase();
  if (!ABSENCE_TOKENS.has(token)) return null;
  return SEVERITY_BY_TOKEN[token] ?? null;
}
type IndexCounterparty = { slug: string; name: string; via: string };
type IndexRow = {
  rowKey: string;
  rowIndex: number;
  severity: string;
  counterparties: string[];
  termIds: string[];
  resolved: boolean;
  /**
   * Groups of slugs where the row's alert requires at least one member from
   * EVERY group to be present in the patient's list, not merely any one
   * `counterparties` entry. Populated only for rows whose prose joins classes
   * with a literal "+" ("ACEi + Diuretic + NSAID") — the corpus's own convention
   * for a required combination, distinct from the comma/list style used
   * everywhere else for a plain either-of counterparty set. Absent (or empty)
   * for every other row, which keeps existing any-of behaviour unchanged.
   */
  requiredGroups?: string[][];
  /**
   * Verbatim `row.val`.
   *
   * Dropped from the artefact once, on the reasoning that every consumer already
   * holds the `MedicationRecord` and could read the text back by `rowIndex`. That
   * is true in one direction only. Interaction prose is not symmetric, so the
   * evaluator also scans the PATIENT's medications for rows naming the viewed
   * drug — and it has no record for those, which left a reverse-only match
   * rendering a drug name and a severity chip with no explanation under it.
   *
   * The whole corpus is ~60 KB of prose (the 661 KB the artefact once weighed was
   * repeated counterparty display names, not this), so carrying it is cheap
   * relative to shipping an alert nobody can read.
   */
  note: string;
};
type IndexEntry = { rows: IndexRow[]; unresolvedRowCount: number };
type InteractionIndex = {
  version: number;
  generatedFrom: string;
  sourceRowCount: number;
  stats: {
    resolvedRows: number;
    unresolvedRows: number;
    rowsWithCatalogueTarget: number;
    medicationsWithUnresolvedRows: number;
  };
  names: Record<string, string>;
  /**
   * The date each medication's sources were last checked, read from its own `src`
   * section exactly as the medication page reads it (oldest date wins; null when it
   * cannot be read). An interaction row lives inside a medication record and is
   * reviewed with it, so its 12-month review date counts from here (owner decision
   * 21 Oct 2026). Kept as a plain date with no reference clock, so the artefact does
   * not go stale as days pass.
   */
  reviewedOn: Record<string, string | null>;
  bySlug: Record<string, IndexEntry>;
};

const DOSAGE_FORM_TOKEN =
  /^(ir|sr|xr|mr|cr|odt|lai|im|iv|sl|po|pr|depot|patch|wafer|nasal|mouth|spray|inhaler|topical|cream|gel|drops|syrup|liquid|injection|infusion|oral|buccal|sublingual|transdermal|suppository|tablet|capsule|lozenge|pamoate|decanoate|acetate)$/i;

/**
 * Drop a trailing parenthesised qualifier: "Morphine (IR/IV)" -> "Morphine".
 *
 * Without this, name-derived surfaces were built by splitting the raw name on
 * "/", so "Lithium carbonate (IR/SR)" produced "Lithium carbonate (IR" and
 * "SR)" and never the drug's actual name. `stripDosageForm` could not repair it
 * either: it only pops bare trailing tokens, and "(IR/SR)" is not one.
 *
 * That silently cost nine interaction rows across five drugs — naloxone naming
 * Buprenorphine, codeine and midazolam naming Morphine, the carbapenems naming
 * Sodium valproate, and four rows naming Olanzapine — plus every row naming
 * Lithium. Each was content that existed and could not be reached.
 *
 * Deliberately narrower than a first-word fallback, which is the other way to
 * catch these and is unsafe: it yields "Sodium" for a row about sodium content,
 * "Vitamin" against Vitamin K in the warfarin rows, and "Potassium" against
 * hyperkalaemia prose. Removing a parenthetical leaves a whole drug name.
 */
function stripParenthetical(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function stripDosageForm(name: string): string {
  const tokens = name.split(/\s+/).filter(Boolean);
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    if (last === "/" || last === "-" || DOSAGE_FORM_TOKEN.test(last)) {
      tokens.pop();
      continue;
    }
    break;
  }
  return tokens
    .join(" ")
    .replace(/[\s/-]+$/, "")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentions(haystack: string, needle: string): boolean {
  const pattern = new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(needle)}(?![A-Za-z0-9])`, "i");
  return pattern.test(haystack);
}

/**
 * Extract clauses that actually declare counterparties. The first sentence is
 * always considered. Later sentences are considered only when they themselves
 * name a curated interaction term or catalogue drug before explanatory/mitigation
 * prose. This preserves clinically material later clauses (for example
 * methadone's CNS-depressant sentence) without scanning arbitrary advice such as
 * "cover with PPI if combined".
 */
function counterpartySegments(value: string): { severityToken: string | null; segments: string[] } {
  const match = SEVERITY_PATTERN.exec(value);
  const severityToken = match ? match[1].trim() : null;
  const body = (match ? match[2] : value).replace(/\*\*/g, "").trim();
  const sentences = body
    .split(/(?<=[.;])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  return { severityToken, segments: sentences.length ? sentences : [body] };
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sameJson(left: string, right: string): boolean {
  try {
    return JSON.stringify(JSON.parse(left)) === JSON.stringify(JSON.parse(right));
  } catch {
    return false;
  }
}

function main(): void {
  const checkOnly = process.argv.includes("--check");
  const snapshotPath = path.resolve(process.cwd(), SNAPSHOT_PATH);
  const records = JSON.parse(readFileSync(snapshotPath, "utf8")) as MedicationRecord[];

  const termSlugs = new Map<string, string[]>();
  for (const term of INTERACTION_LEXICON) {
    if (term.kind === "catalogue" && term.select) termSlugs.set(term.id, selectCatalogueSlugs(term.select, records));
  }

  const drugSurfaces = records
    .flatMap((record) => {
      // Keep three-character catalogue names/acronyms: `mentions` already
      // enforces alphanumeric boundaries, so dropping them here only creates
      // avoidable false negatives. Two-character route/form tokens remain below
      // the floor to avoid indexing abbreviations such as IR/IM/IV as drugs.
      // Derive from the parenthetical-free form as well as the raw name, so a
      // "(IR/SR)" suffix cannot swallow the drug's own name (see
      // `stripParenthetical`).
      const parts = [record.name, stripParenthetical(record.name)]
        .flatMap((value) => value.split("/"))
        .map((part) => part.trim())
        .filter((part) => part.length >= 3);
      const surfaces = new Set(parts);
      for (const part of parts) surfaces.add(stripDosageForm(part));
      return (
        Array.from(surfaces)
          .filter((surface) => surface.length >= 3)
          // A fragment carrying an unbalanced bracket ("Lithium carbonate (IR",
          // "SR)") is splitting debris, never something a catalogue row writes.
          .filter((surface) => !/[()]/.test(surface))
          .map((surface) => ({ surface, slug: record.slug, name: record.name }))
      );
    })
    .sort((a, b) => b.surface.length - a.surface.length);

  const nameBySlug = new Map(records.map((record) => [record.slug, record.name]));
  const bySlug: Record<string, IndexEntry> = {};
  let sourceRowCount = 0;
  let resolvedRows = 0;
  let unresolvedRows = 0;
  let rowsWithCatalogueTarget = 0;

  for (const record of records) {
    const rows: IndexRow[] = [];
    for (const section of record.sections ?? []) {
      if (section.type !== "inter") continue;
      section.rows?.forEach((row, rowIndex) => {
        sourceRowCount += 1;
        const value = row.val ?? "";
        const { severityToken, segments } = counterpartySegments(value);
        const bareAbsence = bareAbsenceDeclaration(value);
        const severity = bareAbsence ?? (severityToken ? (SEVERITY_BY_TOKEN[severityToken] ?? "unknown") : "unknown");
        const counterparties = new Map<string, IndexCounterparty>();
        const termIds = new Set<string>();
        const requiredGroups: string[][] = [];
        let sawClassifiableTerm = false;
        // A lexicon surface that is the source drug's own name (moclobemide is
        // both a catalogue drug and a surface of the MAOI class term) is the row
        // talking about itself, not naming a counterparty. Matching it would
        // turn moclobemide's "Cimetidine (doubles moclobemide levels)" row into
        // a class-wide MAOI interaction. Other drugs' rows still expand it.
        const ownSurfaces = new Set(
          drugSurfaces.filter(({ slug }) => slug === record.slug).map(({ surface }) => surface.toLowerCase()),
        );

        for (const segment of segments) {
          const segmentTermIds = new Set<string>();
          const segmentCounterparties = new Map<string, IndexCounterparty>();
          const consumed: string[] = [];
          for (const { surface, term } of LEXICON_SURFACES_BY_LENGTH) {
            if (!mentions(segment, surface)) continue;
            if (term.sourceDenySlugs?.includes(record.slug)) continue;
            if (ownSurfaces.has(surface.toLowerCase())) continue;
            if (consumed.some((taken) => taken.includes(surface))) continue;
            consumed.push(surface);
            segmentTermIds.add(term.id);
            addTermTargets(term, segmentCounterparties, record.slug);
          }
          for (const { surface, slug } of drugSurfaces) {
            if (slug === record.slug || !mentions(segment, surface)) continue;
            // Exclude same-name duplicates (e.g. warfarin-vka / warfarin-anticoagulant
            // both surface as "warfarin" — matching the alternate slug would produce a
            // false self-interaction when both records are on the patient list).
            if ((nameBySlug.get(slug) ?? slug) === record.name) continue;
            if (!segmentCounterparties.has(slug)) {
              segmentCounterparties.set(slug, { slug, name: nameBySlug.get(slug) ?? slug, via: surface });
            }
          }

          // Always accept the first sentence. Later sentences qualify only if
          // they contain a recognised interaction term or catalogue counterparty.
          if (segment === segments[0] || segmentTermIds.size > 0 || segmentCounterparties.size > 0) {
            if (segmentTermIds.size > 0 || segmentCounterparties.size > 0) sawClassifiableTerm = true;
            for (const id of segmentTermIds) termIds.add(id);
            for (const [slug, target] of segmentCounterparties) counterparties.set(slug, target);
          }

          requiredGroups.push(...extractRequiredGroups(segment, record.slug));
        }

        const hasUnenumeratedMechanism = Array.from(termIds).some((id) => UNENUMERATED_MECHANISM_TERM_IDS.has(id));
        // A bare absence declaration is fully read despite naming no party —
        // that is what it asserts. Every other route still requires having
        // classified something.
        const resolved = bareAbsence !== null || (sawClassifiableTerm && !hasUnenumeratedMechanism);
        if (resolved) resolvedRows += 1;
        else unresolvedRows += 1;
        if (counterparties.size > 0) rowsWithCatalogueTarget += 1;

        rows.push({
          rowKey: row.key,
          rowIndex,
          severity,
          counterparties: Array.from(counterparties.keys()).sort(),
          termIds: Array.from(termIds).sort(),
          resolved,
          note: value,
          ...(requiredGroups.length > 0 ? { requiredGroups: requiredGroups.map((group) => group.sort()) } : {}),
        });
      });
    }
    if (rows.length > 0) bySlug[record.slug] = { rows, unresolvedRowCount: rows.filter((row) => !row.resolved).length };
  }

  /**
   * "ACEi + Diuretic + NSAID" style rows ("Triple Whammy" and its relatives)
   * name a required COMBINATION, not an either-of list — the corpus marks that
   * with a literal "+" between classes, distinct from the comma/list style used
   * for genuine either-of counterparty sets elsewhere. Splitting on "+" and
   * resolving each clause independently turns that combination back into
   * separate required groups instead of the flat union `segmentCounterparties`
   * would otherwise produce, which let any ONE class (an NSAID alone, a
   * diuretic alone, or even another ACEi) fire the full combination alert.
   *
   * A clause naming only the source drug's own class (ramipril's row saying
   * "ACEi") is dropped rather than turned into a group: that class is already
   * supplied by the source drug, so it is not a further requirement. This
   * self-exclusion is deliberately local to conjunction-group extraction —
   * `addTermTargets`'s ordinary either-of matching is untouched, because a
   * source drug that is itself a class member very often legitimately warns
   * about OTHER members of that same class (an opioid's own row warning about
   * other opioids, a benzodiazepine's row warning about other benzodiazepines).
   * Excluding the class there would silently drop those real alerts; it is
   * safe only here, where "+" already marks the mention as naming a required
   * combination rather than an independent either-of counterparty.
   *
   * Fewer than two resolvable clauses means there is nothing to require beyond
   * the existing any-of `counterparties` set, so no groups are returned.
   */
  function extractRequiredGroups(segment: string, sourceSlug: string): string[][] {
    // Require whitespace on both sides of the "+": "ACEi + Diuretic" is the
    // combination marker, but ionic/charge notation like "Fe3+" or "K+-sparing"
    // has no surrounding space and must not be split into spurious clauses.
    const clauses = segment
      .split(/\s+\+\s+/)
      .map((clause) => clause.trim())
      .filter(Boolean);
    if (clauses.length < 2) return [];

    const groups: string[][] = [];
    for (const clause of clauses) {
      const target = new Map<string, IndexCounterparty>();
      for (const { surface, term } of LEXICON_SURFACES_BY_LENGTH) {
        if (term.kind !== "catalogue") continue;
        if (!mentions(clause, surface)) continue;
        if (term.sourceDenySlugs?.includes(sourceSlug)) continue;
        const slugs = termSlugs.get(term.id) ?? [];
        if (slugs.includes(sourceSlug)) continue;
        for (const slug of slugs) {
          if (slug === sourceSlug || target.has(slug)) continue;
          target.set(slug, { slug, name: nameBySlug.get(slug) ?? slug, via: term.id });
        }
      }
      for (const { surface, slug } of drugSurfaces) {
        if (slug === sourceSlug || !mentions(clause, surface)) continue;
        if ((nameBySlug.get(slug) ?? slug) === (nameBySlug.get(sourceSlug) ?? sourceSlug)) continue;
        if (!target.has(slug)) target.set(slug, { slug, name: nameBySlug.get(slug) ?? slug, via: surface });
      }
      if (target.size > 0) groups.push(Array.from(target.keys()));
    }
    return groups.length >= 2 ? groups : [];
  }

  function addTermTargets(term: LexiconTerm, into: Map<string, IndexCounterparty>, sourceSlug: string): void {
    if (term.kind !== "catalogue") return;
    for (const slug of termSlugs.get(term.id) ?? []) {
      if (slug === sourceSlug || into.has(slug)) continue;
      into.set(slug, { slug, name: nameBySlug.get(slug) ?? slug, via: term.id });
    }
  }

  const index: InteractionIndex = {
    version: 1,
    generatedFrom: SNAPSHOT_PATH,
    sourceRowCount,
    stats: {
      resolvedRows,
      unresolvedRows,
      rowsWithCatalogueTarget,
      medicationsWithUnresolvedRows: Object.values(bySlug).filter((entry) => entry.unresolvedRowCount > 0).length,
    },
    names: Object.fromEntries(
      records.map((record) => [record.slug, record.name] as const).sort(([a], [b]) => a.localeCompare(b)),
    ),
    reviewedOn: Object.fromEntries(
      records.map((record) => [record.slug, sourceCheckedOn(record)] as const).sort(([a], [b]) => a.localeCompare(b)),
    ),
    bySlug,
  };

  const serialised = stableJson(index);
  const outputPath = path.resolve(process.cwd(), OUTPUT_PATH);
  if (checkOnly) {
    const current = readFileSync(outputPath, "utf8");
    if (!sameJson(current, serialised)) {
      console.error(
        `[medication-interactions] ${OUTPUT_PATH} is stale.\nRun \`npm run medications:interactions\` and commit the result.`,
      );
      process.exit(1);
    }
    console.log(`[medication-interactions] ${OUTPUT_PATH} is up to date (${sourceRowCount} rows).`);
    return;
  }

  writeFileSync(outputPath, serialised);
  console.log(
    `[medication-interactions] wrote ${OUTPUT_PATH}: ${sourceRowCount} rows, ${resolvedRows} resolved, ${unresolvedRows} unresolved, ${index.stats.medicationsWithUnresolvedRows} medications carry an unresolved row.`,
  );
}

main();
